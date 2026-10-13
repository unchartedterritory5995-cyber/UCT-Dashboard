/**
 * ⛔⛔ SPEC §P2 INTEGRITY RULE, CLIENT HALF — "No block may own a second write door."
 *
 * Every file under components/notebook/blocks/ and lib/blocks/, plus components/LogTradeChecklist.jsx
 * (tests excluded), is parsed with acorn:
 *   ① every request is a GET unless it matches a NAMED method+URL exception below (IR-I b): a fetch
 *     whose options are not an object literal with a literal `method` reads as method '?', which is
 *     never exempt (IR-I a); navigator.sendBeacon, XMLHttpRequest and the json(Post|Put|Patch|Delete)
 *     helpers are writes too. The door census (doorEnumeration.test.js ①/②) still pins the server to
 *     seven note-advancing functions, so a note door cannot hide behind an exception;
 *   ② no block file imports the offline write layer (lib/offline/*) or the styles writes
 *     (lib/journalStyles.js), and no allow-list entry can lift that ban;
 *   ③ `updateAttributes(` is called in exactly ONE block file, useBlockParams.js, and that file
 *     still calls it (a renamed door would otherwise leave this rail guarding nothing);
 *   ④ (ruling R-RC-6) a block file imports only another block file or a module NAMED in
 *     IMPORT_ALLOW below. Anything else, including an `import()` whose source cannot be read,
 *     fails by name.
 * ⛔ IR-B5: WRITE_EXCEPTIONS starts EMPTY. The task that creates a writing file adds its own entry in
 * the same commit, so this rail is green at every task boundary. IMPORT_ALLOW works the same way.
 * ⛔ CODE, NEVER PROSE: every check reads the parse tree, so a comment or a string that SAYS
 * `updateAttributes(` or `method: 'PUT'` is never a match. The controls prove both directions:
 * each failure planted in memory is seen, and the same text inside a comment is not.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep, posix } from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const REPO = join(__dirname, '..', '..', '..', '..', '..', '..')
const DIRS = [join(REPO, 'app/src/pages/journal-2-0/components/notebook/blocks'),
  join(REPO, 'app/src/pages/journal-2-0/lib/blocks')]
const EXTRA = [join(REPO, 'app/src/pages/journal-2-0/components/LogTradeChecklist.jsx')]
const rel = (p) => relative(REPO, p).split(sep).join('/')
const P = Parser.extend(jsx())
const BLOCK_DIR_RELS = DIRS.map((d) => `${rel(d)}/`)

/**
 * file -> [{ method, url, why }]. `url` is a LITERAL template, compared for equality with the call's
 * URL (`{}` standing for each ${…}); it is never a regular expression (fix round 1, M-1), and an
 * entry `exceptionProblems` refuses exempts nothing.
 * ⛔ IR-B5: empty until a task ships a file that writes. Each task adds EXACTLY its own entry, in the
 * commit that creates the call, and nothing else:
 *   · Task 8  — lib/blocks/logTradeChecklist.js, its two named writes (Log Trade's ticks: the open
 *     position's pre-entry PUT and the closed trade's adherence PUT; the body file writes nothing);
 *   · Task 10 — its block body's one named write;
 *   · P2b Task 8 — lib/blocks/rulesApi.js, the rule edit (a rule's words, its note, its before-entry switch).
 * Never a whole file, never a note URL (the last case below refuses both).
 */
export const WRITE_EXCEPTIONS = {
  'app/src/pages/journal-2-0/lib/blocks/logTradeChecklist.js': [
    { method: 'PUT', url: '/api/j2/trader-blocks/positions/{}/pre-entry',
      why: 'Log Trade ticks for an OPEN position, to the adherence store under pos:<id> (R-P2-7); never a note.' },
    { method: 'PUT', url: '/api/j2/trades/{}/adherence',
      why: "Log Trade ticks for a CLOSED trade, to that trade's adherence record; never a note." },
  ],
  'app/src/pages/journal-2-0/lib/blocks/priceStampsRun.js': [
    { method: 'POST', url: '/api/j2/trader-blocks/price-stamp',
      why: 'Task 10, the price stamp: creates ONE j2_fact_observations row (the price, its source and its as-of) and never advances the note; the stamp node lands through an editor transaction (spec §P2 item 4).' },
  ],
  // P2b Task 8 (ruling R-PF-B7: the literal template, never an escaped pattern).
  'app/src/pages/journal-2-0/lib/blocks/rulesApi.js': [
    { method: 'PUT', url: '/api/j2/trader-blocks/rules/{}',
      why: 'Writes j2_journal_rules and j2_journal_rule_versions (part b Task 3), never a note.' },
  ],
}

/**
 * ④ (R-RC-6) module id -> why. A package by its own name; a source file by its repo-relative path
 * WITHOUT extension. Another file inside the block directories needs no entry: it is scanned itself.
 * Task 6's entries are below; a task whose body READS data adds the one module it reads through,
 * with the reason, in the same commit (Tasks 7, 10, 11).
 */
export const IMPORT_ALLOW = {
  react: 'components and hooks; no network',
  '@tiptap/react': "NodeViewWrapper, the editor host's node-view frame; no network",
  'app/src/pages/journal-2-0/lib/lazyChunk': "lazyLeaf: fetches the block's own CODE chunk, never data",
  'app/src/pages/journal-2-0/lib/journalBlocks': 'the block catalog (labels, search lines); a module with no imports',
  'app/src/widgets/registry': 'metadata only (paramsPlainText); imports no component and no network code',
  // R-T6-3 (fix round 2): the app's ONE chunk-load-error predicate, so a block's Reload escalation
  // never restates it. The module also reloads the page for a ROUTE's stale chunk; no data, no writes.
  'app/src/utils/lazyWithRetry': "isChunkLoadError: the app's own stale-chunk predicate; no data, no writes",
  // Task 11 (position sizing): the ONE in-repo house sizing table (IR-S10), a JSON file with no code,
  // and (R-M2-1 a) the body's ONE read seam, which replaced its three direct hook imports (useJ2Settings,
  // useJ2CurrentRegime, useJ2Accounts) so ⑤ scans what the body can reach.
  'app/src/constants/houseSizing.json': 'the house sizing table (IR-S10): plain JSON data, no code, no network',
  'app/src/pages/journal-2-0/hooks/usePositionSizingSources': 'the sizing read seam: settings only for a specific account (C-1), the account state, the regime, and two re-reads; no write function is returned',
  // Task 7: the checklist's ONE read seam. It composes the Journal's settings, selected-account and
  // rules SWR hooks and returns DATA ONLY (its return keys are pinned in useChecklistSources.test.js):
  // the save / create / dismiss writes those hooks carry never reach a block file. It fetches nothing
  // itself and is not a network module of its own.
  'app/src/pages/journal-2-0/hooks/useChecklistSources': 'the checklist read seam: setups, setupRules and before-entry rules as data only; no write function is returned',
  // Task 10 (price stamps): the block body holds a ProseMirror plugin, and the run closes the stamp's history.
  '@tiptap/pm/state': 'Plugin and PluginKey: the stamp plugin the block registers, and its pending positions; no network',
  '@tiptap/pm/history': 'closeHistory, so a stamp is its own undo step; no network',
  'app/src/pages/journal-2-0/lib/journalStylesFlag': 'journalStylesEnabled, the latched S24 switch the stamp and its body obey; reads no network',
  'app/src/lib/tickerResolver': "resolveCashtags, the line's $TICKER (a parser over a bundled JSON); no network",
  // T14 gate fix (formControls.census): the price stamps toggle is the app's ONE on/off control.
  'app/src/components/ui/Switch': 'the shared switch primitive: a button and its knob, no imports, no network, no writes',
  // P2b Task 11 (post-trade review): two GET reads through useSWR, each with a fetcher written in the block
  // file itself (so rule ① scans every request it can make), the trade page link, and the plan grade's words.
  swr: 'useSWR: cache and revalidation around a fetcher the block file writes itself, which rule ① scans; it sends nothing of its own',
  'react-router-dom': "Link: the review block's way to the trade page (navigation, no network, no writes)",
  'app/src/pages/journal-2-0/lib/planGradeText': "the plan grade's words (verdict, detail, price format): pure functions shared with the trade page's card, no imports, no network",
  // P2b Task 8 (ruling R-PF-B8): the My rules block's ONE read seam. Its write is rulesApi.js (a block
  // file, WRITE_EXCEPTIONS above); the seam hands back the rules, their state and a re-read only.
  'app/src/pages/journal-2-0/hooks/useMyRulesSources': 'the My rules read seam: the selected account\'s rules, their state, one re-read and the saved rule shown at once (an SWR cache write, never a server write); create and dismiss are unreachable (members)',
}

/**
 * N-4 (R-T6-4): modules a block file may take only NAMED exports from. `utils/lazyWithRetry`'s default
 * export reloads the page on a stale chunk, which lib/lazyChunk.js rules out for a leaf view ("NEVER A
 * PAGE RELOAD"); a block gets the predicate and nothing else. A default, a namespace, an `import()`,
 * a re-export or any other name fails by name.
 */
export const IMPORT_NAMES = {
  'app/src/utils/lazyWithRetry': ['isChunkLoadError'],
  // P2b Task 11: only what the review block uses (useSWR, Link), so `mutate` (a global cache write) or a
  // navigation hook cannot slip in under the same allow-list row.
  swr: ['default'],
  'react-router-dom': ['Link'],
}

/**
 * ⑤ R-T7-2 / I-3: a READ SEAM is an IMPORT_ALLOW entry under journal-2-0/hooks/. It lives outside the
 * block directories, so ①-④ never read it; ⑤ does, every run, for every such entry (derived from
 * IMPORT_ALLOW, so a seam is scanned the day it is allow-listed). Each seam has its OWN rules:
 *   · `imports`: the only modules it may import (problemsIn's every check runs with this list);
 *   · `members`: per hook module, the only names it may destructure from that hook's result. A hook
 *     result bound whole, spread, passed on or returned is a `REF`, so save / create / dismiss /
 *     mutate / setAccount are unreachable by construction;
 *   · and the default export returns ONE literal object, no spread, whose keys equal the seam's own
 *     exported `RETURN_KEYS` (the constant its shape test reads; never a second copy here).
 * A seam with no entry here fails closed.
 */
const J2_HOOKS = 'app/src/pages/journal-2-0/hooks/'
export const SEAM_RULES = {
  [`${J2_HOOKS}useChecklistSources`]: {
    imports: {
      react: 'useCallback and useRef (the latest refresh, H14); no network',
      [`${J2_HOOKS}useJ2Settings`]: 'SWR read of the account settings; its save is unreachable (members)',
      [`${J2_HOOKS}useJ2SelectedAccount`]: 'the selected account; its setAccount is unreachable (members)',
      [`${J2_HOOKS}useJournalRules`]: 'SWR read of the active rules; its create and dismiss are unreachable (members)',
    },
    members: {
      [`${J2_HOOKS}useJ2Settings`]: ['settings', 'isLoading', 'error', 'refresh'],
      [`${J2_HOOKS}useJ2SelectedAccount`]: ['accountId', 'isLoading', 'isAllAccounts', 'accountsError', 'accounts'],
      [`${J2_HOOKS}useJournalRules`]: ['rules', 'isLoading', 'error'],
    },
  },
  // R-M2-1 (a): the position sizing block's seam. Settings are handed on only for a specific account
  // (C-1, decided inside the seam); `refresh` of settings and of the accounts list are re-reads.
  [`${J2_HOOKS}usePositionSizingSources`]: {
    imports: {
      react: 'useCallback and useRef (the latest refreshes, H14); no network',
      [`${J2_HOOKS}useJ2Settings`]: 'SWR read of the account settings; its save is unreachable (members)',
      [`${J2_HOOKS}useJ2SelectedAccount`]: 'the selected account; its setAccount is unreachable (members)',
      [`${J2_HOOKS}useJ2Accounts`]: "the accounts list's re-read only (members)",
      [`${J2_HOOKS}useJ2CurrentRegime`]: "SWR read of today's regime (GET /api/j2/regime)",
    },
    members: {
      [`${J2_HOOKS}useJ2Settings`]: ['settings', 'isLoading', 'error', 'refresh'],
      [`${J2_HOOKS}useJ2SelectedAccount`]: ['accountId', 'isLoading', 'isAllAccounts', 'accountsError', 'accounts'],
      [`${J2_HOOKS}useJ2Accounts`]: ['refresh'],
      [`${J2_HOOKS}useJ2CurrentRegime`]: ['regime', 'isLoading', 'error'],
    },
  },
  // P2b Task 8 (ruling R-PF-B8): the My rules block's seam. `mutate` is reached only through the seam's
  // `refresh` (called with no argument: a re-read, never a cache write), held in a ref (H14).
  [`${J2_HOOKS}useMyRulesSources`]: {
    imports: {
      react: 'useCallback, useEffect and useRef (the latest re-read, written after render; H14); no network',
      [`${J2_HOOKS}useJ2SelectedAccount`]: 'the selected account; its setAccount is unreachable (members)',
      [`${J2_HOOKS}useJournalRules`]: 'SWR read of the active (and, for "All rules", dismissed) rules; create and dismiss are unreachable (members)',
      [`${J2_HOOKS}useChecklistSources`]: 'selectedAccountState only: the ONE copy of "why no account is selected"; the seam\'s hook is never called',
    },
    members: {
      [`${J2_HOOKS}useJ2SelectedAccount`]: ['accountId', 'isLoading', 'isAllAccounts', 'accountsError', 'accounts'],
      [`${J2_HOOKS}useJournalRules`]: ['rules', 'isLoading', 'error', 'mutate'],
    },
  },
}
export const seamIds = () => Object.keys(IMPORT_ALLOW).filter((id) => id.startsWith(J2_HOOKS))

const HELPER_METHOD = { jsonPost: 'POST', jsonPut: 'PUT', jsonPatch: 'PATCH', jsonDelete: 'DELETE' }
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']
const BANNED_IMPORT = /(^|\/)lib\/offline(\/|$)|journalStyles(\.js)?$/

function urlOf(arg) {
  if (!arg) return '?'
  if (arg.type === 'Literal') return String(arg.value)
  if (arg.type === 'TemplateLiteral') return arg.quasis.map((q) => q.value.cooked).join('{}')
  return '?'
}

function methodOf(opts) {
  if (!opts) return 'GET'
  if (opts.type !== 'ObjectExpression') return '?'                       // IR-I a: a variable, a call, …
  if (opts.properties.some((p) => p.type === 'SpreadElement')) return '?'
  const m = opts.properties.find((p) => (p.key?.name || p.key?.value) === 'method')
  if (!m) return 'GET'
  return m.value?.type === 'Literal' ? String(m.value.value).toUpperCase() : '?'
}

// A literal path template: /api/… segments of plain characters, `{}` standing for each ${…}.
// No '?' (the reading of a URL that could not be read), no regex metacharacter, no query string.
const LITERAL_URL = /^\/api\/(?:[A-Za-z0-9_.-]|\{\}|\/)+$/
const NOTE_URL = /^\/api\/j2\/notes(\/|$)/
// N-2 (R-T6-4): a template must not step around NOTE_URL (dot segments, empty segments) and must not
// open with a hole: `{}` stands for a whole path tail, so `/api/j2/{}` is `/api/j2/notes/1` at run time.
const DOT_OR_EMPTY = /\.\.|\/\/|\/\.(\/|$)/
const OPENS_WITH_HOLE = /^\/api\/(j2\/)?\{\}/

/** Every reason a write exception is refused ([] when it may exempt its own call). */
export function exceptionProblems(e) {
  const out = []
  if (!WRITE_METHODS.includes(e?.method)) out.push(`${e?.method} is not a write method`)
  if (typeof e?.url !== 'string' || !LITERAL_URL.test(e.url)) out.push(`${JSON.stringify(e?.url)} is not a literal URL template`)
  else {
    if (DOT_OR_EMPTY.test(e.url)) out.push(`${JSON.stringify(e.url)} has a dot segment or an empty segment`)
    if (OPENS_WITH_HOLE.test(e.url)) out.push(`${e.url} opens with {} (a whole path)`)
    if (NOTE_URL.test(e.url) || NOTE_URL.test(posix.normalize(e.url))) out.push(`${e.url} is a note URL`)
  }
  if (String(e?.why || '').length <= 20) out.push('the reason is missing or too short')
  return out
}

function exempt(exceptions, file, method, url) {
  return (exceptions[file] || []).some((e) => exceptionProblems(e).length === 0 && e.method === method && e.url === url)
}

// M-2 (fix round 1): the names that ARE a request. Each is decided only as the direct callee of a
// call (fetch, sendBeacon, the helpers) or of `new` (XMLHttpRequest, Request); any other reference
// (an alias, `.call` / `.apply`, a destructuring) cannot be decided statically and fails closed.
// N-3 (R-T6-4): WebSocket joins them (a socket can send), judged at `new` like XMLHttpRequest.
const DOOR_NAMES = new Set(['fetch', 'sendBeacon', 'XMLHttpRequest', 'Request', 'WebSocket', ...Object.keys(HELPER_METHOD)])
const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self'])

/** The name an Identifier or a member access reaches (`a.fetch`, `a['fetch']`), else undefined. */
function nameOf(n) {
  if (!n) return undefined
  if (n.type === 'Identifier') return n.name
  if (n.type === 'MemberExpression') {
    if (!n.computed) return n.property?.name
    if (n.property?.type === 'Literal') return String(n.property.value)
  }
  return undefined
}

/** Is `n` (an Identifier or member access naming a door) used as anything but the direct callee? */
function isLooseDoorReference(n, parent) {
  if (!parent) return true
  if ((parent.type === 'CallExpression' || parent.type === 'NewExpression') && parent.callee === n) return false
  if (n.type === 'Identifier') {
    if (parent.type === 'MemberExpression' && parent.property === n && !parent.computed) return false   // judged as the member
    if (parent.type === 'Property' && parent.value !== n && parent.key === n && !parent.computed) return false   // a key, not a value
    if (/^(Import|Export)\w*Specifier$/.test(parent.type)) return false                                   // ④ judges imports
    if ((parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') && parent.key === n) return false
  }
  return true
}

/** The string an import names, or null when it is computed (an `import(x)`). */
function specOf(node) {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
  return null
}

/** A package by name; a relative import as its repo-relative path without extension. */
function moduleIdOf(file, spec) {
  if (!spec.startsWith('.')) return spec
  return posix.normalize(posix.join(posix.dirname(file), spec)).replace(/\.(jsx?|mjs)$/, '')
}

function importProblem(file, spec, allow) {
  if (spec == null) return `UNLISTED ${file}: ?`                         // a computed import cannot be checked
  const id = moduleIdOf(file, spec)
  if (BANNED_IMPORT.test(spec) || BANNED_IMPORT.test(id)) return `IMPORT ${file}: ${spec}`
  if (BLOCK_DIR_RELS.some((d) => id.startsWith(d))) return null            // another block file: scanned itself
  if (Object.hasOwn(allow, id)) return null
  return `UNLISTED ${file}: ${spec}`
}

function walk(n, fn, parent = null) {
  if (!n || typeof n.type !== 'string') return
  fn(n, parent)
  for (const k of Object.keys(n)) {
    const v = n[k]
    if (Array.isArray(v)) v.forEach((c) => walk(c, fn, n))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, fn, n)
  }
}

const parse = (src) => P.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })

/** N-3: names PROVABLY a local object or array: bound exactly once in the file, by a `const` whose
 *  initialiser is an object or array literal (never a parameter, never re-bound anywhere). A computed
 *  call on anything else (`w[k](...)`) cannot be decided statically and fails closed. */
function literalLocals(ast) {
  const bindings = new Map()                       // name -> [isLiteralConst, ...]
  const bind = (name, literal) => bindings.set(name, [...(bindings.get(name) || []), literal])
  const patternNames = (p, fn) => walk(p, (x, parent) => {
    if (x.type === 'Identifier' && !(parent?.type === 'Property' && parent.key === x && parent.value !== x)
        && !(parent?.type === 'MemberExpression' && parent.property === x)) fn(x.name)
  })
  walk(ast, (n, parent) => {
    if (n.type === 'VariableDeclarator') {
      if (n.id.type === 'Identifier') {
        bind(n.id.name, parent?.kind === 'const' && ['ObjectExpression', 'ArrayExpression'].includes(n.init?.type))
      } else patternNames(n.id, (name) => bind(name, false))
    }
    if (/Function/.test(n.type)) {
      if (n.id) bind(n.id.name, false)
      for (const p of n.params) patternNames(p, (name) => bind(name, false))
    }
    if (n.type === 'CatchClause' && n.param) patternNames(n.param, (name) => bind(name, false))
    if (/^Class/.test(n.type) && n.id) bind(n.id.name, false)
  })
  return new Set([...bindings].filter(([, b]) => b.length === 1 && b[0]).map(([name]) => name))
}

/** N-3: a global object (window / globalThis / self) used as a VALUE (an alias, an argument) rather than
 *  as the object of a member access, which the member rules judge. `typeof window` is a test, not a use. */
function isLooseGlobalReference(n, parent) {
  if (parent?.type === 'MemberExpression' && parent.object === n) return false
  if (parent?.type === 'UnaryExpression' && parent.operator === 'typeof') return false
  if (parent?.type === 'CallExpression' && parent.callee === n) return true
  return isLooseDoorReference(n, parent)
}

/** N-4: the names an import / re-export of a name-limited module takes that it may not. */
function forbiddenNames(n, allowed) {
  if (n.type === 'ImportExpression') return ['import()']
  if (n.type === 'ExportAllDeclaration') return ['*']
  const out = []
  for (const s of n.specifiers || []) {
    const name = s.type === 'ImportDefaultSpecifier' ? 'default'
      : s.type === 'ImportNamespaceSpecifier' ? '*'
        : s.type === 'ImportSpecifier' ? (s.imported.name ?? s.imported.value)
          : (s.local.name ?? s.local.value)                                   // ExportSpecifier: the source's name
    if (!allowed.includes(name)) out.push(name)
  }
  return out
}

export function problemsIn(file, src, exceptions = WRITE_EXCEPTIONS, allow = IMPORT_ALLOW, names = IMPORT_NAMES) {
  const out = []
  const write = (method, url) => { if (!exempt(exceptions, file, method, url)) out.push(`WRITE ${file}: ${method} ${url}`) }
  const imported = (node) => { const p = importProblem(file, specOf(node), allow); if (p) out.push(p) }
  const ast = parse(src)
  const locals = literalLocals(ast)
  walk(ast, (n, parent) => {
    if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration'
        || (n.type === 'ExportNamedDeclaration' && n.source)) imported(n.source)
    if (n.type === 'ImportExpression') imported(n.source)
    // N-4: a name-limited module gives only its named exports
    if (['ImportDeclaration', 'ExportAllDeclaration', 'ExportNamedDeclaration', 'ImportExpression'].includes(n.type) && n.source) {
      const spec = specOf(n.source)
      const limited = spec != null ? names[moduleIdOf(file, spec)] : null
      if (limited) for (const name of forbiddenNames(n, limited)) out.push(`NAMES ${file}: ${spec} (${name})`)
    }
    // N-3: an alias of a global object
    if (n.type === 'Identifier' && GLOBAL_OBJECTS.has(n.name) && isLooseGlobalReference(n, parent)) out.push(`REF ${file}: ${n.name}`)
    if (n.type === 'NewExpression' && nameOf(n.callee) === 'WebSocket') out.push(`SOCKET ${file}`)
    // M-2: a door reached any way but as the direct callee
    if ((n.type === 'Identifier' || n.type === 'MemberExpression') && DOOR_NAMES.has(nameOf(n))
        && isLooseDoorReference(n, parent)) out.push(`REF ${file}: ${nameOf(n)}`)
    if (n.type === 'MemberExpression' && n.computed && n.property?.type !== 'Literal'
        && GLOBAL_OBJECTS.has(n.object?.name)) out.push(`REF ${file}: ${n.object.name}[?]`)
    if (n.type === 'ObjectPattern') {
      for (const p of n.properties) {
        if (p.type === 'Property' && !p.computed && DOOR_NAMES.has(p.key?.name ?? p.key?.value)) out.push(`REF ${file}: ${p.key.name ?? p.key.value}`)
      }
    }
    if (n.type === 'NewExpression' && nameOf(n.callee) === 'XMLHttpRequest') out.push(`XHR ${file}`)
    if (n.type === 'NewExpression' && nameOf(n.callee) === 'Request') {
      const method = methodOf(n.arguments[1])
      if (method !== 'GET') write(method, urlOf(n.arguments[0]))
    }
    if (n.type === 'CallExpression') {
      const callee = nameOf(n.callee)
      const c = n.callee
      // N-3: a computed call (`x[k](...)`) on anything not provably a local literal could be any function,
      // a global's fetch included. (A global object's own `window[k]` is already reported above.)
      if (c.type === 'MemberExpression' && c.computed && c.property?.type !== 'Literal'
          && !GLOBAL_OBJECTS.has(c.object?.name) && !(c.object?.type === 'Identifier' && locals.has(c.object.name))) {
        out.push(`REF ${file}: ${c.object?.type === 'Identifier' ? c.object.name : '?'}[?]()`)
      }
      if (callee === 'updateAttributes' && !file.endsWith('/useBlockParams.js')) out.push(`UPDATE ${file}`)
      if (callee === 'fetch') {
        const [u, init] = n.arguments
        if (!init) {
          // N-3: one argument that is not a URL written here could be a Request built elsewhere
          const decided = u?.type === 'Literal' || u?.type === 'TemplateLiteral'
            || (u?.type === 'NewExpression' && nameOf(u.callee) === 'Request')          // judged at its `new`
          if (!decided) write('?', '?')
        } else {
          const method = methodOf(init)
          if (method !== 'GET') write(method, urlOf(u))
        }
      }
      if (callee === 'sendBeacon') write('POST', urlOf(n.arguments[0]))
      // Own keys only: a bare `HELPER_METHOD[callee]` also answers for Object.prototype's names, so
      // `x.toLocaleString(...)` / `x.toString()` read as writes (found by Task 11's money formatter).
      if (Object.hasOwn(HELPER_METHOD, callee || '')) write(HELPER_METHOD[callee], urlOf(n.arguments[0]))
    }
  })
  return out
}

/** `walk`, with every ancestor (nearest last) instead of the parent alone. */
function walkStack(n, fn, stack = []) {
  if (!n || typeof n.type !== 'string') return
  fn(n, stack)
  stack.push(n)
  for (const k of Object.keys(n)) {
    const v = n[k]
    if (Array.isArray(v)) v.forEach((c) => walkStack(c, fn, stack))
    else if (v && typeof v === 'object' && typeof v.type === 'string') walkStack(v, fn, stack)
  }
  stack.pop()
}

const isFn = (n) => /Function/.test(n?.type || '')

/** The return arguments of `fn` itself, never of a function nested inside it. */
function ownReturns(fn) {
  if (fn.type === 'ArrowFunctionExpression' && fn.expression) return [fn.body]
  const out = []
  const visit = (n) => {
    if (!n || typeof n.type !== 'string') return
    if (n.type === 'ReturnStatement') { out.push(n.argument); return }
    for (const k of Object.keys(n)) {
      const v = n[k]
      for (const c of (Array.isArray(v) ? v : [v])) if (c && typeof c.type === 'string' && !isFn(c)) visit(c)
    }
  }
  visit(fn.body)
  return out
}

/** The seam's exported RETURN_KEYS as a string list, or null when it is not one literal list. */
function returnKeysOf(ast) {
  for (const n of ast.body) {
    if (n.type !== 'ExportNamedDeclaration' || n.declaration?.type !== 'VariableDeclaration') continue
    for (const d of n.declaration.declarations) {
      if (d.id?.name !== 'RETURN_KEYS') continue
      let arr = d.init
      if (arr?.type === 'CallExpression' && nameOf(arr.callee) === 'freeze' && arr.callee.object?.name === 'Object') arr = arr.arguments[0]
      if (arr?.type !== 'ArrayExpression' || !arr.elements.every((e) => e?.type === 'Literal' && typeof e.value === 'string')) return null
      return arr.elements.map((e) => e.value)
    }
  }
  return undefined
}

/** ⑤ Every reason a read seam fails (see SEAM_RULES). */
export function seamProblems(file, src, rule) {
  if (!rule) return [`SEAM ${file}: no SEAM_RULES entry`]
  const hookIds = Object.keys(rule.members)
  const out = problemsIn(file, src, {}, rule.imports, Object.fromEntries(hookIds.map((id) => [id, ['default']])))
  const ast = parse(src)
  const hooks = new Map()                                                     // local name -> hook module id
  for (const n of ast.body) {
    if (n.type !== 'ImportDeclaration') continue
    const id = specOf(n.source) == null ? null : moduleIdOf(file, specOf(n.source))
    if (!hookIds.includes(id)) continue
    for (const s of n.specifiers) if (s.type === 'ImportDefaultSpecifier') hooks.set(s.local.name, id)
  }
  walkStack(ast, (n, stack) => {
    if (n.type !== 'Identifier' || !hooks.has(n.name)) return
    const parent = stack[stack.length - 1]
    const grand = stack[stack.length - 2]
    if (parent && /^Import\w*Specifier$/.test(parent.type)) return
    const id = hooks.get(n.name)
    const hook = posix.basename(id)
    const destructured = parent?.type === 'CallExpression' && parent.callee === n
      && grand?.type === 'VariableDeclarator' && grand.init === parent && grand.id.type === 'ObjectPattern'
    if (!destructured) { out.push(`REF ${file}: ${hook}`); return }
    for (const p of grand.id.properties) {
      if (p.type === 'RestElement') out.push(`MEMBER ${file}: ${hook}(...rest)`)
      else if (p.computed) out.push(`MEMBER ${file}: ${hook}[?]`)
      else {
        const key = p.key?.name ?? p.key?.value
        if (!rule.members[id].includes(key)) out.push(`MEMBER ${file}: ${hook}.${key}`)
      }
    }
  })
  const keys = returnKeysOf(ast)
  if (keys === undefined) out.push(`SHAPE ${file}: no exported RETURN_KEYS`)
  if (keys === null) out.push(`SHAPE ${file}: RETURN_KEYS is not one literal list of strings`)
  const def = ast.body.find((n) => n.type === 'ExportDefaultDeclaration')?.declaration
  const fn = isFn(def) ? def
    : def?.type === 'Identifier' ? ast.body.find((n) => n.type === 'FunctionDeclaration' && n.id?.name === def.name) : null
  if (!fn) { out.push(`SHAPE ${file}: no default-exported function`); return out }
  const returns = ownReturns(fn)
  if (!returns.length) out.push(`SHAPE ${file}: no return`)
  for (const r of returns) {
    if (r?.type !== 'ObjectExpression') { out.push(`SHAPE ${file}: returns a non-literal`); continue }
    if (r.properties.some((p) => p.type === 'SpreadElement')) { out.push(`SHAPE ${file}: spread in the return`); continue }
    if (r.properties.some((p) => p.computed)) { out.push(`SHAPE ${file}: computed key in the return`); continue }
    const got = r.properties.map((p) => p.key?.name ?? p.key?.value).sort()
    if (Array.isArray(keys) && JSON.stringify(got) !== JSON.stringify([...keys].sort())) {
      out.push(`SHAPE ${file}: return keys ${got.join(',')} are not RETURN_KEYS ${[...keys].sort().join(',')}`)
    }
  }
  return out
}

/** ③'s other half: does `src` CALL updateAttributes (a call in code, never a word in a comment)? */
export function callsUpdateAttributes(src) {
  let found = false
  walk(parse(src), (n) => {
    if (n.type !== 'CallExpression') return
    const c = n.callee
    if ((c.type === 'Identifier' && c.name === 'updateAttributes')
        || (c.type === 'MemberExpression' && !c.computed && c.property?.name === 'updateAttributes')) found = true
  })
  return found
}

/** Every module id a source imports (static, re-export or a readable `import()`). */
function importedIds(file, src) {
  const ids = []
  walk(parse(src), (n) => {
    const node = n.type === 'ImportExpression' || n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration'
      || (n.type === 'ExportNamedDeclaration' && n.source) ? n.source : null
    const spec = node ? specOf(node) : null
    if (spec != null) ids.push(moduleIdOf(file, spec))
  })
  return ids
}

function files() {
  const out = []
  const walkDir = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) walkDir(p); else out.push(p) } }
  for (const d of DIRS) if (existsSync(d)) walkDir(d)
  for (const f of EXTRA) if (existsSync(f)) out.push(f)
  return out.filter((p) => /\.(js|jsx)$/.test(p) && !/\.test\.jsx?$/.test(p))
}

describe('⛔⛔ no block owns a second write door', () => {
  it('the real block files: nothing found, and the rail read them', () => {
    const fs = files()
    expect(fs.map(rel)).toContain('app/src/pages/journal-2-0/components/notebook/blocks/useBlockParams.js')
    const problems = fs.flatMap((p) => problemsIn(rel(p), readFileSync(p, 'utf8')))
    expect(problems).toEqual([])
  })
  it('③ the ONE door still exists: useBlockParams.js calls updateAttributes (in code)', () => {
    const src = readFileSync(join(REPO, 'app/src/pages/journal-2-0/components/notebook/blocks/useBlockParams.js'), 'utf8')
    expect(callsUpdateAttributes(src)).toBe(true)
  })
  it('every write exception names a file that exists AND a call in it that the exception actually exempts', () => {
    const fs = files().map(rel)
    for (const [f, list] of Object.entries(WRITE_EXCEPTIONS)) {
      expect(fs, f).toContain(f)
      const bare = problemsIn(f, readFileSync(join(REPO, f), 'utf8'), {})        // with NO exceptions
      for (const e of list) expect(bare.some((p) => p.startsWith(`WRITE ${f}: ${e.method} `)), `${f} ${e.method}`).toBe(true)
    }
  })
  it('every write exception is ONE write method, a LITERAL URL template that is never a note, with a reason', () => {
    for (const [f, list] of Object.entries(WRITE_EXCEPTIONS)) {
      for (const e of list) expect(exceptionProblems(e), `${f}: ${JSON.stringify(e)}`).toEqual([])
    }
  })
  it('④ every IMPORT_ALLOW entry is a real module that a real block file imports, and none lifts the ban', () => {
    const used = new Set(files().flatMap((p) => importedIds(rel(p), readFileSync(p, 'utf8'))))
    for (const [id, why] of Object.entries(IMPORT_ALLOW)) {
      expect(used.has(id), `IMPORT_ALLOW names ${id}, which no block file imports`).toBe(true)
      expect(String(why).length, id).toBeGreaterThan(15)
      expect(BANNED_IMPORT.test(id), `${id} is banned and cannot be allow-listed`).toBe(false)
      if (id.startsWith('app/')) {
        // a module id carries no extension; a data file (houseSizing.json) is named with its own
        const isFile = (p) => existsSync(p) && statSync(p).isFile()
        expect(isFile(join(REPO, id)) || ['.js', '.jsx'].some((x) => isFile(join(REPO, `${id}${x}`))), `${id} is not a file`).toBe(true)
      }
    }
  })
  it('CONTROL — each kind of write door, an offline import and a stray updateAttributes are each seen', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    expect(problemsIn(f, "fetch('/api/j2/notes/1', { method: 'PUT' })")).toEqual([`WRITE ${f}: PUT /api/j2/notes/1`])
    expect(problemsIn(f, 'const opts = { method: "PUT" }; fetch(u, opts)')).toEqual([`WRITE ${f}: ? ?`])
    expect(problemsIn(f, "fetch('/x', { ...o })")).toEqual([`WRITE ${f}: ? /x`])
    expect(problemsIn(f, "fetch('/x', { method: m })")).toEqual([`WRITE ${f}: ? /x`])
    expect(problemsIn(f, "navigator.sendBeacon('/api/j2/notes/1', b)")).toEqual([`WRITE ${f}: POST /api/j2/notes/1`])
    expect(problemsIn(f, "jsonPut(`/api/j2/notes/${id}`, b)")).toEqual([`WRITE ${f}: PUT /api/j2/notes/{}`])
    expect(problemsIn(f, 'new XMLHttpRequest()')).toEqual([`XHR ${f}`])
    expect(problemsIn(f, "import { settleNoteWrite } from '../../../lib/offline/settleNoteWrite'")).toHaveLength(1)
    expect(problemsIn(f, 'updateAttributes({ params: {} })')).toEqual([`UPDATE ${f}`])
    expect(problemsIn(f, "fetch('/api/j2/regime')")).toEqual([])
    expect(problemsIn(f, "fetch('/api/j2/regime', { credentials: 'include' })")).toEqual([])
    // Object.prototype's own method names are not helpers (the lookup is own-keys only)
    expect(problemsIn(f, "const s = (1).toLocaleString('en-US'); const t = x.toString(); const v = o.valueOf()")).toEqual([])
    expect(problemsIn(f, "jsonPost('/api/j2/notes', b)")).toEqual([`WRITE ${f}: POST /api/j2/notes`])
  })
  it('CONTROL — the same text inside a comment or a string is NOT a match (code, never prose)', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    expect(problemsIn(f, "// fetch('/api/j2/notes/1', { method: 'PUT' })")).toEqual([])
    expect(problemsIn(f, "/* updateAttributes({ params: {} }) */ const a = 1")).toEqual([])
    expect(problemsIn(f, "// import { x } from '../../../lib/offline/settleNoteWrite'")).toEqual([])
    expect(problemsIn(f, "const s = \"updateAttributes({}) and fetch('/x', { method: 'PUT' })\"")).toEqual([])
    expect(callsUpdateAttributes('// updateAttributes({ params })\nconst a = 1')).toBe(false)
    expect(callsUpdateAttributes('/* updateAttributes(x) */ const s = "updateAttributes(y)"')).toBe(false)
    expect(callsUpdateAttributes('updateAttributes({ params })')).toBe(true)
    expect(callsUpdateAttributes('props.updateAttributes({ params })')).toBe(true)
  })
  it('CONTROL — ④ an import outside the allow-list is seen, by name; a sibling block file and a listed module are not', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    // (a package nobody listed; `swr` was this example until the review block listed it, Task 11)
    expect(problemsIn(f, "import axios from 'axios'")).toEqual([`UNLISTED ${f}: axios`])
    expect(problemsIn(f, "import useSWR from 'swr'")).toEqual([])
    expect(problemsIn(f, "import { jsonGet } from '../../../lib/api'")).toEqual([`UNLISTED ${f}: ../../../lib/api`])
    expect(problemsIn(f, "export { x } from '../../../hooks/useJ2Trades'")).toEqual([`UNLISTED ${f}: ../../../hooks/useJ2Trades`])
    expect(problemsIn(f, "const A = () => import('../SomeEmbed')")).toEqual([`UNLISTED ${f}: ../SomeEmbed`])
    expect(problemsIn(f, 'const A = () => import(where)')).toEqual([`UNLISTED ${f}: ?`])
    expect(problemsIn(f, "import { useState } from 'react'")).toEqual([])
    expect(problemsIn(f, "import { blockLabel } from '../../../lib/journalBlocks'")).toEqual([])
    expect(problemsIn(f, "import { BlockEmpty } from './blockStates'\nimport s from './Blocks.module.css'")).toEqual([])
    expect(problemsIn(f, "const A = () => import('./PriceStampsBlock')")).toEqual([])
    // the ban outranks the allow-list: listing an offline module does not lift it
    const offline = 'app/src/pages/journal-2-0/lib/offline/settleNoteWrite'
    expect(problemsIn(f, "import { s } from '../../../lib/offline/settleNoteWrite'", {}, { [offline]: 'no' }))
      .toEqual([`IMPORT ${f}: ../../../lib/offline/settleNoteWrite`])
    // and lib/blocks files resolve the same way
    const g = 'app/src/pages/journal-2-0/lib/blocks/Y.js'
    expect(problemsIn(g, "import { blockSearch } from '../journalBlocks'")).toEqual([])
    expect(problemsIn(g, "import { patch } from '../notesApi'")).toEqual([`UNLISTED ${g}: ../notesApi`])
  })
  it('CONTROL — M-2: every other shape of a write door is seen, and the same text in a comment is not', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    // a Request object carries its own method
    expect(problemsIn(f, "fetch(new Request('/api/j2/notes/1', { method: 'PUT' }))")).toEqual([`WRITE ${f}: PUT /api/j2/notes/1`])
    expect(problemsIn(f, 'const r = new Request(u, opts)')).toEqual([`WRITE ${f}: ? ?`])
    expect(problemsIn(f, "fetch(new Request('/api/j2/regime'))")).toEqual([])            // a GET Request is a read
    // a door that is not the direct callee cannot be decided statically: it fails closed
    expect(problemsIn(f, "fetch.call(null, '/api/j2/notes/1', { method: 'PUT' })")).toEqual([`REF ${f}: fetch`])
    expect(problemsIn(f, "fetch.apply(null, ['/api/j2/notes/1', { method: 'PUT' }])")).toEqual([`REF ${f}: fetch`])
    expect(problemsIn(f, "const g = fetch; g('/api/j2/notes/1', { method: 'PUT' })")).toEqual([`REF ${f}: fetch`])
    expect(problemsIn(f, "const g = window.fetch")).toEqual([`REF ${f}: fetch`])
    // (since N-3 the destructured global is itself a loose global reference, reported beside the door)
    expect(problemsIn(f, "const { fetch: g } = globalThis")).toEqual([`REF ${f}: fetch`, `REF ${f}: globalThis`])
    expect(problemsIn(f, 'const s = navigator.sendBeacon')).toEqual([`REF ${f}: sendBeacon`])
    expect(problemsIn(f, 'const X = XMLHttpRequest')).toEqual([`REF ${f}: XMLHttpRequest`])
    expect(problemsIn(f, "window[name]('/api/j2/notes/1')")).toEqual([`REF ${f}: window[?]`])
    // a computed but LITERAL global member is decided like the plain call
    expect(problemsIn(f, "globalThis['fetch']('/api/j2/notes/1', { method: 'PUT' })")).toEqual([`WRITE ${f}: PUT /api/j2/notes/1`])
    expect(problemsIn(f, "window['fetch']('/api/j2/notes/1', { method: 'PUT' })")).toEqual([`WRITE ${f}: PUT /api/j2/notes/1`])
    expect(problemsIn(f, "window['fetch']('/api/j2/regime')")).toEqual([])
    expect(problemsIn(f, "window.fetch('/api/j2/regime')")).toEqual([])
    // not references: a property NAMED fetch on an object literal
    expect(problemsIn(f, 'const o = { fetch: 1, sendBeacon: 2 }')).toEqual([])
    // the commented forms are never matches
    expect(problemsIn(f, [
      "// fetch(new Request('/api/j2/notes/1', { method: 'PUT' }))",
      "// fetch.call(null, '/api/j2/notes/1', { method: 'PUT' })",
      "/* fetch.apply(null, ['/x', { method: 'PUT' }]) */",
      '// const g = fetch; g(u, { method: "PUT" })',
      "/* globalThis['fetch']('/api/j2/notes/1', { method: 'PUT' }) */ const k = 1",
      "// window['fetch']('/api/j2/notes/1', { method: 'PUT' })",
    ].join('\n'))).toEqual([])
  })
  it('CONTROL — M-1: an exception URL is a LITERAL template; a broad, regex-shaped or note URL is refused', () => {
    const why = 'a reason long enough to be a reason'
    for (const url of ['\\?', '[^n].*', '.*', '?', '/api/j2/.*', '/api/j2/trades/\\d+', '/api/j2/trades/{}/a|b', '']) {
      expect(exceptionProblems({ method: 'PUT', url, why }), JSON.stringify(url)).not.toEqual([])
    }
    expect(exceptionProblems({ method: 'PUT', url: '/api/j2/trades/{}/adherence', why })).toEqual([])
    expect(exceptionProblems({ method: 'PUT', url: '/api/j2/notes/{}', why })).toEqual(['/api/j2/notes/{} is a note URL'])
    expect(exceptionProblems({ method: 'GET', url: '/api/j2/trades/{}', why })).toEqual(['GET is not a write method'])
    expect(exceptionProblems({ method: 'PUT', url: '/api/j2/trades/{}', why: 'x' })).toEqual(['the reason is missing or too short'])
    // matching is literal: an entry exempts its own template and nothing else
    const f = 'app/src/pages/journal-2-0/lib/blocks/Y.js'
    const ex = { [f]: [{ method: 'PUT', url: '/api/j2/trades/{}/adherence', why }] }
    expect(problemsIn(f, "fetch(`/api/j2/trades/${id}/adherence`, { method: 'PUT' })", ex)).toEqual([])
    expect(problemsIn(f, "fetch('/api/j2/trades/7/adherence', { method: 'PUT' })", ex)).toHaveLength(1)
    // and a broad entry exempts NOTHING, even when a test hands it straight to problemsIn
    const broad = { [f]: [{ method: 'PUT', url: '?', why }] }
    expect(problemsIn(f, "fetch(u, { method: 'PUT' })", broad)).toEqual([`WRITE ${f}: PUT ?`])
  })
  it('CONTROL — N-2: a literal template that is broad, or that steps around the note refusal, is refused', () => {
    const why = 'a reason long enough to be a reason'
    for (const url of ['/api/{}', '/api/j2/{}', '/api/j2/{}/adherence', '/api//j2/notes/{}', '/api/j2/x/../notes/{}',
      '/api/j2/./notes/{}', '/api/j2/trades//{}', '/api/j2/trades/{}/..']) {
      expect(exceptionProblems({ method: 'PUT', url, why }), url).not.toEqual([])
    }
    expect(exceptionProblems({ method: 'PUT', url: '/api/j2/x/../notes/{}', why }))
      .toEqual(['"/api/j2/x/../notes/{}" has a dot segment or an empty segment', '/api/j2/x/../notes/{} is a note URL'])
    expect(exceptionProblems({ method: 'PUT', url: '/api/j2/{}', why })).toEqual(['/api/j2/{} opens with {} (a whole path)'])
    // control: a narrow template still passes
    expect(exceptionProblems({ method: 'PUT', url: '/api/j2/trades/{}/adherence', why })).toEqual([])
  })
  it('CONTROL — N-3: an aliased or passed-in global, a one-argument fetch of a non-literal and a WebSocket fail closed', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    expect(problemsIn(f, "const w = window; w[k]('/api/j2/notes/1', { method: 'PUT' })"))
      .toEqual([`REF ${f}: window`, `REF ${f}: w[?]()`])
    expect(problemsIn(f, 'const g = globalThis')).toEqual([`REF ${f}: globalThis`])
    expect(problemsIn(f, "const run = (w, k) => w[k]('/api/j2/notes/1', { method: 'PUT' })")).toEqual([`REF ${f}: w[?]()`])
    expect(problemsIn(f, 'const run = (o, k) => o?.[k]()')).toEqual([`REF ${f}: o[?]()`])
    expect(problemsIn(f, 'fetch(req)')).toEqual([`WRITE ${f}: ? ?`])
    expect(problemsIn(f, 'fetch(props.request)')).toEqual([`WRITE ${f}: ? ?`])
    expect(problemsIn(f, "new WebSocket('wss://x')")).toEqual([`SOCKET ${f}`])
    expect(problemsIn(f, 'const S = WebSocket')).toEqual([`REF ${f}: WebSocket`])
    // provably local, and reads, stay clean
    expect(problemsIn(f, "const H = { a: () => 1 }; const run = (k) => H[k]()")).toEqual([])
    expect(problemsIn(f, "const L = [() => 1]; L[i]()")).toEqual([])
    expect(problemsIn(f, "fetch('/api/j2/regime')")).toEqual([])
    expect(problemsIn(f, 'fetch(`/api/j2/trades/${id}`)')).toEqual([])
    expect(problemsIn(f, 'window.location.reload()')).toEqual([])
    expect(problemsIn(f, "const n = window.navigator.onLine; const v = window['innerWidth']")).toEqual([])
    // the near-names a real body uses are not doors
    expect(problemsIn(f, [
      'const { refetch, isFetching, fetchedAt } = q',
      'refetch()',
      'const t = row.fetchedAt; const busy = params.isFetching; const r = q.refetch',
    ].join('\n'))).toEqual([])
    // commented forms are never matches
    expect(problemsIn(f, [
      "// const w = window; w[k]('/api/j2/notes/1', { method: 'PUT' })",
      '/* fetch(req) */',
      "// new WebSocket('wss://x')",
      'const k = 1',
    ].join('\n'))).toEqual([])
  })
  it('CONTROL — N-4: utils/lazyWithRetry gives a block file ONLY the named isChunkLoadError', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    const m = '../../../../../utils/lazyWithRetry'
    expect(problemsIn(f, `import { isChunkLoadError } from '${m}'`)).toEqual([])
    expect(problemsIn(f, `import { isChunkLoadError as isChunk } from '${m}'`)).toEqual([])
    expect(problemsIn(f, `import lazyWithRetry from '${m}'`)).toEqual([`NAMES ${f}: ${m} (default)`])
    expect(problemsIn(f, `import lazyWithRetry, { isChunkLoadError } from '${m}'`)).toEqual([`NAMES ${f}: ${m} (default)`])
    expect(problemsIn(f, `import { isChunkLoadError, RELOAD_FLAG } from '${m}'`)).toEqual([`NAMES ${f}: ${m} (RELOAD_FLAG)`])
    expect(problemsIn(f, `import * as L from '${m}'`)).toEqual([`NAMES ${f}: ${m} (*)`])
    expect(problemsIn(f, `const L = () => import('${m}')`)).toEqual([`NAMES ${f}: ${m} (import())`])
    expect(problemsIn(f, `export { default } from '${m}'`)).toEqual([`NAMES ${f}: ${m} (default)`])
    expect(problemsIn(f, `// import lazyWithRetry from '${m}'\nconst k = 1`)).toEqual([])
    // every name-limited module is also an allow-listed one
    for (const id of Object.keys(IMPORT_NAMES)) expect(Object.hasOwn(IMPORT_ALLOW, id), id).toBe(true)
  })
  it('CONTROL — P2b Task 11: swr gives a block only useSWR, react-router-dom only Link', () => {
    const f = 'app/src/pages/journal-2-0/components/notebook/blocks/X.jsx'
    expect(problemsIn(f, "import useSWR from 'swr'")).toEqual([])
    expect(problemsIn(f, "import { mutate } from 'swr'")).toEqual([`NAMES ${f}: swr (mutate)`])
    expect(problemsIn(f, "import useSWR, { mutate } from 'swr'")).toEqual([`NAMES ${f}: swr (mutate)`])
    expect(problemsIn(f, "import { Link } from 'react-router-dom'")).toEqual([])
    expect(problemsIn(f, "import { Link, useNavigate } from 'react-router-dom'")).toEqual([`NAMES ${f}: react-router-dom (useNavigate)`])
    expect(problemsIn(f, "import * as R from 'react-router-dom'")).toEqual([`NAMES ${f}: react-router-dom (*)`])
  })
  it('⑤ every read seam (an IMPORT_ALLOW entry under hooks/) is scanned with its OWN rules: nothing found', () => {
    const seams = seamIds()
    expect(seams).toContain(`${J2_HOOKS}useChecklistSources`)                    // non-vacuity
    expect(seams).toContain(`${J2_HOOKS}usePositionSizingSources`)
    expect(seams).toContain(`${J2_HOOKS}useMyRulesSources`)
    for (const id of seams) {
      const p = `${id}.js`
      expect(existsSync(join(REPO, p)), `${p} is not a file`).toBe(true)
      expect(seamProblems(p, readFileSync(join(REPO, p), 'utf8'), SEAM_RULES[id]), id).toEqual([])
    }
    // and no rules entry is left over for a seam the allow-list no longer names
    for (const id of Object.keys(SEAM_RULES)) expect(seams, id).toContain(id)
  })
  it('⑤ each seam\'s shape test reads the seam\'s own RETURN_KEYS (one copy of the shape)', () => {
    for (const id of seamIds()) {
      const t = join(REPO, `${id}.test.js`)
      expect(existsSync(t), `${id}.test.js`).toBe(true)
      const names = []
      walk(parse(readFileSync(t, 'utf8')), (n) => {
        if (n.type === 'ImportDeclaration' && moduleIdOf(rel(t), String(n.source.value)) === id) {
          for (const s of n.specifiers) if (s.type === 'ImportSpecifier') names.push(s.imported.name)
        }
      })
      expect(names, id).toContain('RETURN_KEYS')
    }
  })
  it('CONTROL — ⑤ a seam that reaches a write, an unlisted module or an open return is seen, by name', () => {
    const f = `${J2_HOOKS}useChecklistSources.js`
    const rule = SEAM_RULES[`${J2_HOOKS}useChecklistSources`]
    const seam = (body, extra = '') => [
      "import { useCallback, useEffect } from 'react'",
      "import useJ2Settings from './useJ2Settings'",
      "import useJournalRules from './useJournalRules'",
      extra,
      "export const RETURN_KEYS = Object.freeze(['settings', 'rules'])",
      'export default function useX() {',
      body,
      '}',
    ].join('\n')
    const CLEAN = "  const { settings, refresh } = useJ2Settings()\n  const { rules } = useJournalRules(null)\n  return { settings, rules }"
    expect(seamProblems(f, seam(CLEAN), rule)).toEqual([])
    // destructuring a write
    expect(seamProblems(f, seam(CLEAN.replace('settings, refresh', 'settings, save')), rule))
      .toEqual([`MEMBER ${f}: useJ2Settings.save`])
    // the whole result bound, then returned
    expect(seamProblems(f, seam("  const s = useJ2Settings()\n  const { rules } = useJournalRules(null)\n  return s"), rule))
      .toEqual([`REF ${f}: useJ2Settings`, `SHAPE ${f}: returns a non-literal`])
    // a spread return
    expect(seamProblems(f, seam("  const { settings } = useJ2Settings()\n  return { settings, ...useJournalRules(null) }"), rule))
      .toEqual([`REF ${f}: useJournalRules`, `SHAPE ${f}: spread in the return`])
    // an import outside the seam's own list
    expect(seamProblems(f, seam(CLEAN, "import { jsonPut } from '../lib/api'"), rule)).toEqual([`UNLISTED ${f}: ../lib/api`])
    // a PUT fetch inside the hook
    expect(seamProblems(f, seam(`${CLEAN.replace('  return', "  useEffect(() => { fetch('/api/j2/x', { method: 'PUT' }) }, [])\n  return")}`), rule))
      .toEqual([`WRITE ${f}: PUT /api/j2/x`])
    // a rest element, a renamed member, a key the shape does not declare, a named import of a hook
    expect(seamProblems(f, seam(CLEAN.replace('settings, refresh', 'settings, ...rest')), rule)).toEqual([`MEMBER ${f}: useJ2Settings(...rest)`])
    expect(seamProblems(f, seam(CLEAN.replace('settings, refresh', 'settings, mutate: m')), rule)).toEqual([`MEMBER ${f}: useJ2Settings.mutate`])
    expect(seamProblems(f, seam(CLEAN.replace('{ settings, rules }', '{ settings, rules, extra: 1 }')), rule))
      .toEqual([`SHAPE ${f}: return keys extra,rules,settings are not RETURN_KEYS rules,settings`])
    expect(seamProblems(f, seam(CLEAN, "import { mutate } from './useJ2Settings'"), rule)).toEqual([`NAMES ${f}: ./useJ2Settings (mutate)`])
    // no rules entry at all fails closed
    expect(seamProblems(f, seam(CLEAN), undefined)).toEqual([`SEAM ${f}: no SEAM_RULES entry`])
    // the same text inside comments is never seen
    expect(seamProblems(f, seam(CLEAN, [
      '// const { settings, save } = useJ2Settings()',
      '/* return { ...useJournalRules(id) } */',
      "// import { jsonPut } from '../lib/api'",
      "// fetch('/api/j2/x', { method: 'PUT' })",
      '/* const s = useJ2Settings(); return s */',
    ].join('\n')), rule)).toEqual([])
  })
  it('CONTROL — ⑤ the sizing seam: a writer, an unlisted member or an unlisted hook is seen, by name', () => {
    const f = `${J2_HOOKS}usePositionSizingSources.js`
    const rule = SEAM_RULES[`${J2_HOOKS}usePositionSizingSources`]
    const seam = (body, extra = '') => [
      "import useJ2Settings from './useJ2Settings'",
      "import useJ2SelectedAccount from './useJ2SelectedAccount'",
      "import useJ2Accounts from './useJ2Accounts'",
      extra,
      "export const RETURN_KEYS = Object.freeze(['settings', 'accountId'])",
      'export default function useX() {',
      body,
      '}',
    ].join('\n')
    const CLEAN = "  const { settings, refresh } = useJ2Settings()\n  const { accountId } = useJ2SelectedAccount()\n"
      + "  const { refresh: r } = useJ2Accounts()\n  return { settings, accountId }"
    expect(seamProblems(f, seam(CLEAN), rule)).toEqual([])
    expect(seamProblems(f, seam(CLEAN.replace('settings, refresh', 'settings, save')), rule))
      .toEqual([`MEMBER ${f}: useJ2Settings.save`])
    expect(seamProblems(f, seam(CLEAN.replace('{ accountId }', '{ accountId, setAccount }')), rule))
      .toEqual([`MEMBER ${f}: useJ2SelectedAccount.setAccount`])
    expect(seamProblems(f, seam(CLEAN.replace('{ refresh: r }', '{ refresh: r, accounts }')), rule))
      .toEqual([`MEMBER ${f}: useJ2Accounts.accounts`])
    expect(seamProblems(f, seam(CLEAN, "import useJournalRules from './useJournalRules'"), rule))
      .toEqual([`UNLISTED ${f}: ./useJournalRules`])
    expect(seamProblems(f, seam(CLEAN, '// const { save } = useJ2Settings()'), rule)).toEqual([])
  })
  it('CONTROL — ⑤ the My rules seam (P2b Task 8): create, dismiss or the whole hook result are seen, by name', () => {
    const f = `${J2_HOOKS}useMyRulesSources.js`
    const rule = SEAM_RULES[`${J2_HOOKS}useMyRulesSources`]
    const seam = (body, extra = '') => [
      "import useJ2SelectedAccount from './useJ2SelectedAccount'",
      "import useJournalRules from './useJournalRules'",
      "import { selectedAccountState } from './useChecklistSources'",
      extra,
      "export const RETURN_KEYS = Object.freeze(['rules', 'refresh'])",
      'export default function useX() {',
      body,
      '}',
    ].join('\n')
    const CLEAN = "  const { accountId } = useJ2SelectedAccount()\n  const { rules, mutate } = useJournalRules(accountId)\n"
      + '  const s = selectedAccountState({ accountId })\n  return { rules, refresh: mutate }'
    expect(seamProblems(f, seam(CLEAN), rule)).toEqual([])
    expect(seamProblems(f, seam(CLEAN.replace('{ rules, mutate }', '{ rules, mutate, create }')), rule))
      .toEqual([`MEMBER ${f}: useJournalRules.create`])
    expect(seamProblems(f, seam(CLEAN.replace('{ rules, mutate }', '{ rules, dismiss: d }')), rule))
      .toEqual([`MEMBER ${f}: useJournalRules.dismiss`])
    expect(seamProblems(f, seam(CLEAN.replace('const { rules, mutate } = useJournalRules(accountId)', 'const r = useJournalRules(accountId); const { rules, mutate } = r')), rule))
      .toEqual([`REF ${f}: useJournalRules`])
    expect(seamProblems(f, seam(CLEAN, "import useJ2Settings from './useJ2Settings'"), rule)).toEqual([`UNLISTED ${f}: ./useJ2Settings`])
    expect(seamProblems(f, seam(CLEAN, '// const { create } = useJournalRules(accountId)'), rule)).toEqual([])
  })
  it("CONTROL — Task 10's write: the /price capture's note URL is refused, its own route is exempt and nothing else", () => {
    const why = 'a reason long enough to be a reason'
    expect(exceptionProblems({ method: 'POST', url: '/api/j2/notes/{}/facts', why })).toEqual(['/api/j2/notes/{}/facts is a note URL'])
    const f = 'app/src/pages/journal-2-0/lib/blocks/priceStampsRun.js'
    expect(problemsIn(f, "fetch('/api/j2/trader-blocks/price-stamp', { method: 'POST' })")).toEqual([])
    expect(problemsIn(f, "fetch('/api/j2/trader-blocks/price-stamp', { method: 'PUT' })")).toEqual([`WRITE ${f}: PUT /api/j2/trader-blocks/price-stamp`])
    expect(problemsIn(f, "fetch(`/api/j2/notes/${id}/facts`, { method: 'POST' })")).toEqual([`WRITE ${f}: POST /api/j2/notes/{}/facts`])
    const g = 'app/src/pages/journal-2-0/lib/blocks/priceStamps.js'                     // the exception is per FILE
    expect(problemsIn(g, "fetch('/api/j2/trader-blocks/price-stamp', { method: 'POST' })")).toEqual([`WRITE ${g}: POST /api/j2/trader-blocks/price-stamp`])
  })
  it('CONTROL — an exception is method+URL, never the whole file (IR-I b)', () => {
    const f = 'app/src/pages/journal-2-0/lib/blocks/Y.js'
    const ex = { [f]: [{ method: 'PUT', url: '/api/j2/trades/{}/adherence', why: 'a reason long enough to be a reason' }] }
    expect(problemsIn(f, "fetch(`/api/j2/trades/${id}/adherence`, { method: 'PUT' })", ex)).toEqual([])
    expect(problemsIn(f, "fetch(`/api/j2/notes/${id}`, { method: 'PUT' })", ex)).toEqual([`WRITE ${f}: PUT /api/j2/notes/{}`])
    expect(problemsIn(f, "fetch(`/api/j2/trades/${id}/adherence`, { method: 'DELETE' })", ex)).toHaveLength(1)
  })
})

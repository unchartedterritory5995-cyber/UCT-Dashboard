// app/src/components/chart/engine/ast/pineLibraries.js
//
// ─── ⭐⭐ `import Author/Library/Version as alias` — THE LIBRARY LINKER ─────────
//
// A Pine script may import a published library and call its exported functions
// as `alias.fn(...)`. Both chart lanes (the host translator, `pine.js`, and the
// runtime front end, `pineRuntimeFrontend.js`) already compile a script's OWN
// user functions, types and methods. This module makes an imported function the
// same thing: it splices the library's own definitions into the script's TOKEN
// STREAM, right where the `import` line stood, under names nobody can write, and
// rewrites every `alias.X` the script wrote to that name. Neither lane learns a
// new construct — they compile one script, as they always have.
//
// ⛔⛔ THE LIBRARY'S SOURCE IS NEVER IN THIS REPOSITORY. It comes from the server's
// library store (`api/services/pine_library_store.py`) through the client-side
// registry (`pineLibraryStore.js`), or from the caller (`opts.libraries`). This
// module holds only the linker.
//
// What is spliced, and what is not — the rule TradingView's own compiler follows:
//
//   KEPT     every function, `method`, `type` and `enum` the script REACHES (from
//            the `alias.X` it calls, transitively through the library's own calls),
//            and the plain top-level values those definitions read.
//   DROPPED  the `library(...)` declaration, and everything else at the library's
//            top level — its demo `plot`s, inputs, `if` blocks. An importing script
//            never runs a library's top-level code; it only calls its exports.
//
// Exact by construction, and railed bar for bar (`pineLibraries.test.js`): a script
// calling `mylib.f(x)` compiles to the same program as the script with `f` pasted
// in, in BOTH lanes.
//
// ⛔ WHAT IS REFUSED, BY NAME, WITH THE IMPORT LINE (never served on a guess):
//   · a library the registry does not hold            — the member is told which
//   · a library in a different Pine version than the  — v5 code read under v6 rules
//     script (Pine runs each at its own version; this     is a different program
//     engine compiles one program at one version)
//   · a library that declares a local with the name   — renaming would capture it
//     of one of its own top-level values or types
//   · a kept top-level value the library keeps across — `var`/`varip`, or one its
//     bars or reassigns at its top level                  top-level code reassigns
//   · an import cycle, or a library that does not declare `library(...)`
//
// POSITIONS. The script's own tokens keep every line, column and index they had,
// so every refusal, excerpt and parameter id in the script is untouched. Library
// tokens get LINES past the script's last line (the indent table is extended to
// match) and FRACTIONAL indices inside the gap the removed `import` line left, so
// token order — which the walk's binary-searched statement log depends on — is the
// order the statements run in. `remapLibraryLocation` turns a library line back
// into the member's import line plus "in library X, line L".

import { pineLibraryEntry } from './pineLibraryStore.js'

export { importPathsOf } from './pineLibraryStore.js'

/** `import A/B/7 as x` — the tokens the lexer makes of it. */
function parseImport(toks) {
  // import  A  /  B  /  7  [as  alias]
  const t = toks
  const ok = t.length >= 6
    && t[0].kind === 'ident' && t[0].value === 'import'
    && t[1].kind === 'ident' && !String(t[1].value).includes('.')
    && t[2].kind === 'punct' && t[2].value === '/'
    && t[3].kind === 'ident' && !String(t[3].value).includes('.')
    && t[4].kind === 'punct' && t[4].value === '/'
    && t[5].kind === 'number' && Number.isInteger(t[5].value) && t[5].value > 0
  if (!ok) return null
  let alias = String(t[3].value)
  if (t.length === 8 && t[6].kind === 'ident' && t[6].value === 'as' && t[7].kind === 'ident'
    && !String(t[7].value).includes('.')) {
    alias = String(t[7].value)
  } else if (t.length !== 6) {
    return null
  }
  return {
    author: String(t[1].value),
    name: String(t[3].value),
    version: t[5].value,
    path: `${t[1].value}/${t[3].value}/${t[5].value}`,
    alias,
  }
}

/** Every top-level `import` line of a token stream: `{start, end, imp, tok}` where
 *  `[start, end)` is the line's token range. A line that starts with `import` but
 *  is not a well-formed import is returned with `imp: null`, so the lanes' own
 *  refusal still fires on it. */
export function importLinesOf(tokens, indents) {
  const out = []
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i]
    if (tok.kind !== 'ident' || tok.value !== 'import') continue
    if (i > 0 && tokens[i - 1].line === tok.line) continue
    if ((indents[tok.line - 1] || 0) !== 0) continue
    let j = i
    while (j < tokens.length && tokens[j].line === tok.line) j += 1
    out.push({ start: i, end: j, imp: parseImport(tokens.slice(i, j)), tok })
  }
  return out
}

const isPunct = (t, v) => !!t && t.kind === 'punct' && t.value === v
const headOf = (v) => String(v).split('.')[0]
const isWord = (t, v) => !!t && t.kind === 'ident' && t.value === v
const STATE_WORDS = new Set(['var', 'varip'])

/** Thrown inside the linker; becomes the reason the import line is refused for. */
class LinkRefusal extends Error {}

function topFindEq(toks) {
  let depth = 0
  for (let i = 0; i < toks.length; i += 1) {
    const t = toks[i]
    if (t.kind === 'punct') {
      if (t.value === '(' || t.value === '[') depth += 1
      else if (t.value === ')' || t.value === ']') depth -= 1
      else if (t.value === '=' && depth === 0) return i
      else if (t.value === '=>' && depth === 0) return -1
    }
  }
  return -1
}

/** What one top-level statement of a library declares. */
function classify(stmt) {
  let h = stmt.header
  let exported = false
  if (isWord(h[0], 'export')) { exported = true; h = h.slice(1) }
  const first = h[0]
  if (!first) return { kind: 'other', h, exported }
  if (first.kind === 'ident' && first.value === 'library' && isPunct(h[1], '(')) return { kind: 'library', h, exported }
  if (first.kind === 'ident' && first.value === 'import') return { kind: 'import', h, exported }
  if (first.kind === 'ident' && first.value === 'method' && h[1] && h[1].kind === 'ident') {
    return { kind: 'method', name: String(h[1].value), h, exported }
  }
  if (first.kind === 'ident' && (first.value === 'type' || first.value === 'enum') && h[1]
    && h[1].kind === 'ident' && !String(h[1].value).includes('.') && !isPunct(h[2], '=')) {
    return { kind: first.value, name: String(h[1].value), h, exported }
  }
  if (first.kind === 'ident' && !String(first.value).includes('.') && isPunct(h[1], '(')) {
    // `f(a, b) =>` — the parameter list's closing paren is followed by the arrow
    let d = 0
    for (let i = 1; i < h.length; i += 1) {
      if (isPunct(h[i], '(') || isPunct(h[i], '[')) d += 1
      else if (isPunct(h[i], ')') || isPunct(h[i], ']')) {
        d -= 1
        if (d === 0) {
          if (isPunct(h[i + 1], '=>')) return { kind: 'fn', name: String(first.value), h, exported }
          break
        }
      }
    }
  }
  const eq = topFindEq(h)
  if (eq > 0) {
    const nameTok = h[eq - 1]
    if (nameTok && nameTok.kind === 'ident' && !String(nameTok.value).includes('.')) {
      const state = STATE_WORDS.has(first.value)
      return { kind: 'value', name: String(nameTok.value), h, exported, state }
    }
  }
  return { kind: 'other', h, exported }
}

const tokensOf = (stmt) => [...stmt.header, ...stmt.body]

/** The names a definition DECLARES for itself — parameters, locals, loop
 *  variables, tuple targets — each with the position (in `tokensOf(stmt)`) of its
 *  first declaration and that token. Pine scoping, read positionally: a reference
 *  to `X` before the definition declares `X` is the library's top-level `X`; at or
 *  after it, the local. A value or type has no locals. */
function localsOf(def) {
  const out = new Map()
  if (def.kind !== 'fn' && def.kind !== 'method') return out
  const all = tokensOf(def.stmt)
  const add = (i) => {
    const t = all[i]
    if (t && t.kind === 'ident' && !t.member && !String(t.value).includes('.') && !out.has(String(t.value))) {
      out.set(String(t.value), { pos: i, tok: t })
    }
  }
  const headerLen = def.stmt.header.length
  // parameters: the header's first (...) group
  const open = all.findIndex((t, i) => i < headerLen && isPunct(t, '('))
  if (open >= 0) {
    let depth = 0
    for (let i = open; i < headerLen; i += 1) {
      const t = all[i]
      if (isPunct(t, '(') || isPunct(t, '[')) { depth += 1; continue }
      if (isPunct(t, ')') || isPunct(t, ']')) {
        if (depth === 1 && isPunct(t, ')')) { if (!isPunct(all[i - 1], '(')) add(i - 1); break }
        depth -= 1; continue
      }
      if (depth === 1 && (isPunct(t, ',') || isPunct(t, '='))) {
        add(i - 1)
        if (isPunct(t, '=')) {
          let d = 0
          while (i + 1 < headerLen) {
            const n = all[i + 1]
            if (isPunct(n, '(') || isPunct(n, '[')) d += 1
            else if (isPunct(n, ')') || isPunct(n, ']')) { if (d === 0) break; d -= 1 } else if (d === 0 && isPunct(n, ',')) break
            i += 1
          }
        }
      }
    }
  }
  // locals, loop variables, tuple destructures: `name =` at bracket depth 0
  let depth = 0
  for (let i = headerLen; i < all.length; i += 1) {
    const t = all[i]
    if (isPunct(t, '(') || isPunct(t, '[')) { depth += 1; continue }
    if (isPunct(t, ')') || isPunct(t, ']')) { depth = Math.max(0, depth - 1); continue }
    if (depth === 0 && isPunct(t, '=') && i > headerLen) {
      if (isPunct(all[i - 1], ']')) {
        for (let k = i - 2; k > headerLen && !isPunct(all[k], '['); k -= 1) add(k)
      } else add(i - 1)
    }
    if (isWord(t, 'for') && all[i + 1]) {
      if (isPunct(all[i + 1], '[')) {
        for (let k = i + 2; k < all.length && !isPunct(all[k], ']'); k += 1) add(k)
      } else add(i + 1)
    }
  }
  return out
}

/** The positions (in `tokensOf(stmt)`) of a `type`'s or `enum`'s FIELD NAMES —
 *  declarations, never references to a top-level name. A `type` field line is
 *  `<type> <name> [= default]`; an `enum` field line is `<name> [= "title"]`. */
function fieldNamePositions(def) {
  const out = new Set()
  if (def.kind !== 'type' && def.kind !== 'enum') return out
  // ⚠️ a declaration's field lines are NOT a block to `blockStatements` (no
  // opener), so they arrive as a continuation of the header: start at the first
  // token past the declaration's own line.
  const all = tokensOf(def.stmt)
  let i = all.findIndex((t) => t.line !== all[0].line)
  if (i < 0) return out
  while (i < all.length) {
    const line = all[i].line
    let j = i
    while (j < all.length && all[j].line === line) j += 1
    if (def.kind === 'enum') out.add(i)
    else {
      const eq = all.slice(i, j).findIndex((t) => isPunct(t, '='))
      out.add(eq > 0 ? i + eq - 1 : j - 1)
    }
    i = j
  }
  return out
}

/** Is the token at `i` of `def` a reference to the definition's own local? */
function isLocalRef(locals, name, i) {
  const l = locals.get(name)
  return !!l && i >= l.pos
}

/** The linker. `lexPine` and `blockStatements` are passed in (they live in
 *  `pine.js`, which imports this module). Returns the lexed record with library
 *  tokens spliced in, plus `libraries` (what was linked, for the member's licence
 *  notice and for location remapping); or the input unchanged when it imports
 *  nothing. Never throws: a library that cannot be linked leaves its `import` line
 *  in place with `libraryRefusal` on its first token, and the lane refuses it. */
export function linkLibraries(lexed, opts, { lexPine, blockStatements }) {
  const { tokens, indents } = lexed
  const lines = importLinesOf(tokens, indents)
  if (!lines.length) return lexed
  const resolve = resolverOf(opts)
  const mainVersion = lexed.version
  const mainLineCount = (lexed.lines || []).length

  const linked = new Map() // path -> unit
  let nextLine = mainLineCount + 1
  const extraIndents = []
  const extraLines = []
  const libraries = []

  /** Link one library (and, first, what it imports). Returns its unit. */
  const link = (imp, needed, stack) => {
    if (stack.includes(imp.path)) throw new LinkRefusal(`the libraries import each other in a cycle (${[...stack, imp.path].join(' → ')})`)
    const entry = resolve(imp.path)
    if (!entry || typeof entry.source !== 'string') {
      throw new LinkRefusal(`the library \`${imp.path}\` is not in this engine's library registry, so its code cannot be compiled`)
    }
    let unit = linked.get(imp.path)
    if (!unit) {
      let lib
      try { lib = lexPine(entry.source) } catch (err) {
        throw new LinkRefusal(`the library \`${imp.path}\` could not be read (${err && err.message ? err.message : err})`)
      }
      if (lib.version !== mainVersion) {
        throw new LinkRefusal(`the library \`${imp.path}\` is written in Pine v${lib.version} and this script in v${mainVersion}; TradingView runs each at its own version and this engine compiles one program at one version`)
      }
      const stmts = blockStatements(lib.tokens, lib.indents, 0)
      const defs = stmts.map((s) => ({ stmt: s, ...classify(s) }))
      if (!defs.some((d) => d.kind === 'library')) {
        throw new LinkRefusal(`\`${imp.path}\` does not declare \`library()\``)
      }
      unit = { imp, entry, lib, defs, id: linked.size, nested: new Map(), emitted: false, keep: new Set() }
      linked.set(imp.path, unit)
      // its own imports, linked first so their tokens precede this library's
      for (const d of defs) {
        if (d.kind !== 'import') continue
        const nimp = parseImport(d.h)
        if (!nimp) throw new LinkRefusal(`\`${imp.path}\` has an \`import\` line this engine cannot read`)
        unit.nested.set(nimp.alias, nimp)
      }
    }
    // what this caller needs, closed over the library's own references
    reach(unit, needed, stack)
    return unit
  }

  const mangle = (unit, name) => `__lib${unit.id}_${name}`

  /** Grow `unit.keep` from `needed` (names) to everything those reach. */
  const reach = (unit, needed, stack) => {
    const byName = new Map()
    for (const d of unit.defs) {
      if (!d.name || d.kind === 'import' || d.kind === 'library' || d.kind === 'other') continue
      if (!byName.has(d.name)) byName.set(d.name, [])
      byName.get(d.name).push(d)
    }
    const queue = [...needed]
    const seenNames = new Set()
    const methodNames = new Set()
    for (const d of unit.defs) if (d.kind === 'method') methodNames.add(d.name)
    const nestedNeeds = new Map()
    while (queue.length) {
      const name = queue.shift()
      if (seenNames.has(name)) continue
      seenNames.add(name)
      for (const d of byName.get(name) || []) {
        if (unit.keep.has(d)) continue
        unit.keep.add(d)
        const locals = localsOf(d)
        const fields = fieldNamePositions(d)
        const all = tokensOf(d.stmt)
        for (let i = 0; i < all.length; i += 1) {
          const t = all[i]
          if (t.kind !== 'ident' || fields.has(i)) continue
          const v = String(t.value)
          const parts = v.split('.')
          if (!t.member) {
            if (byName.has(parts[0]) && !isLocalRef(locals, parts[0], i)) queue.push(parts[0])
            if (unit.nested.has(parts[0]) && parts[1]) {
              const al = parts[0]
              if (!nestedNeeds.has(al)) nestedNeeds.set(al, new Set())
              nestedNeeds.get(al).add(parts[1])
            }
          }
          for (const seg of t.member ? parts : parts.slice(1)) if (methodNames.has(seg)) queue.push(seg)
        }
      }
    }
    for (const [al, names] of nestedNeeds) {
      const nimp = unit.nested.get(al)
      const nunit = link(nimp, names, [...stack, unit.imp.path])
      unit.nested.set(al, { ...nimp, unit: nunit })
    }
    for (const [al, nimp] of unit.nested) {
      if (!nimp.unit && linked.has(nimp.path)) unit.nested.set(al, { ...nimp, unit: linked.get(nimp.path) })
    }
  }

  /** The library's kept tokens, renamed and repositioned. */
  const emit = (unit) => {
    const kept = unit.defs.filter((d) => unit.keep.has(d))
    const values = new Map()
    const typesAndEnums = new Set()
    const fns = new Set()
    for (const d of unit.defs) {
      if (d.kind === 'value' && unit.keep.has(d)) values.set(d.name, d)
      if ((d.kind === 'type' || d.kind === 'enum') && unit.keep.has(d)) typesAndEnums.add(d.name)
      if (d.kind === 'fn' && unit.keep.has(d)) fns.add(d.name)
    }
    for (const [name, d] of values) {
      if (d.state) throw new LinkRefusal(`the library \`${unit.imp.path}\` keeps \`${name}\` across bars at its top level, and its exports read it`)
    }
    // a kept value reassigned by the library's own top-level code
    for (const d of unit.defs) {
      if (unit.keep.has(d)) continue
      const toks = tokensOf(d.stmt)
      for (let i = 0; i + 1 < toks.length; i += 1) {
        if (toks[i].kind === 'ident' && values.has(String(toks[i].value)) && isPunct(toks[i + 1], ':=')) {
          throw new LinkRefusal(`the library \`${unit.imp.path}\` reassigns \`${toks[i].value}\` at its top level, and its exports read it`)
        }
      }
    }
    // ⛔ A LOCAL WITH A TOP-LEVEL VALUE'S OR TYPE'S NAME, declared inside a nested
    // block: after that block ends, Pine's `X` is the top-level one again, and a
    // positional reading cannot tell. Refused rather than guessed.
    for (const d of kept) {
      const locals = localsOf(d)
      if (!locals.size) continue
      const bodyStart = tokensOf(d.stmt)[d.stmt.header.length]
      const bodyIndent = bodyStart ? (unit.lib.indents[bodyStart.line - 1] || 0) : 0
      for (const [name, { pos, tok }] of locals) {
        if (!values.has(name) && !typesAndEnums.has(name)) continue
        if (pos < d.stmt.header.length) continue // a parameter: the whole body
        if ((unit.lib.indents[tok.line - 1] || 0) > bodyIndent) {
          throw new LinkRefusal(`the library \`${unit.imp.path}\` declares \`${name}\` inside a block of \`${d.name}\` while also reading its own top-level \`${name}\``)
        }
      }
    }
    const lineBase = nextLine - 1
    let maxLine = 0
    const out = []
    for (const d of kept) {
      const stmtToks = tokensOf(d.stmt)
      const locals = localsOf(d)
      const fields = fieldNamePositions(d)
      const skip = d.exported ? stmtToks[0] : null
      let depth = 0
      for (let i = 0; i < stmtToks.length; i += 1) {
        const t = stmtToks[i]
        if (t === skip) continue
        if (isPunct(t, '(') || isPunct(t, '[')) depth += 1
        else if (isPunct(t, ')') || isPunct(t, ']')) depth = Math.max(0, depth - 1)
        const c = { ...t, line: t.line + lineBase, lib: unit.imp.path, libLine: t.line }
        if (t.kind === 'ident' && !t.member) {
          const v = String(t.value)
          const parts = v.split('.')
          const head = parts[0]
          const next = stmtToks[i + 1]
          const namedArg = depth > 0 && isPunct(next, '=')
          if (!namedArg && !fields.has(i) && !isLocalRef(locals, head, i)) {
            if (parts.length === 1 && fns.has(head) && isPunct(next, '(')) c.value = mangle(unit, head)
            else if (typesAndEnums.has(head)) c.value = [mangle(unit, head), ...parts.slice(1)].join('.')
            else if (values.has(head) && !isPunct(next, '(')) c.value = [mangle(unit, head), ...parts.slice(1)].join('.')
            else if (unit.nested.has(head) && parts[1] && unit.nested.get(head).unit) {
              const nunit = unit.nested.get(head).unit
              c.value = rewriteAlias(nunit, parts.slice(1), next) || v
            }
          }
        }
        if (t.line > maxLine) maxLine = t.line
        out.push(c)
      }
    }
    for (let l = 1; l <= maxLine; l += 1) {
      extraIndents[lineBase + l - 1 - mainLineCount] = unit.lib.indents[l - 1] || 0
      extraLines[lineBase + l - 1 - mainLineCount] = unit.lib.lines ? (unit.lib.lines[l - 1] ?? '') : ''
    }
    nextLine = lineBase + maxLine + 1
    unit.lineBase = lineBase
    unit.lineEnd = lineBase + maxLine
    unit.emitted = true
    return out
  }

  /** `X.rest` of a linked unit → its mangled spelling, or null when X is not an
   *  export of that unit (left alone; the lane refuses it by name). */
  const rewriteAlias = (unit, parts, next) => {
    const name = parts[0]
    const d = unit.defs.find((x) => x.name === name && x.exported && unit.keep.has(x))
    if (!d || d.kind === 'method') return null
    if (d.kind === 'fn' && (parts.length !== 1 || !isPunct(next, '('))) return null
    return [mangle(unit, name), ...parts.slice(1)].join('.')
  }

  // ── the script's own references, per alias ────────────────────────────────
  const imports = lines.filter((l) => l.imp)
  const aliasOf = new Map()
  for (const l of imports) aliasOf.set(l.imp.alias, l)
  const needs = new Map() // alias -> Set(names)
  const mainMethods = new Set()
  for (const t of tokens) {
    if (t.kind !== 'ident') continue
    const parts = String(t.value).split('.')
    if (!t.member && aliasOf.has(parts[0]) && parts[1]) {
      if (!needs.has(parts[0])) needs.set(parts[0], new Set())
      needs.get(parts[0]).add(parts[1])
    }
    for (const seg of t.member ? parts : parts.slice(1)) mainMethods.add(seg)
  }

  // ── link each import line ─────────────────────────────────────────────────
  const splices = [] // {start, end, toks}
  const refusedAt = new Map() // token -> reason
  const unitOfAlias = new Map()
  for (const l of lines) {
    if (!l.imp) continue
    try {
      const unit = link(l.imp, [...(needs.get(l.imp.alias) || [])], [])
      // methods the script calls on library objects
      const methods = unit.defs.filter((d) => d.kind === 'method' && mainMethods.has(d.name)).map((d) => d.name)
      if (methods.length) reach(unit, methods, [])
      unitOfAlias.set(l.imp.alias, unit)
      splices.push({ line: l, unit })
    } catch (err) {
      if (!(err instanceof LinkRefusal)) throw err
      refusedAt.set(l.tok, err.message)
    }
  }
  if (!splices.length && !refusedAt.size) return lexed

  // ── emit, in dependency order, at the first import that needs each ────────
  const emitWithDeps = (unit, acc) => {
    if (unit.emitted) return
    for (const [, n] of unit.nested) if (n.unit) emitWithDeps(n.unit, acc)
    acc.push(...emit(unit))
  }
  const newTokens = []
  let cursor = 0
  for (const s of splices) {
    let acc
    try {
      acc = []
      emitWithDeps(s.unit, acc)
    } catch (err) {
      if (!(err instanceof LinkRefusal)) throw err
      refusedAt.set(s.line.tok, err.message)
      unitOfAlias.delete(s.line.imp.alias)
      continue
    }
    for (let i = cursor; i < s.line.start; i += 1) newTokens.push(tokens[i])
    const anchor = s.line.tok.index
    acc.forEach((t, k) => { t.index = anchor + (k + 1) / (acc.length + 1) })
    newTokens.push(...acc)
    cursor = s.line.end
    libraries.push(...[...linked.values()].filter((u) => u.emitted && !libraries.some((x) => x.path === u.imp.path)).map((u) => ({
      path: u.imp.path,
      alias: u.imp.alias,
      author: u.imp.author,
      name: u.imp.name,
      version: u.imp.version,
      licence: u.entry.licence || null,
      attribution: u.entry.attribution || null,
      url: u.entry.url || null,
      lineBase: u.lineBase,
      lineEnd: u.lineEnd,
      importLine: s.line.tok.line,
      importColumn: s.line.tok.column,
      importIndex: s.line.tok.index,
    })))
  }
  for (let i = cursor; i < tokens.length; i += 1) newTokens.push(tokens[i])

  // ── the script's own `alias.X` → the spliced names ────────────────────────
  const names = new Map()
  for (let i = 0; i < newTokens.length; i += 1) {
    const t = newTokens[i]
    if (t.lib || t.kind !== 'ident' || t.member) continue
    const parts = String(t.value).split('.')
    const unit = unitOfAlias.get(parts[0])
    if (!unit || !parts[1]) continue
    const v = rewriteAlias(unit, parts.slice(1), newTokens[i + 1])
    if (v) {
      names.set(mangle(unit, parts[1]), `${parts[0]}.${parts[1]}`)
      newTokens[i] = { ...t, value: v }
    }
  }
  for (const u of linked.values()) {
    for (const d of u.defs) {
      if (d.name && !names.has(mangle(u, d.name))) names.set(mangle(u, d.name), `${u.imp.alias}.${d.name}`)
    }
  }
  for (const [tok, reason] of refusedAt) {
    const i = newTokens.indexOf(tok)
    if (i >= 0) newTokens[i] = { ...tok, libraryRefusal: reason }
  }

  const out = {
    ...lexed,
    tokens: newTokens,
    indents: [...indents, ...Array.from({ length: extraIndents.length }, (_, k) => extraIndents[k] || 0)],
    lines: [...(lexed.lines || []), ...Array.from({ length: extraLines.length }, (_, k) => extraLines[k] ?? '')],
  }
  // ⭐ the script's identity is ITS OWN tokens (`scriptKey`), never the library's
  Object.defineProperty(out.tokens, 'unlinked', { value: tokens, enumerable: false })
  out.libraryLink = { libraries, names, mainLineCount }
  return out
}

/** `opts.libraries` → `(path) => entry | null`. A function, a Map or a plain
 *  object keyed by path; otherwise the client-side registry. */
function resolverOf(opts) {
  const l = opts && opts.libraries
  if (typeof l === 'function') return l
  if (l instanceof Map) return (p) => l.get(p) || null
  if (l && typeof l === 'object') return (p) => (Object.prototype.hasOwnProperty.call(l, p) ? l[p] : null)
  return (p) => pineLibraryEntry(p)
}

/** A refusal/note located inside a library → the member's import line, with the
 *  library and its line named; and every spliced name back to `alias.name`. */
export function remapLibraryLocation(r, link) {
  if (!r || typeof r !== 'object' || !link) return r
  const out = { ...r }
  const lib = Number.isFinite(r.line)
    ? link.libraries.find((l) => r.line >= l.lineBase + 1 && r.line <= l.lineEnd)
    : null
  if (lib) {
    const libLine = r.line - lib.lineBase
    out.line = lib.importLine
    out.column = lib.importColumn
    out.index = lib.importIndex
    out.library = { path: lib.path, line: libLine }
    if (typeof out.message === 'string') out.message = `${out.message} — in the imported library \`${lib.path}\`, line ${libLine}`
  }
  for (const k of ['message', 'token', 'excerpt']) {
    if (typeof out[k] === 'string') out[k] = demangle(out[k], link)
  }
  return out
}

export function demangle(text, link) {
  if (!link || !link.names || typeof text !== 'string' || !text.includes('__lib')) return text
  return text.replace(/__lib\d+_[A-Za-z0-9_]+/g, (m) => link.names.get(m) || m)
}

// app/src/components/chart/engine/ast/udtConstFields.js
//
// ─── H6 (step 90) — A USER-DEFINED TYPE'S FIELD, READ OFF A CONSTANT INSTANCE ────
//
// `multicator-table` builds its colour pack once and reads it ninety-five times:
//
//     type ThemePalette
//         color bull
//         …
//     themePalette(bool dark) =>
//         ThemePalette.new(…, dark ? color.new(#00ff9c, 35) : color.new(#c8f7d6, 0), …)
//     theme = themePalette(isDark)                // isDark = input.string(…) == 'Dark'
//     … bgcolor = theme.bull …
//
// Every field of `theme` is fixed for the whole run: its constructor arguments read
// only literals, colours and inputs. So `theme.bull` IS its constructor argument —
// `(isDark ? color.new(#00ff9c, 35) : color.new(#c8f7d6, 0))` — on every bar, in Pine's
// own semantics: a non-`var` binding re-runs the constructor each bar with the same
// arguments, and a `var` one runs it once with arguments that never change. This
// pre-pass rewrites each such read, at the TOKEN level, to its argument in parentheses
// — before the walk, so the plot lane and the object lane both read the same thing.
//
// ⛔ ONLY WHERE THE ANSWER IS PROVABLY THE SAME ON EVERY BAR. A binding is resolved
// only when ALL of these hold (each one fails closed — the read keeps its
// `pine:type` refusal):
//   • the type is declared in the script, every field a plain `<type> name [= v]`;
//   • the instance is bound ONCE at the top level, `[var] [T] x = T.new(…)` or
//     `x = helper(…)` where `helper(params) => T.new(…)` is the helper's whole body;
//   • `x` is never written (`x :=`, `x.f :=`, `x.f += …`), never read bare (passed to
//     a function, compared, indexed `x[1]`, `x.method()`), and every `x.<f>` names a
//     declared field — so nothing can mutate it by reference or read it as an object;
//   • every field it is read through resolves to tokens that are bar-invariant by the
//     walk's own rule (`objectFnInline.js::barInvariantNames` / `guardIsBarInvariant`:
//     literals, colours, `color.*` / `math.*` of invariants, inputs, and top-level
//     names built only from those), after the helper's parameters are replaced by the
//     call's arguments;
//   • no invariant name the argument reads is also a function parameter anywhere in
//     the script (a read inside that function would see the parameter, not the global);
//   • every read sits on a later line than the binding;
//   • no field read carries an `input.*(…)` CALL (its copies would be new inputs and
//     move parameter ids — C46: an id is the input call's place in the source).
// ⚠️ A UDT whose fields MUTATE per bar, an array / object field, or an instance passed
// around stays refused: those are the runtime lane's (H3's routing).

import { barInvariantNames, guardIsBarInvariant, isMutator } from './objectFnInline.js'

const isP = (t, v) => !!t && t.kind === 'punct' && t.value === v
const isId = (t, v) => !!t && t.kind === 'ident' && (v === undefined || t.value === v)

/** Index of the `)` closing the `(` at `open`, or -1. */
function closeAt(toks, open) {
  let depth = 0
  for (let i = open; i < toks.length; i += 1) {
    const t = toks[i]
    if (t.kind !== 'punct') continue
    if (t.value === '(' || t.value === '[') depth += 1
    else if (t.value === ')' || t.value === ']') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

/** `toks[from, to)` split at depth-0 commas. */
function splitArgs(toks, from, to) {
  const out = []
  let cur = []
  let depth = 0
  for (let i = from; i < to; i += 1) {
    const t = toks[i]
    if (t.kind === 'punct' && (t.value === '(' || t.value === '[')) depth += 1
    if (t.kind === 'punct' && (t.value === ')' || t.value === ']')) depth -= 1
    if (depth === 0 && isP(t, ',')) { out.push(cur); cur = []; continue }
    cur.push(t)
  }
  if (cur.length) out.push(cur)
  return out
}

/** `type T` → `{name, fields: [{name, dflt}]}` or null when any field line is not
 *  a plain `<type tokens> name [= value]`. The lexer folds the indented field lines
 *  into the header; they are split back by source line. */
function readType(header) {
  let at = 0
  if (isId(header[0], 'export')) at = 1
  if (!isId(header[at], 'type') || !isId(header[at + 1])) return null
  const name = String(header[at + 1].value)
  const byLine = new Map()
  for (const t of header.slice(at + 2)) {
    if (!byLine.has(t.line)) byLine.set(t.line, [])
    byLine.get(t.line).push(t)
  }
  const fields = []
  for (const g of byLine.values()) {
    const eq = g.findIndex((t) => isP(t, '='))
    const nameTok = eq >= 0 ? g[eq - 1] : g[g.length - 1]
    if (!isId(nameTok) || String(nameTok.value).includes('.')) return null
    const typeToks = g.slice(0, eq >= 0 ? eq - 1 : g.length - 1)
    if (!typeToks.length || !typeToks.every((t) => t.kind === 'ident' || isP(t, '<') || isP(t, '>') || isP(t, ','))) return null
    fields.push({ name: String(nameTok.value), dflt: eq >= 0 ? g.slice(eq + 1) : null })
  }
  return fields.length ? { name, fields } : null
}

/** `T.new(…)` occupying exactly `toks[from..]` → its argument groups, or null. */
function ctorArgs(toks, from, typeName) {
  if (!isId(toks[from], `${typeName}.new`) || !isP(toks[from + 1], '(')) return null
  const close = closeAt(toks, from + 1)
  if (close !== toks.length - 1) return null
  return splitArgs(toks, from + 2, close)
}

/** Map a constructor's argument groups onto the type's fields → `Map(field → tokens)`,
 *  or null when an argument cannot be placed. */
function fieldValues(type, groups) {
  const out = new Map()
  let positional = 0
  let named = false
  for (const g of groups) {
    if (!g.length) return null
    if (g.length >= 3 && isId(g[0]) && isP(g[1], '=')) {
      const f = String(g[0].value)
      if (!type.fields.some((x) => x.name === f) || out.has(f)) return null
      out.set(f, g.slice(2))
      named = true
      continue
    }
    if (named || positional >= type.fields.length) return null
    out.set(type.fields[positional].name, g)
    positional += 1
  }
  for (const f of type.fields) {
    if (out.has(f.name)) continue
    out.set(f.name, f.dflt && f.dflt.length ? f.dflt : [{ kind: 'ident', value: 'na' }])
  }
  return out
}

/** A function `name(params) => T.new(…)` (one expression, inline or on the next line)
 *  → `{params: string[], groups}` or null. A parameter with a default is not read. */
function readHelper(st, types) {
  const h = st.header || []
  if (!isId(h[0]) || !isP(h[1], '(')) return null
  const close = closeAt(h, 1)
  if (close < 0 || !isP(h[close + 1], '=>')) return null
  const params = []
  for (const g of splitArgs(h, 2, close)) {
    if (!g.length || g.some((t) => isP(t, '='))) return null
    const last = g[g.length - 1]
    if (!isId(last) || String(last.value).includes('.')) return null
    params.push(String(last.value))
  }
  let body = null
  if (close + 2 < h.length) body = h.slice(close + 2)
  else if ((st.sub || []).length === 1 && !(st.sub[0].sub || []).length) body = st.sub[0].header || []
  if (!body || !body.length) return null
  const head = body[0]
  if (!isId(head) || !String(head.value).endsWith('.new')) return null
  const typeName = String(head.value).slice(0, -4)
  if (!types.has(typeName)) return null
  const groups = ctorArgs(body, 0, typeName)
  return groups ? { name: String(h[0].value), params, typeName, groups } : null
}

/** Replace each ident token named in `subst` by `( tokens )`. */
function substitute(toks, subst) {
  const out = []
  for (const t of toks) {
    if (t.kind === 'ident' && subst.has(String(t.value))) {
      out.push({ ...t, kind: 'punct', value: '(' }, ...subst.get(String(t.value)), { ...t, kind: 'punct', value: ')' })
    } else out.push(t)
  }
  return out
}

/** Every identifier written as a function parameter anywhere in the script. */
function parameterNames(stmts) {
  const names = new Set()
  const walk = (list) => {
    for (const st of list || []) {
      const h = st.header || []
      const arrow = h.findIndex((t) => isP(t, '=>'))
      if (arrow > 0) {
        const open = h.findIndex((t) => isP(t, '('))
        const close = open >= 0 ? closeAt(h, open) : -1
        if (open >= 0 && close > open && close < arrow) {
          for (const g of splitArgs(h, open + 1, close)) {
            const eq = g.findIndex((t) => isP(t, '='))
            const nameTok = eq >= 0 ? g[eq - 1] : g[g.length - 1]
            if (isId(nameTok)) names.add(String(nameTok.value))
          }
        }
      }
      walk(st.sub)
    }
  }
  walk(stmts)
  return names
}

/**
 * Rewrite every provably-constant UDT field read in `lexed.tokens`.
 *
 * @param {{tokens: object[], indents: number[]}} lexed
 * @param {{blockStatements: Function, isPunct: Function, findTop: Function, boundName: Function}} h
 * @returns {object} `lexed` unchanged when nothing resolves, else a copy with new
 *   `tokens` and `udtConstFields: [{name, type, fields: string[], reads}]`.
 */
export function resolveConstantUdtFields(lexed, h) {
  const tokens = lexed && lexed.tokens
  if (!Array.isArray(tokens) || !tokens.some((t) => isId(t, 'type'))) return lexed
  const stmts = h.blockStatements(tokens, lexed.indents, 0)
  const types = new Map()
  for (const st of stmts) {
    const ty = readType(st.header || [])
    if (ty) types.set(ty.name, ty)
  }
  if (!types.size) return lexed
  const helpers = new Map()
  for (const st of stmts) {
    const hp = readHelper(st, types)
    if (hp) helpers.set(hp.name, hp)
  }
  let invariant = null
  let params = null
  const plans = new Map() // instance name → {type, values: Map(field → tokens), line}
  for (const st of stmts) {
    const t = st.header || []
    const eq = t.findIndex((x) => isP(x, '='))
    if (eq < 1 || isId(t[0], 'varip')) continue
    const lead = isId(t[0], 'var') ? 1 : 0
    // `[var] [T] x = …` — at most one type word between `var` and the name
    if (eq - lead > 2 || !isId(t[eq - 1])) continue
    if (eq - lead === 2 && !types.has(String(t[lead].value))) continue
    const name = String(t[eq - 1].value)
    if (name.includes('.')) continue
    const rhs = t.slice(eq + 1)
    if (!rhs.length || !isId(rhs[0])) continue
    const head = String(rhs[0].value)
    let type = null
    let values = null
    if (head.endsWith('.new') && types.has(head.slice(0, -4))) {
      type = types.get(head.slice(0, -4))
      const groups = ctorArgs(rhs, 0, type.name)
      values = groups && fieldValues(type, groups)
    } else if (helpers.has(head) && isP(rhs[1], '(')) {
      const hp = helpers.get(head)
      const close = closeAt(rhs, 1)
      if (close !== rhs.length - 1) continue
      const callArgs = splitArgs(rhs, 2, close)
      if (callArgs.length !== hp.params.length || callArgs.some((g) => !g.length || (isId(g[0]) && isP(g[1], '=')))) continue
      type = types.get(hp.typeName)
      const subst = new Map(hp.params.map((p, i) => [p, callArgs[i]]))
      const fv = fieldValues(type, hp.groups)
      values = fv && new Map([...fv].map(([f, toks]) => [f, substitute(toks, subst)]))
    }
    if (!type || !values) continue
    // ── every other mention of `name` must be a plain field read ──────────────
    let ok = true
    const reads = []
    for (let i = 0; i < tokens.length && ok; i += 1) {
      const tk = tokens[i]
      if (tk.kind !== 'ident') continue
      const v = String(tk.value)
      if (v === name) {
        if (tk !== t[eq - 1]) ok = false
        continue
      }
      if (!v.startsWith(`${name}.`)) continue
      const field = v.slice(name.length + 1)
      if (field.includes('.') || !values.has(field) || isMutator(tokens[i + 1]) || isP(tokens[i + 1], '(')
          || isP(tokens[i + 1], '[') || tk.line <= t[eq - 1].line) { ok = false; continue }
      reads.push(i)
    }
    if (!ok || !reads.length) continue
    // ── every field read must be the same on every bar ─────────────────────────
    if (!invariant) invariant = barInvariantNames(stmts, h)
    if (!params) params = parameterNames(stmts)
    const used = new Set(reads.map((i) => String(tokens[i].value).slice(name.length + 1)))
    for (const f of used) {
      const toks = values.get(f)
      if (!guardIsBarInvariant(toks, invariant)) { ok = false; break }
      // ⛔ an `input.*(…)` written INSIDE the constructor would be copied to every
      // read site, and a parameter id is the input call's place in the source (C46):
      // the copies would be inputs the script never wrote. Refused; an input bound to
      // a name first (multicator's `isDark`) is a name, not a call, and is served.
      if (toks.some((x) => x.kind === 'ident' && (x.value === 'input' || String(x.value).startsWith('input.')))) { ok = false; break }
      if (toks.some((x) => x.kind === 'ident' && invariant.has(String(x.value)) && params.has(String(x.value)))) { ok = false; break }
    }
    if (!ok) continue
    plans.set(name, { type, values, reads, used })
  }
  if (!plans.size) return lexed
  const byIndex = new Map()
  for (const [name, plan] of plans) for (const i of plan.reads) byIndex.set(i, { name, plan })
  const out = []
  for (let i = 0; i < tokens.length; i += 1) {
    const hit = byIndex.get(i)
    if (!hit) { out.push(tokens[i]); continue }
    const at = tokens[i]
    const field = String(at.value).slice(hit.name.length + 1)
    const pos = { line: at.line, column: at.column, index: at.index }
    out.push({ kind: 'punct', value: '(', ...pos })
    for (const x of hit.plan.values.get(field)) out.push({ ...x, ...pos })
    out.push({ kind: 'punct', value: ')', ...pos })
  }
  // ⛔ THE SCRIPT'S OWN TOKENS STAY ITS IDENTITY. A parameter id's frozen map is keyed
  // by a hash of the token stream (`paramIdSource.js::scriptKey`, read off
  // `tokens.unlinked` — the linker's precedent): a rewritten stream would be a
  // different script and every legacy id would vanish (measured: lorentzian's ids
  // went absent in all three lanes until this line existed).
  out.unlinked = tokens.unlinked || tokens
  return {
    ...lexed,
    tokens: out,
    udtConstFields: [...plans].map(([name, p]) => ({ name, type: p.type.name, fields: [...p.used].sort(), reads: p.reads.length })),
  }
}

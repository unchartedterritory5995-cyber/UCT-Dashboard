// ⛔⛔ THE TRANSITIVE HALF OF THE WRITE-PATH RAIL — the claim `writePaths.test.js` refused to make.
//
// That rail's own coverage boundary says it, in its own words:
//
//     "LAYER 2 (presence, not enumeration): for a path the hub reaches through a pre-existing app
//      client, the rail asserts the declared call site EXISTS in the declared module. It does NOT
//      enumerate everything those modules can write. ... Separating those from the two it does call
//      means following `toggle` and `createAlert` out through a hook's RETURN VALUE, which is
//      dataflow analysis, not a scan. So: 'the hub adds no write of its own beyond these four' is
//      PROVEN; 'these app clients can write nothing else' is NOT CLAIMED."
//
// ⭐ That gap is not academic. `useFlagged.js` holds THREE writes and the hub may reach exactly one
// of them. A rail that only asks "does the declared call site exist in the declared module" is
// satisfied by a module that also ships `PUT /flagged/share` and `PUT /flagged/rename` — and would
// stay satisfied if someone wired the hub's `toggle` to call `toggleShare`, which would publish a
// member's flagged list to the community from a gesture that says "Flag".
//
// So this rail follows the CALL GRAPH from the exact function the hub calls, and asserts the set of
// writes reachable from THERE equals the declared set.
//
// ── THE DIRECTION OF ERROR IS DELIBERATE ───────────────────────────────────────────────────────
// The reachability walk OVER-approximates on purpose:
//   · it descends into every nested function expression it meets (a `setTimeout` callback is how
//     `toggle` actually reaches its write, so refusing to descend would MISS a real path);
//   · it follows same-file identifier calls transitively;
//   · it does NOT try to prove a branch is dead.
// Over-approximation can only ADD writes to the reachable set, never hide one. So when the computed
// set comes out EQUAL to the declared set, that is a strong result: not "we found nothing else" but
// "a deliberately generous analysis still found nothing else". An under-approximating analysis that
// returned the same answer would prove nothing, which is the trap this file exists to avoid.
//
// ⛔ IDENTIFIER RESOLUTION IS SAME-FILE ONLY, and that is asserted rather than assumed: any call to
// an IMPORTED identifier from an entry function is reported as an UNRESOLVED EDGE and fails the
// rail by name. A cross-module hop that vanished silently would be exactly the hole this closes.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import { Parser } from 'acorn'
import jsx from 'acorn-jsx'

const JsxParser = Parser.extend(jsx())
const WRITE_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE']

/** Repo root by walking up for `app/src` — the same shape the other derivation rails use, and it
 *  throws by name rather than silently resolving to the wrong tree. */
function repoRoot() {
  let d = process.cwd()
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(path.join(d, 'app', 'src', 'hub'))) return d
    const up = path.dirname(d)
    if (up === d) break
    d = up
  }
  throw new Error('could not locate the repo root by walking up from ' + process.cwd())
}
const SRC = path.join(repoRoot(), 'app', 'src')
const read = (rel) => readFileSync(path.join(SRC, rel), 'utf8')

// ── THE CLAIM ──────────────────────────────────────────────────────────────────────────────────
//
// One entry per `owner: 'app'` row of `writePaths.test.js`'s manifest: the module, the EXACT
// function the hub calls, and every write reachable from it. `alsoInModule` is the discrimination
// control — writes that exist in the same file and must NOT come back as reachable.
const ENTRIES = [
  {
    module: 'hooks/useFlagged.js',
    entry: 'toggle',
    hubCallSite: "registry.js:112 — \"Flag — always useFlagged().toggle(symbol)\"",
    reachable: ['POST /api/watchlists/flagged/sync'],
    alsoInModule: ['PUT /api/watchlists/flagged/share', 'PUT /api/watchlists/flagged/rename'],
    why: 'toggle -> syncToServer -> setTimeout callback -> the sync POST. Share and rename hang off '
       + 'toggleShare/rename, which nothing in the hub calls.',
  },
  {
    module: 'hooks/useWatchlistAlerts.js',
    entry: 'createAlert',
    hubCallSite: 'hub/sections/screenerSection.js:224 — `createAlert?.(sym, price, ...)`',
    reachable: ['POST /api/watchlist-alerts'],
    alsoInModule: ['DELETE /api/watchlist-alerts/{param}'],
    why: 'the hub sets alerts and never deletes one; the DELETE belongs to the app\'s own UI.',
    // ⭐ FOUND BY THIS RAIL ON ITS FIRST RUN, and kept rather than waved through. `createAlert`
    // calls `globalMutate` — an IMPORTED identifier, so the same-file walk cannot follow it, and
    // the rail refused to proceed. It is genuinely inert for write purposes, but "inert" is a
    // claim, so it is SUBSTANTIATED below rather than allow-listed: SWR's `mutate` revalidates
    // through this module's own `fetcher`, and that fetcher is asserted to perform no write.
    inertHops: [{
      name: 'globalMutate',
      from: 'swr',
      revalidatesVia: 'fetcher',
      why: "SWR cache revalidation. It re-runs `fetcher`, which is `url => fetch(url)` with no "
         + 'method option — a GET. Change the fetcher to a write and this rail goes red.',
    }],
  },
  {
    // ⭐ R-17. `notebook.linkTicker` files a note under a ticker through the Notebook's OWN note
    // client. THE ENTRY IS THE HOOK, NOT `update`: `update` is a property on the hook's return
    // value, and `functionsByName` indexes named BINDINGS. Teaching it to index object properties
    // by key would make `refresh` — which appears six times in this one file — resolve to
    // whichever came last. `useJ2Note` is a unique FunctionDeclaration that CONTAINS `update`, and
    // the walk descends into nested functions, so entering one level up loses nothing: every write
    // `update` can perform is a write `useJ2Note` can reach.
    module: 'pages/journal-2-0/hooks/useJ2Notes.js',
    entry: 'useJ2Note',
    hubCallSite: 'hub/sections/notebookSection.js — `armed.update({ ticker })` inside `linkTicker`',
    reachable: ['PUT /api/j2/notes/{param}'],
    alsoInModule: ['POST /api/j2/notes/{param}/opened'],
    why: 'useJ2Note holds exactly one write — the note PUT behind `update`. The recency beacon '
       + '(`recordNoteOpened`) and the favourite toggle are sibling module-level functions this '
       + 'hook never calls.\n'
       + '⚠️ RECORDED RATHER THAN CLAIMED: `setNoteFavorite` writes with '
       + "`method: isFavorite ? 'POST' : 'DELETE'`, and `methodOf` reads only a string Literal, so "
       + 'that call site is invisible to BOTH this rail and `writePaths.test.js`. It is out of '
       + "`useJ2Note`'s reach either way, but the blind spot is real and is written down here "
       + 'rather than left for the next person to discover.\n'
       + '⚠️ ALSO RECORDED: `update` calls the SWR `mutate` it destructured from `useSWR`. That is '
       + 'a LOCAL binding, not an import, so it is neither followed nor reported as unresolved. It '
       + "is the same SWR revalidation `globalMutate` is declared inert for above, re-running this "
       + "module's own read-only `fetcher`.",
    inertHops: [
      {
        name: 'useSWR',
        from: 'swr',
        revalidatesVia: 'fetcher',
        why: "the SWR hook itself. What it calls is this module's `fetcher`, which is "
           + '`url => fetch(url, {credentials})` with no method option — a GET.',
      },
      {
        name: 'invalidateNoteLinkTarget',
        from: '../lib/noteLinkTargetsBatch',
        inModule: 'pages/journal-2-0/lib/noteLinkTargetsBatch.js',
        revalidatesVia: 'invalidateNoteLinkTarget',
        why: 'a cache eviction: it deletes an id from a module-level Map and calls `notify()`. That '
           + "module's one fetch is a GET behind `flush`, which an eviction never calls.",
      },
    ],
  },
]

// `noteCreation.js` is handled separately, below — its second write is GUARDED rather than
// unreachable, and pretending otherwise would be the dishonest simplification.

// ── THE WALK ───────────────────────────────────────────────────────────────────────────────────

const isNode = (v) => v && typeof v === 'object' && typeof v.type === 'string'

function children(node) {
  const out = []
  for (const k of Object.keys(node)) {
    if (k === 'type' || k === 'start' || k === 'end' || k === 'loc') continue
    const v = node[k]
    if (Array.isArray(v)) v.forEach((x) => { if (isNode(x)) out.push(x) })
    else if (isNode(v)) out.push(v)
  }
  return out
}

function walk(node, visit) {
  if (!isNode(node)) return
  visit(node)
  children(node).forEach((c) => walk(c, visit))
}

const FUNC_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'])

/** Every named function-like binding in the file, by name.
 *  Handles `function f(){}`, `const f = () => {}`, `const f = function(){}`, and
 *  `const f = useCallback(() => {}, deps)` — the last is how this codebase writes handlers. */
function functionsByName(ast) {
  const map = new Map()
  walk(ast, (n) => {
    if (n.type === 'FunctionDeclaration' && n.id?.name) map.set(n.id.name, n)
    if (n.type === 'VariableDeclarator' && n.id?.type === 'Identifier' && n.init) {
      const init = n.init
      if (FUNC_TYPES.has(init.type)) map.set(n.id.name, init)
      else if (init.type === 'CallExpression'
               && init.callee?.type === 'Identifier'
               && /^(useCallback|useMemo)$/.test(init.callee.name)
               && FUNC_TYPES.has(init.arguments?.[0]?.type)) {
        map.set(n.id.name, init.arguments[0])
      }
    }
  })
  return map
}

/** Names introduced by `import ... from '...'` — a call to one of these from inside an entry
 *  function is a hop this analysis cannot follow, and must be reported rather than dropped. */
function importedNames(ast) {
  const out = new Set()
  walk(ast, (n) => {
    if (n.type === 'ImportDeclaration') {
      (n.specifiers || []).forEach((s) => { if (s.local?.name) out.add(s.local.name) })
    }
  })
  return out
}

/** The endpoint text of a fetch-like call, normalised so a template literal with an expression
 *  reads as `{param}` — matching how writePaths.test.js names them. */
function endpointOf(arg) {
  if (!arg) return null
  if (arg.type === 'Literal' && typeof arg.value === 'string') return arg.value
  if (arg.type === 'TemplateLiteral') {
    let s = ''
    arg.quasis.forEach((q, i) => {
      s += q.value.cooked
      if (i < arg.expressions.length) s += '{param}'
    })
    return s
  }
  return null
}

function methodOf(optionsArg) {
  if (!optionsArg || optionsArg.type !== 'ObjectExpression') return null
  for (const p of optionsArg.properties) {
    if (p.type !== 'Property') continue
    const k = p.key?.name || p.key?.value
    if (k !== 'method') continue
    const v = p.value
    const m = v?.type === 'Literal' ? String(v.value).toUpperCase() : null
    if (m && WRITE_METHODS.includes(m)) return m
  }
  return null
}

/** Is this write nested inside an `if`? Returns the guard's source text, or null. */
function guardFor(node, src, ancestryStack) {
  for (let i = ancestryStack.length - 1; i >= 0; i -= 1) {
    const a = ancestryStack[i]
    if (a.type === 'IfStatement') return src.slice(a.test.start, a.test.end)
  }
  return null
}

/** Writes reachable from `entryName`, following same-file calls and descending into nested
 *  functions. Returns { writes, unresolved, visited }. */
function reachableWrites(src, entryName) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const funcs = functionsByName(ast)
  const imported = importedNames(ast)
  const start = funcs.get(entryName)
  if (!start) throw new Error(`entry function \`${entryName}\` not found — the rail cannot measure what it cannot locate`)

  const writes = new Set()
  const unresolved = new Set()
  const visited = new Set()
  const queue = [[entryName, start]]

  while (queue.length) {
    const [name, fn] = queue.shift()
    if (visited.has(name)) continue
    visited.add(name)

    const stack = []
    const rec = (node) => {
      if (!isNode(node)) return
      stack.push(node)
      if (node.type === 'CallExpression') {
        const callee = node.callee
        // a write
        if (callee?.type === 'Identifier' && callee.name === 'fetch') {
          const ep = endpointOf(node.arguments?.[0])
          const m = methodOf(node.arguments?.[1])
          if (ep && m) {
            const g = guardFor(node, src, stack)
            writes.add(JSON.stringify({ w: `${m} ${ep}`, guard: g }))
          }
        }
        // a same-file hop
        if (callee?.type === 'Identifier' && funcs.has(callee.name) && !visited.has(callee.name)) {
          queue.push([callee.name, funcs.get(callee.name)])
        }
        // a hop we cannot follow
        if (callee?.type === 'Identifier' && imported.has(callee.name)) unresolved.add(callee.name)
      }
      children(node).forEach(rec)
      stack.pop()
    }
    rec(fn)
  }
  return {
    writes: [...writes].map((s) => JSON.parse(s)),
    unresolved: [...unresolved],
    visited: [...visited],
  }
}

/** Every write anywhere in the file, regardless of reachability — the control population. */
function allWrites(src) {
  const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module', locations: true })
  const out = new Set()
  walk(ast, (n) => {
    if (n.type !== 'CallExpression') return
    if (n.callee?.type !== 'Identifier' || n.callee.name !== 'fetch') return
    const ep = endpointOf(n.arguments?.[0])
    const m = methodOf(n.arguments?.[1])
    if (ep && m) out.add(`${m} ${ep}`)
  })
  return [...out]
}

// ── THE RAILS ──────────────────────────────────────────────────────────────────────────────────

describe('transitive write reachability from the hub\'s own call sites', () => {
  it('⛔ NON-VACUITY: the control modules really do hold writes the hub must not reach', () => {
    // Without this, every assertion below could pass against a file with exactly one write in it,
    // and the analysis would never have been asked to discriminate anything.
    for (const e of ENTRIES) {
      const all = allWrites(read(e.module))
      for (const extra of e.alsoInModule) {
        expect(all, `${e.module} no longer contains ${extra} — this rail's discrimination control `
          + 'has evaporated, so it now proves much less than it claims. Re-derive the control set.')
          .toContain(extra)
      }
      expect(all.length, `${e.module} holds only ${all.length} write(s); a single-write module cannot `
        + 'exercise reachability at all').toBeGreaterThan(1)
    }
  })

  for (const e of ENTRIES) {
    it(`⛔ ${e.module}: only ${e.reachable.join(', ')} is reachable from \`${e.entry}\``, () => {
      const src = read(e.module)
      const { writes, unresolved, visited } = reachableWrites(src, e.entry)
      const got = writes.map((w) => w.w).sort()

      // Every unfollowable hop must be DECLARED inert, and every declared-inert hop must still be
      // there — so the allowlist cannot quietly outlive the call it was written for.
      const declaredInert = (e.inertHops || []).map((h) => h.name)
      expect(unresolved.filter((u) => !declaredInert.includes(u)),
        `\`${e.entry}\` calls imported function(s) that this same-file analysis cannot follow and that `
        + 'are NOT declared inert. A cross-module hop must not vanish silently — either declare it '
        + 'inert WITH a proof below, or widen the rail to follow it.').toEqual([])
      for (const h of (e.inertHops || [])) {
        expect(unresolved, `\`${h.name}\` is declared an inert hop of ${e.entry}, but ${e.entry} no `
          + 'longer calls it. A stale allowlist entry makes the rail read stronger than it is.')
          .toContain(h.name)
      }

      expect(got, `the set of writes reachable from ${e.module}::${e.entry} changed.\n`
        + `  reachable now : ${got.join(' | ') || '(none)'}\n`
        + `  declared      : ${[...e.reachable].sort().join(' | ')}\n`
        + `  functions walked: ${visited.join(' -> ')}\n`
        + `  why the declared set is what it is: ${e.why}`)
        .toEqual([...e.reachable].sort())
    })

    it(`⛔ ${e.module}: \`${e.entry}\` cannot reach ${e.alsoInModule.join(' or ')}`, () => {
      // Stated as its own assertion rather than folded into the equality above, because THIS is the
      // sentence that matters to a member: a gesture labelled "Flag" must not be able to publish a
      // watchlist. An equality failure would report "sets differ"; this reports the danger by name.
      const { writes } = reachableWrites(read(e.module), e.entry)
      const got = writes.map((w) => w.w)
      for (const forbidden of e.alsoInModule) {
        expect(got, `⛔ ${e.entry} can now reach ${forbidden}. The hub calls this function for one `
          + 'narrow purpose; reaching a second endpoint through it is a write the manifest never '
          + 'declared and the member never asked for.').not.toContain(forbidden)
      }
    })
  }

  it('⛔ every declared-inert hop is SUBSTANTIATED, not allow-listed', () => {
    // ⭐ An allowlist that only names a function is a hole with a label on it. Each inert hop has to
    // survive two checks: it comes from the module we think it does, and the thing it triggers
    // cannot write. For SWR's `mutate` that means the module's own fetcher is read-only — flip the
    // fetcher to a POST and this goes red, which is the property that makes the hop "inert" a fact
    // rather than a promise.
    for (const e of ENTRIES) {
      for (const h of (e.inertHops || [])) {
        const src = read(e.module)
        const ast = JsxParser.parse(src, { ecmaVersion: 'latest', sourceType: 'module' })
        let importedFrom = null
        walk(ast, (n) => {
          if (n.type !== 'ImportDeclaration') return
          if ((n.specifiers || []).some((s) => s.local?.name === h.name)) importedFrom = n.source.value
        })
        expect(importedFrom, `\`${h.name}\` is declared inert on the grounds that it comes from `
          + `'${h.from}', but it is imported from '${importedFrom}'. The reasoning behind the `
          + 'allowance no longer applies.').toBe(h.from)

        // The revalidation path must perform no write.
        // ⭐ `inModule` lets the PROOF live where the function does. Without it a hop into a
        // first-party module could only be substantiated by naming some unrelated local function
        // and calling it the proof — a label, not evidence. The hop's module is still pinned by
        // the `from` assertion above, so this cannot quietly read a file the import does not name.
        const proofSrc = h.inModule ? read(h.inModule) : src
        const { writes } = reachableWrites(proofSrc, h.revalidatesVia)
        expect(writes.map((w) => w.w), `${h.inModule || e.module}'s \`${h.revalidatesVia}\` now performs a write, so `
          + `\`${h.name}\` is no longer inert: a cache revalidation triggered from ${e.entry} would `
          + 'reach it. ' + h.why).toEqual([])
      }
    }
  })

  it('⛔ noteCreation: the second write is GUARDED, and the hub\'s call site cannot open the guard', () => {
    // ⭐ HONEST EXCEPTION. `createNoteViaApi` contains BOTH POST /api/j2/notes and
    // PUT /api/j2/notes/{param}. The PUT is not unreachable by call graph — it sits in the same
    // function body, behind `if (properties && ...)`. A reachability walk therefore FINDS it, and
    // claiming otherwise would be the comfortable lie. So the rail asserts the two things that are
    // actually true: the guard exists and names `properties`, and the hub's only call site passes
    // none. If either changes, the hub gains a write nobody declared.
    const src = read('pages/journal-2-0/lib/noteCreation.js')
    const { writes } = reachableWrites(src, 'createNoteViaApi')
    const byName = Object.fromEntries(writes.map((w) => [w.w, w.guard]))

    expect(Object.keys(byName).sort()).toEqual(['POST /api/j2/notes', 'PUT /api/j2/notes/{param}'])
    expect(byName['POST /api/j2/notes'], 'the note POST became conditional — the hub\'s New note '
      + 'action would silently stop creating notes').toBeNull()
    expect(byName['PUT /api/j2/notes/{param}'], 'the properties PUT lost its guard, so a hub call '
      + 'passing no properties can now reach a second write').toMatch(/properties/)

    const hubCall = readFileSync(path.join(SRC, 'hub', 'sections', 'notebookSection.js'), 'utf8')
    expect(hubCall, 'the hub\'s createNoteViaApi call no longer passes an empty object — if it now '
      + 'passes properties, PUT /api/j2/notes/{id} becomes a hub-reachable write and must be '
      + 'declared in writePaths.test.js\'s manifest')
      .toMatch(/createNoteViaApi\(\{\s*\}\)/)
  })

  it('⛔ every owner:\'app\' row of the manifest is covered here, derived not typed', () => {
    // The two rails must not drift: if someone adds a fifth app-owned path to the manifest, this
    // file must gain an entry for it rather than quietly continuing to prove less.
    const manifest = readFileSync(path.join(SRC, 'hub', 'writePaths.test.js'), 'utf8')
    const appVias = [...manifest.matchAll(/via:\s*'([^']+)',\s*\n\s*owner:\s*'app'/g)].map((m) => m[1])
    expect(appVias.length, 'no owner:\'app\' rows parsed out of writePaths.test.js — the shape of that '
      + 'manifest changed and this cross-check has gone vacuous').toBeGreaterThan(0)

    const covered = new Set([...ENTRIES.map((e) => e.module), 'pages/journal-2-0/lib/noteCreation.js'])
    for (const via of appVias) {
      expect([...covered], `writePaths.test.js declares an app-owned write reached through \`${via}\`, `
        + 'but no transitive entry covers it. Layer 2 is presence-only, so that path\'s sibling writes '
        + 'are currently unproven.').toContain(via)
    }
  })
})

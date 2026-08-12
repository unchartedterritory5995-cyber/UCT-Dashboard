# Plain-name recurrence — the VERIFIED implementation, ready to apply

> Written 2026-08-11 after five attempts. **This code was run and measured**, not
> sketched: script 10 produced 5 usable columns with correctly nested
> accumulators, a hand-rolled OBV correctly refused, and the controls were
> unchanged. It is recorded verbatim because it existed only in a session
> transcript, and re-deriving it cost four failed attempts.
>
> ⚠️ It is NOT committed to `pine.js`. The last re-application was done through a
> shell heredoc, whose backtick escaping corrupted a template literal and broke 37
> test files. **Apply these with an editor, never a heredoc.**

## What it does

`x := f(x[1])` on a PLAIN name (no `var`) becomes an accumulator — the whole
trailing-stop family — while a running total keeps refusing.

    s = close + 1
    p = nz(s[1], s)
    if s > 0
        s := high < p ? math.min(s, p) : s
    → accum(close + 1, close+1 > 0 ? (high < nz(self, close+1) ? min(close+1, nz(self, close+1)) : close+1) : close+1, 250)

    x = 0.0 ; x := x[1] + volume     → REFUSES (never forgets its seed)
    x = 1.0 ; x := x[1] * 1.01       → REFUSES
    s = close+1 ; if s>0 → s := high → unchanged (no self-read, not a recurrence)

Script 10 selected column, verified structurally correct — TWO accumulators, the
outer holding a direction and the inner a stop, each owning its own `self`:

    accum(1, self == -1 && high > nz(accum((high+low)/2 + 3*atr(high,low,close,22), …
      … nz(self, (high+low)/2 + 3*atr(…)) …), …) ? 1 : … , 250)

## The four pieces

### 1. `forgetsItsSeed` — the convergence gate (module scope, beside `findTop`)

```js
function containsSelfSeries(node, table) {
  const spec = table.functions.accum
  if (!spec) return false
  const bind = spec.recurrence.binds
  const walk = (n) => {
    if (!n || typeof n !== 'object') return false
    if (n.type === 'series' && n.name === bind) return true
    return (n.args || []).some(walk)
  }
  return walk(node)
}

function forgetsItsSeed(node, table) {
  const spec = table.functions.accum
  if (!spec) return false
  const bind = spec.recurrence.binds
  const isSelf = (n) => !!n && n.type === 'series' && n.name === bind
  const carries = (n) => containsSelfSeries(n, table)
  const ok = (n) => {
    if (!n || typeof n !== 'object') return true
    if (isSelf(n)) return true
    if (!carries(n)) return true
    const args = n.args || []
    if (n.type === 'call' && (n.name === 'min' || n.name === 'max')) {
      const withSelf = args.filter(carries)
      return withSelf.length === 1 && ok(withSelf[0])
    }
    if (n.type === 'call' && n.name === 'nz') return args.every(ok)
    if (n.type === 'op' && n.name === '?:') return ok(args[1]) && ok(args[2])
    return false
  }
  return ok(node)
}
```

⛔ A ternary's CONDITION may test `self` freely — it picks a branch without
carrying the value. Only the ARMS must forget. Unrecognised shapes answer NO.

### 2. Resolver state (in the constructor, after `this.mutated = …`)

```js
this.recurrenceSeeds = new Map()    // name → the binding in scope at the [1] read
this.recurrenceColumns = new Map()  // name → the accumulator already built
this.buildingRecurrence = null      // the name whose recurrence is being built NOW
```

### 3. `plainRecurrence` (a method, immediately before `guardOffsetOfMutable`)

```js
plainRecurrence(node, tok) {
  if (!(node.n >= 1) || !node.arg || node.arg.type !== 'name') return null
  const name = node.arg.name
  if (!this.mutated.has(name)) return null
  const spec = this.table.functions.accum
  if (!spec) return null
  if (this.buildingRecurrence === name) {          // INSIDE its own update
    const bound = this.env.get(name)
    if (bound && !this.recurrenceSeeds.has(name)) this.recurrenceSeeds.set(name, bound)
    const base = cSeries(spec.recurrence.binds)
    return node.n === 1 ? base : { type: 'offset', value: node.n - 1, args: [base] }
  }
  if (this.recurrenceColumns.has(name)) {          // OUTSIDE — memo first
    return { type: 'offset', value: node.n, args: [this.recurrenceColumns.get(name)] }
  }
  const final = this.finalBindings.get(name)
  if (!final || final === this.env.get(name)) return null
  const seedHere = this.env.get(name)
  if (seedHere && !this.recurrenceSeeds.has(name)) this.recurrenceSeeds.set(name, seedHere)
  const column = this.resolveBinding(final, tok, name)
  if (!this.recurrenceColumns.has(name)) return null
  return { type: 'offset', value: node.n, args: [column] }
}
```

Call it in the `case 'offset'` arm, immediately BEFORE `guardOffsetOfMutable`:

```js
const plain = this.plainRecurrence(node, node.tok)
if (plain !== null) return plain
```

### 4. The wrap — replaces the generic tail of `resolveBinding`

Replaces exactly this line:
`try { return this.resolve(bound.node) } finally { this.stack.delete(bound); this.env = prevEnv }`

```js
const wasBuilding = this.buildingRecurrence
const isFinalOfMutable = !!name && this.mutated.has(name)
  && this.finalBindings.get(name) === bound
const prevStack = this.stack
if (isFinalOfMutable) { this.buildingRecurrence = name; this.stack = new Set() }
this.stack.add(bound)
const prevEnv = this.env
if (bound.env) this.env = bound.env
try {
  const body = this.resolve(bound.node)
  if (isFinalOfMutable && this.recurrenceSeeds.has(name)
      && containsSelfSeries(body, this.table)) {
    if (!forgetsItsSeed(body, this.table)) {
      throw new PineRefusal('pine:state',
        '`' + name + '` builds on its own previous bar without ever forgetting where '
        + 'it started, and this engine\'s accumulator re-seeds a fixed number of bars '
        + 'back — so it would become a rolling sum rather than a running total',
        bound.at || locate(tok))
    }
    const spec = this.table.functions.accum
    const seedBinding = this.recurrenceSeeds.get(name)
    this.recurrenceSeeds.delete(name)
    this.buildingRecurrence = wasBuilding
    const seed = this.resolveBinding(seedBinding, tok, name)
    const args = []
    args[spec.recurrence.seed] = seed
    args[spec.recurrence.body] = body
    args[spec.recurrence.warmup] = cNum(PINE_STATE_WARMUP)
    const built = cCall('accum', args)
    this.recurrenceColumns.set(name, built)
    return built
  }
  return body
} finally {
  this.stack.delete(bound)
  this.stack = prevStack
  this.env = prevEnv
  this.buildingRecurrence = wasBuilding
}
```

⭐ **THE FRESH CYCLE STACK IS LOAD-BEARING.** The same binding legally resolves
twice — `shortStopPrev` once outside the recurrence and once within its update —
and yields a DIFFERENT tree each time, because `shortStop[1]` is the accumulator
outside and `self` inside. The shared stack read that as `pine:cycle`.

## The four tests that then need deliberate updates

Each is a rail asserting behaviour this deliberately changes. **Invert them with a
note, do not delete them** — the guards they name are all still live.

1. `pine.variables.test.js` → *"the SAME accumulator with no `var` anywhere still
   refuses"*. It uses `x := x[1] + volume`, which STILL refuses — but with the new
   message. Check the assertion is on the guard, not the wording.
2. `pine.variables.test.js` → *"it fires on a REAL published script"*: script 10's
   guard set moves from `{pine:state}` to translating.
3. `pine.test.js` → the refusal corpus entry for the no-`var` accumulator: verify
   the LINE. `bound.at` points at the reassignment; `locate(tok)` pointed at the
   read and was one line off.
4. `__fixtures__/pineCorpus.json` → script 10 becomes `translates: true`,
   `usable: 5`; then the pinned totals in `pine.corpus.test.js`
   (`translating` 11→12, `columns` 47→52, `saveable` 11→12) and the guard-set size
   if `pine:state` stops firing anywhere.

## Before shipping

- Read the emitted formula for script 10 and check the accumulators are NESTED,
  not merged. A merged one reads `self` as two different things and every
  automated signal calls it a win — that is how attempt one nearly shipped.
- Mutation-check at least: delete the convergence gate (OBV must red), return the
  memo unconditionally, and make `plainRecurrence` always take the INSIDE branch.
- The Pine translator is JS-only, so there is no Python mirror — but the emitted
  tree is an ordinary `accum`, already parity-proven.

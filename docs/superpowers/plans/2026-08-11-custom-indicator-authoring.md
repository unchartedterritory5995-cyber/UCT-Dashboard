# Custom Indicator Authoring — the full program

> **Owner decision, 2026-08-11:** build the capability for a member to author any
> indicator or scan themselves, at TradingView's level of expressiveness. The
> concerns about scope were raised, heard, and overruled. This document is the
> sequenced plan; it exists so the program survives any one session's context.

**Goal:** a member opens an editor, writes an indicator, sees it on a chart, and
scans the universe on it — without us shipping a near-miss that looks like it
worked.

**The one rule that does not move:** a thing that cannot be computed must REFUSE
BY NAME, never quietly resolve to a neighbour. Today's session found three
separate cases of "green, saveable, silently wrong" (a hidden `hlc3` sold as a
spectral filter; an accumulator NaN on 400/400 bars; three corpus scripts counted
as translating with zero visible columns). Every phase below inherits that rule.

---

## Where we actually are — measured 2026-08-11, not estimated

- A member **can already author a recursive indicator.** Hand-written
  `accum(close, self + 0.1 * (close - self), 250)` returns `122.1743`; the
  declared `ema(close, 19)` returns `122.1743`. Identical.
- The closed table holds **124 names** (5 series · 15 operators · 50 functions ·
  54 scalars) with declared lookbacks, both lanes at 1e-9 parity.
- TC2000 reads **61 of 71** Worden spellings. Pine reads **10 of 21** real
  published scripts.
- Budget ceilings: `maxNodes 128` · `maxLookback 500` · `maxSeriesRefs 8`.

---

## Phase 1 — the authoring core (unblocks the whole DSP family)

**1.1 `self[n]` — multi-lag recurrence. THE KEYSTONE.**
Today `self` reads exactly one bar back; `self[1]` throws `interpret:recurrence`
("a running value reads its own past only inside its own update"). That single
limit is the entire distance between a custom indicator and a 2-pole filter —
Butterworth, SuperSmoother, every Ehlers design, Gaussian, Kalman-ish smoothers.
Strictly backward-looking, so it costs none of the safety properties.
- Both lanes + parity corpus case + declared lookback contribution.

**1.2 🔴 The save gate accepts a formula that THROWS.**
`accum(close, 0.2*close + 0.6*self + 0.2*self[1], 250)` measured
`evaluateSaysOk: true`, `saveGateSaysYes: true`, `repaint: non-repainting` — and
throws at interpret. A member can save an indicator that crashes when the chart
draws it. Fix with 1.1 (same code) — but the gate must reject *any* throwing
tree, not just this shape.

### 🔴 Phase 1 REPRIORITISED 2026-08-11 — measured, and I had it wrong twice

After `self[n]` shipped I measured what actually blocks a TUNABLE filter instead
of assuming. A fully-derived Butterworth — every coefficient computed inline from
the period, `pi` spelled as a literal — **already runs today**, in 405 characters
at **86 of the 128-node ceiling**.

So two items I had ranked as blockers are not:
- ⛔ **`pi`/`e` are unnecessary.** A numeric literal works, and the derived filter
  is MORE accurate than my hand-rounded constants (125.41819 vs 126.00998).
- ⚠️ **`let` is not the gate.** 86/128 leaves headroom for a 2-pole design. It
  stays worth building — a 4-pole or a busier indicator would meet the cap, and
  405 characters on one line is miserable to edit — but it does not block anyone.

**What actually blocks a member is UX, not engine capability:**
1. **User-declared inputs (1.4)** — the `20` in that formula is baked in. Without
   inputs an authored indicator is one frozen instance, not something tunable or
   shareable. THIS IS THE GATE.
2. **The editor (1.5)** — a 405-character formula in a single-line box.

⭐ The lesson for whoever picks this up: I predicted the blocker three times today
(`cum`, then `pi`, then `let`) and was wrong all three times. Measure the thing
before building for it — the probes cost minutes and each one changed the plan.

**1.3 Named intermediates (`let`).**
Butterworth computes `c1/c2/c3` once and reuses them. Without bindings a member
retypes subexpressions and meets `maxNodes 128` — a real ceiling and a bad
authoring experience regardless. Must fold to the same AST, so `astHash` and both
walkers are untouched.

**1.4 User-declared inputs. ✅ SHIPPED 2026-08-11.** Form + merge + one scope +
save gate + server-side key validation still OUTSTANDING (see below).

A member-declared `period` was driven end to end and works: `declaredInputs`
reads any `{key}` array off a definition, `lintRepaint` and `sentenceFor` take
that scope verbatim, and `interpret` takes the values by the same names. A
Butterworth whose coefficients are DERIVED from the input parses, lints
`non-repainting`, reads back in English, sits at 86/128 nodes, and is genuinely
tunable — period 20 → 125.41819, period 50 → 120.12551. An undeclared name still
refuses at `sentence:name`.

🔴 **The ONLY thing missing is the builder UI.** `BuilderSheet.buildDefinition`
writes `inputs: BUILDER_INPUTS.map(...)` — a frozen pair (`color`, `lineWidth`) —
so a member has no way to declare one. That single hardcoding is the whole gate.

**What is left, precisely:**
1. An input-row editor in `BuilderSheet` (key, type, label, default, min/max).
2. `buildDefinition` merges member rows with the two chrome ones.
3. The SAME scope must reach `evaluateFormula`, `freshnessFor` and the saved
   document — `buildDefinition` currently builds the freshness scope from
   `BUILDER_INPUTS` separately, which becomes a second authority the moment the
   member's list exists.
4. Server-side validation of member keys (`user_definitions`), since a definition
   is persisted and re-read.

✅ **1, 2 and 3 shipped together with the form** — `BuilderSheet` renders member
input rows, `buildDefinition` merges them beside the chrome pair, and the
freshness scope reads that SAME list (the second-authority trap, closed and
mutation-checked). A key that the closed table already owns refuses by name,
because `close` as an input would be shadowed by the real series and silently
compute something else. An invalid key shuts the save BUTTON, not just its row.

🔴 **STILL OUTSTANDING: item 4, server-side validation.** `user_definitions`
accepts the persisted document; a member key is not yet validated there. Until it
is, the guarantee is client-side only.

⛔ **Do not ship 1-3 without the form.** A definition shape that accepts inputs no
surface can create is this repo's most repeated defect (eight features "built,
tested, green, connected to nothing" on 2026-08-08). The rail
`app/src/components/chart/engine/ast/memberInputs.test.js` pins what already
works — including an assertion that `BUILDER_INPUTS` is still the frozen pair, so
the day the form ships that test tells you BY NAME rather than by silence.

**1.5 A real editor.**
Multi-line, live preview, errors at the character. ⭐ The refusal messages are
already the best part of this system — they name the token and the reason. They
need a surface, not a rewrite.

## Phase 2 — translator coverage (pasted scripts reach Phase 1)

### ⭐ PHASE 2 RE-ORDERED 2026-08-11 — measured, and 2.2 turned out to be DONE

**2.2 User-defined functions: ✅ ALREADY WORK.** Driven directly, all of these
translate today — single-expression bodies, several parameters, a body calling a
builtin, the same function used twice, and MULTI-STATEMENT bodies with local
bindings:

    f(x) => x * 2                      → close * 2
    g(a, b) => (a + b) / 2             → (high + low) / 2
    h(src, n) => ta.sma(src, n) * 2    → sma(close, 20) * 2
    k(x) =>                            → close * 2 + 1
        y = x * 2
        y + 1

**2.1 Tuple returns — ✅ SHIPPED 2026-08-11.**

⛔ Do NOT build it for builtins. Measured across the corpus, the right-hand side
of a destructure is: **42 × `request.security`** (Phase 3 — a different question),
**~19 × user-defined** (`feed`, `trigger`, `exrem`, …), and **1 × `ta.dmi`**.
Building builtin tuples would unlock exactly one call site in twenty-one scripts.

**The three changes, with their anchors:**

1. `foldStatements` — its final bare-expression arm (`value = exprBinding(...)`).
   A statement that is `[a, b, c]` with no top-level `=` becomes
   `{kind: 'tuple', parts: [exprBinding…], at}` instead of an expression. Split on
   commas with the depth-aware `findTop` idiom; a 1-element `[x]` is NOT a tuple.
2. The top-level destructure arm (currently `markOpaque(... 'pine:tuple' ...)`).
   Parse the RHS, resolve the callee in `env`, and only when its binding is
   `{kind:'fn'}` whose `value.kind === 'tuple'` bind each name to
   `{kind: 'tuplePart', fn, args, index, env}`. **Everything else keeps refusing**
   — `request.security` above all. A tuple this engine cannot take apart must
   never resolve to its first element.
3. `resolveBinding` — a new `tuplePart` arm that does what the `kind: 'fn'` call
   already does (`this.frames.push(args.map(...))`, swap `this.env`, resolve) but
   resolves `parts[index].node` rather than `value.node`. Mirror the existing
   `finally { this.frames.pop(); this.env = prevEnv }`.

✅ **BUILT — and the corpus number did NOT move, which is the honest result.**
Script 02 cleared `pine:tuple` and met `pine:state` on the very next line, so it
still does not translate. 10 of 21 stands. ⭐ That is `lesson_a_refusal_count_is_
not_a_progress_metric` playing out exactly as written: a column is usable only
when EVERY wall in its chain is down, and closing one wall moves names to the
next one. The feature is right; the score is unchanged; both statements are true.

⚠️ **TWO THINGS THE MUTATION HARNESS CORRECTED, WORTH READING BEFORE THE NEXT ONE:**
1. `findTop` **cannot find a bracket** — it `continue`s on every one, so its
   predicate is never offered a `]`. The first cut asked it for the closing
   bracket, got -1 every time, and did nothing at all while every test still
   passed for the old reason. `matchBracket` exists because of that.
2. The `kind === 'tuple'` check does NOT protect `request.security` — that is
   safe for a different reason (a builtin is not in `env` as a user function).
   Dropping the check SURVIVED the first mutation run. What it actually guards is
   a user function returning a SCALAR, and that case had no test until the
   survivor pointed at it. **A guard tested only through the scenario that
   motivated it can be guarding nothing.**

⚠️ **Original note, kept because the reasoning still holds:** The three changes are small
but they must land together: parts 1 and 2 without 3 produce a binding nothing
can resolve, and part 2 without its `kind === 'tuple'` check would hand
`request.security`'s first element to a name expecting its third — a translation
that parses, saves, scans and is WRONG. That is the failure mode this whole
document is organised against, and a half-applied translator change at a session
boundary is how it arrives. The anchors above are exact; this is a contained
piece of work for a session with room to finish and mutation-check it.

**Expected payoff, so it can be checked rather than assumed:** scripts refusing
ONLY at `pine:tuple` should clear — `02-ict-retracement` is the corpus candidate,
and the Butterworth Spectral Trend the owner supplied needs this plus nothing
else structural. Re-measure with the intake bench; do not assume.
- **2.3a ✅ SHIPPED — a `var` reading its own past inside its own update.**
  `s := cond ? 1 : s[1]` translates. ⛔ Pine counts from ONE and the accumulator
  counts from ZERO: `s[1]` IS `self`, `s[2]` is `self[1]`. The rail asserts the
  two spellings produce the IDENTICAL tree, because an off-by-one here reads a
  bar too far back on every bar and nothing about the output looks wrong.
  ⚠️ Corpus unmoved at 10/21 — script 02's refusal walked from line 87 to line 88.
  The next wall is a state's `[1]` read from outside its update but INSIDE a
  user-defined function, which the isolated shape handles and the real script
  does not; that difference is the next thing to measure.
- **2.3 Conditional reassignment** — a `var` updated inside an `if`, which is what
  produced the dead accumulator this session.
- **2.4 Session/`time` builtins.**

## Phase 3 — multi-symbol and multi-timeframe

`request.security`. **Chart lane first**, where one symbol is on screen and there
is no universe sweep. Whether a SCAN may read another symbol is a separate
product decision with a real cost (a scan column currently reads one symbol by
construction) — decide it explicitly, do not let it arrive by accident.

## Phase 4 — the drawing layer

Boxes, lines, labels, tables. ⛔ This is NOT a formula feature: the engine
produces one number per bar, and SMC toolkits / order blocks / volume profiles
are drawing programs. It needs its own output shape, its own renderer, and its
own answer to "what does it mean to scan on this?" (probably: you don't).

## Phase 5 — arrays, loops, custom types

Pine v6 has arrays, matrices, maps, UDTs, `for`. The table is deliberately total
— guaranteed to terminate — which is what lets a scan run unattended over 3,685
symbols. ⚠️ Adding these means an execution model with an explicit step/time
budget, not simply new node types. Chart lane can afford it long before the scan
lane can.

## Phase 6 — strategies and backtesting

Order simulation is a different engine from indicator evaluation. Separate build,
sequenced last on purpose.

---

## Sequencing note

Phases 1 and 2 together are what take a pasted Butterworth from refusing to
running, and they compound: every Phase 1 primitive makes more of Phase 2 land.
Phases 4-6 are separate products wearing the same feature request, and each
should be re-scoped against real member demand when its turn comes rather than
built because it appears on this list.

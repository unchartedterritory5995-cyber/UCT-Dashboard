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

**1.4 User-declared inputs.**
`length`, `source`, `multiplier` with defaults and ranges, so an indicator is
tunable and shareable instead of hard-coded. `BUILDER_INPUTS` /
`BUILDER_INPUT_SCOPE` are the existing seam.

**1.5 A real editor.**
Multi-line, live preview, errors at the character. ⭐ The refusal messages are
already the best part of this system — they name the token and the reason. They
need a surface, not a rewrite.

## Phase 2 — translator coverage (pasted scripts reach Phase 1)

- **2.1 Tuple returns** `[a, b, c] = f(...)` — the most common structural blocker
  in the corpus (10 refusals in one script alone).
- **2.2 User-defined functions** — Pine `f(x) => ...`.
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

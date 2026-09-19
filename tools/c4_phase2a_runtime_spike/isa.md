# The spike ISA — one instruction set, three implementations

C4 Phase 2A. This is a **measurement instrument, not the runtime.** Its only job
is to answer §6's question with numbers: *can one semantic runtime serve both the
browser chart and the backend screener without unacceptable overhead, and what
does each candidate architecture actually cost?*

⛔ **IT IS NOT A PINE RUNTIME AND MUST NOT GROW INTO ONE.** No types, no `na`
model, no scopes, no UDF frames, no object refs. It executes one hand-encoded
program shape that is *representative of the dispatch work* a real runtime does —
which is the only thing being measured.

## Why a flat instruction array rather than a tree

Phase 1 measured a per-bar AST walk at 4.96–6.06× an optimal columnar pass and a
flat bytecode loop at 2.66–2.78×. The shape is settled; this spike carries it
forward and asks a different question — **cost in each host language**.

## Instruction encoding

A program is a flat `Int32Array`-shaped list of `[op, a, b]` triples. Operands are
indices, never values, so the same program JSON drives every implementation and
no host gets to constant-fold something another host cannot.

| op | name | effect |
|---|---|---|
| 0 | `PUSH_CONST a` | push `consts[a]` |
| 1 | `PUSH_SERIES a` | push `series[a][bar]` (0=open 1=high 2=low 3=close) |
| 2 | `PUSH_HIST a b` | push `series[a][bar-b]`, NaN when unavailable |
| 3 | `ADD` | NaN-propagating |
| 4 | `SUB` | NaN-propagating |
| 5 | `MUL` | NaN-propagating |
| 6 | `DIV` | NaN-propagating; **NaN on a zero divisor** (not ±Inf) |
| 7 | `LT` | NaN-propagating; 1.0 / 0.0 |
| 8 | `LOAD_LOCAL a` | bar-scoped frame slot |
| 9 | `STORE_LOCAL a` | |
| 10 | `LOAD_PERSIST a` | survives across bars — the `var` shape |
| 11 | `STORE_PERSIST a` | |
| 12 | `JUMP_IF_FALSE a` | pops; NaN counts as false |
| 13 | `JUMP a` | |
| 14 | `ARR_PUSH a` | pops a value onto array `a` |
| 15 | `ARR_GET a` | pops an index, pushes element (NaN out of range) |
| 16 | `ARR_SIZE a` | |
| 17 | `EMIT a` | pops into output series `a` for this bar |
| 18 | `POP` | |
| 19 | `HALT` | ends the bar |

⭐ **`na` IS MODELLED AS NaN PROPAGATION IN EVERY ARITHMETIC OP, deliberately.**
Phase 1's probe skipped it and said so — "a floor, not a budget". A real runtime
pays that check on every operation, so the spike pays it too. This is the single
biggest reason these numbers are higher than Phase 1's 2.3 ns/instruction, and
they are the honest ones for a decision.

## The program under test

Per bar, in source terms:

```
acc  := acc * 0.9 + close * 0.1     // persistent state (var / :=)
i    = 0 ; sum = 0                   // bar-local frame slots
while i < LOOKBACK:                  // a real loop, via JUMP_IF_FALSE
    sum := sum + close[i]            // history read inside the loop
    i   := i + 1
arr.push(sum / LOOKBACK)             // array mutation across bars
emit(sum / LOOKBACK - acc)
```

State + history + loop + array + arithmetic in one program — §76's "composite
complex", and the combination Phase 1 measured as 19% of real scripts.

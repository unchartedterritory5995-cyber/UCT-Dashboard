# The value-model spike — one program, three representations

Wave: Pine runtime lane, plan 2 of 7 (`docs/superpowers/plans/` — see the RVOL
slice spec §4.4). This is a **measurement instrument, not the runtime**, and it
must not grow into one. It exists to answer one question with numbers and one
control:

> The VM holds `Float64Array` series and outputs. Strings, arrays, booleans and
> object handles have no representation. What should a slot BE?

C4 Phase 2A settled the dispatch shape (a flat instruction array) and the host
language (JavaScript) the same way: one assembled program, several
implementations, agreement proved before a single timing number was quoted.

## The three candidates

| | representation | numbers | strings / arrays | cost when a slot is a number |
|---|---|---|---|---|
| **A — boxed** | one JS array of JS values | JS doubles in a polymorphic array | the value itself | the array is polymorphic, so every read is a type check |
| **B — NaN-boxed** | one `Float64Array` | plain doubles | a quiet-NaN payload indexing a side table | none in theory — the slot is already a double |
| **C — split banks** | a `Float64Array` **plus** a JS array, chosen per slot at compile time | numeric bank | boxed bank | none, and no tag to read |

C is only possible because Pine is statically typed enough to know, at compile
time, which bank a slot belongs to — a declared type (`float x`, `array<string>
toks`) or an inferred one. Where the compiler cannot decide, the slot goes to the
boxed bank, so C degrades to A rather than to something wrong.

## ⛔ THE CONTROL THAT CAN RULE B OUT ON CORRECTNESS, NOT SPEED

NaN-boxing hides a payload in the mantissa of a quiet NaN. That is standard in
C++ interpreters, where the compiler controls every move. In JavaScript the
engine may **canonicalise** a NaN as it passes through a variable, an argument or
the operand stack — and a canonicalised NaN has lost the payload, which means a
string silently becomes a different string, or nothing at all.

So this spike does **not** assume payload survival. It measures it: a payload is
written, pushed through the operand stack, stored into a slot, read back, and
compared. If it does not survive, B is out regardless of its timing, and the
timing is reported anyway so the reason is on the record.

## The program

One program, representative of the work the RVOL dashboard actually does per
evaluation, and deliberately mixed — a numeric recurrence beside string building
beside array growth, because a benchmark that is 100% numeric would flatter B and
C and say nothing about a member's dashboard.

Per bar:

```
acc  := acc * 0.9 + close * 0.1          // numeric state, a recurrence
arr  := array.new()                       // a fresh collection every bar
i    := 0
loop K times:                             // K symbols, like a watchlist row set
    v  := close * (i + 1) / 100
    arr.push(v)
    s  := "S" + str(i) + ":" + str(v)     // string building
    hit := (s == LAST_S)                  // string comparison
    i  := i + 1
emit acc
emit arr.size()
emit hit ? 1 : 0
```

`na` propagates through every numeric op, exactly as the columnar lane's
operators do — the runtime imports those rather than re-implementing them, and
this spike copies the NaN rule rather than inventing one.

## Instruction encoding

A flat list of `[op, a, b]` triples, operands are indices and never values, so
one program JSON drives all three implementations and no host may constant-fold
what another cannot.

| op | name | effect |
|---|---|---|
| 0 | `PUSH_CONST a` | push `consts[a]` (typed: number or string) |
| 1 | `PUSH_SERIES a` | push `series[a][bar]` |
| 2 | `LOAD a` | push slot `a` |
| 3 | `STORE a` | pop into slot `a` |
| 4–7 | `ADD SUB MUL DIV` | numeric, NaN-propagating |
| 8–10 | `LT GT EQ` | compare; `EQ` also compares strings |
| 11–13 | `AND OR NOT` | boolean |
| 14 | `NUM_TO_STR` | pop a number, push its string |
| 15 | `STR_CONCAT` | pop b, pop a, push `a + b` |
| 16 | `ARR_NEW` | push a new empty collection |
| 17 | `ARR_PUSH` | pop value, pop collection |
| 18 | `ARR_GET` | pop index, pop collection, push element |
| 19 | `ARR_SIZE` | pop collection, push its size |
| 20 | `JMP_IF_FALSE t` | pop a boolean |
| 21 | `JMP t` | unconditional |
| 22 | `EMIT a` | pop into `outputs[a][bar]` |
| 23 | `PUSH_NA` | push `na` |

## What this spike is NOT

No scopes, no UDF frames, no object lifetimes, no `request` contexts, no
warm-ups, no vendor semantics. Those belong to the runtime and are already
designed; putting any of them here would make the instrument the product, which
is the mistake `lesson_a_quantised_instrument_can_manufacture_a_finding` records.

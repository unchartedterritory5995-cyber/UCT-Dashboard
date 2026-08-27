# TC2000 PCF — the coverage number that did not exist

**Vocabulary source:** <https://help.tc2000.com/m/69445/l/745531-personal-criteria-formula-syntax-table>
— Worden's own syntax table, fetched 2026-08-09. **Measured by running 71 real PCF
expressions through the shipped `parsePcf`**, not by reading the translator.

## ⛔ THE LIVE NUMBER IS NOT IN THIS FILE, AND THAT IS THE FIX

⚰️ **THIS DOCUMENT CARRIED THE COVERAGE FIGURE IN ITS OWN HEADING (`35 / 71`, then
`40 / 71`) AND A PASS COLUMN PER GROUP, AND EVERY ONE OF THEM WENT STALE.** A review
on 2026-08-27 found the heading wrong, six of the twelve group rows wrong, four
oscillator rows wrong, and — worst — a hand-typed roster of *"formulas this table
does not declare"* that had just been deleted from `pcf.js` for exactly that reason,
still standing here as a fifth copy. ⛔ **A count in prose beside a list somebody
else maintains is this repo's most repeated defect**, and this file was a copy of
one. So the counts are gone from the prose, and every one of them is now cited to
the artifact that computes it.

| the fact | the ONE artifact that owns it |
|---|---|
| the corpus — 71 of Worden's own spellings, one per vocabulary entry | `app/src/components/chart/engine/ast/pcf.vocabulary.test.js::VOCABULARY` |
| how many read, **per group and in total** | the same file's `EXPECTED`, pinned in BOTH directions — a loss is a regression, a gain is a deliberate edit |
| **which** spellings refuse and **why each one does** | `tests/test_ast_tc2000_remainder.py::NEVER_READ` and `REACHABLE_ELSEWHERE` — a roster with a reason per entry, asserted EQUAL to the measured refusal set |
| the reachable ceiling | derived in that same test as `len(outcomes) - len(NEVER_READ)`, never typed |
| the refusal SENTENCES a member reads | `pcf.js::PCF_DIFFERENT_FORMULA` and `closedTable.json::_functions_excluded` |

Reproduce the whole measurement. Both commands drive the **shipped** reader over the
**shipped** vocabulary, so neither can agree with a stale copy of anything:

```
# from app/
npx vitest run src/components/chart/engine/ast/pcf.vocabulary.test.js
# from the repo root
python -m pytest tests/test_ast_tc2000_remainder.py -q
```

## 📅 The 2026-08-27 reading — a dated snapshot, not an authority

Produced by the second command above, which walks `VOCABULARY` through the shipped
`parsePcf` and reports per group. ⚠️ **If this section disagrees with those two
commands, this section is the stale one** — which is the whole reason the date is on
it and the counts are not.

| Group | reads | what refuses, and why |
|---|---|---|
| Price letters (`C`, `C1`, `C(1)`, `O`, `H`, `L`, `V`) | all | — |
| Relational (`>`, `>=`, `<`, `<=`, `=`, `<>`) | all | — |
| Crossing (`XUP`, `XDOWN`) | all | — |
| Conditional (`IIF`) | all | — |
| Aggregates (`MAX`, `MIN`, `MAXH252.1`, `STDDEV`, `SUM`) | all | — |
| Math operators (`*`, `/`, `^`, `MOD`, integer divide) | all | — |
| Logical (`AND`, `OR`, `NOT`, `XOR`, `NAND`, `NOR`, `XNOR`) | all | the last four are DESUGARED from the declared `&&` / `\|\|` / `!` — no new engine capability |
| Math functions (`ABS`, `SQR`, `LOG`, `CLG`, `EXP`, `SGN`, `GREATEST`, `LEAST`) | all | — |
| Trig / hyperbolic (`SIN`, `COS`, `TAN`, `ARCTAN`, `SINH`) | all | ⚠️ the corpus's five, **not** Worden's twenty-three — see the reversal note below |
| Stateful (`CountTrue`, `SinceTrue`, `TrueInRow`) | all | built on `accum` — see below |
| **Moving averages** | most | `FAVG` and `HAVG`: two averages this table does not declare. **Reachable**, just not built. |
| **Oscillators** | most | six refuse, and **not for one reason** — see the next section |

## The oscillators — the only group whose refusals are the DANGEROUS kind

Refusing by name (`pcf:name`) means the door is honest; it just has fewer keys than
the lock it was built for. What matters is that the refusals here are **three
different facts and they are not interchangeable**:

1. ⛔ **DIFFERENT FORMULAS WEARING FAMILIAR NAMES** — `RSI` (both spellings) and
   `WSTOC`. Worden's own table says plainly that its `RSI` is **not Wilder's**, and
   that `WRSI` is — and `WRSI` is already mapped to our `rsi`. Pointing `RSI` at the
   same function would produce a formula that parses, lints, saves, scans, and is
   **wrong on every bar**: the `MIN`/`lowest` trap the translator's own header warns
   about, which no refusal surface can catch because nothing refuses. ⭐ So they
   refuse BY NAME WITH THE REASON, and typing `RSI14` tells you to write `WRSI14`.
   `WSTOC` refuses on a **cited** ground rather than the un-actionable *"is a
   different formula"* (which is true of any two formulas): Worden publishes
   `Worden Stochastic = (100/n-1)(Rank)`, that is a RANK rather than a range, and
   this table declares no rank function — **so the refusal names what would unblock
   it**, `rank(source, n)`, after which the spelling becomes an exact rewrite.
2. ⛔ **A LEVEL THIS TABLE REFUSES BY CONSTRUCTION** — `OBV`. Worden's `OBVy` is an
   SMA of the **cumulative** on-balance volume, and a running total from the first
   bar is a fact about where the fetch started rather than about the market;
   TC2000's own page calls that level *"statistically irrelevant"*. The bounded
   `obvN(n)` this engine ships is a **different quantity**, and the refusal says so
   instead of quietly pointing the spelling at it.
3. ⚠️ **WORDEN-PROPRIETARY AND UNPUBLISHED** — `MS` (MoneyStream) and `TSV`. A
   translator that guessed would put a number under a name members trust, which is
   the same failure shape as approximating cup-with-handle. **The honest outcome is
   a permanent named refusal, not a best effort** — and each of them names the one
   thing that would change it: Worden publishing the formula on its own indicator
   page, the way it already has for the Worden Stochastic.

A control asserts an ordinary unknown name does **not** get one of these sentences,
so the explanation cannot become boilerplate glued to every refusal.

## ⭐⭐ The three stateful functions are what `accum` was built for

`CountTrue(b, x)` · `SinceTrue(b, x)` · `TrueInRow(b, x)` — all three refused until
the bounded recurrence landed, and all three became expressible the moment it did:

```
TrueInRow(C > O, 10)  →  accum(0, close > open ? self + 1 : 0, 10)
CountTrue(C > O, 20)  →  accum(0, self + (close > open ? 1 : 0), 20)
```

⭐ `TrueInRow` is a consecutive-streak counter, which is exactly the shape Qullamaggie's
*"up 3-5+ days in a row"* needs — the Pine corpus, the TC2000 vocabulary and the
setup research all arrive at the same primitive from three directions.

⚠️ `SinceTrue` returns **-1 when the condition never occurred within the window**, and
that sentinel matters: `-1` is not "zero bars ago". Mapping it to a bare accumulator
without reproducing the sentinel would make "never happened" read as "happened just
now" — inverted, and silent.

## ⚰️ WHAT THIS FILE GOT WRONG — TWICE, THE SAME WAY

**First draft (2026-08-09).** It said *"13 of 16 oscillators fail — and the engine
already computes most of them."* **Only three did.** Checked one by one against the
manifest, `CCI`, `DIPLUS` and `DIMINUS` were genuinely missing spellings for maths
this engine already had. The rest were not spelling gaps at all: some were formulas
the table did not declare, and the others were **different formulas wearing familiar
names** — the dangerous category above.

**Second draft (2026-08-09 → 2026-08-27).** That correction then hand-typed its own
roster of the formulas *"this table does not declare"*. ⛔ **It rotted within two
days and stayed wrong for eighteen more**: `ADX` was declared on 2026-08-11 and
`AROONUP`, `AROONDOWN` and `BOP` on 2026-08-27 — the same day the identical roster
was deleted from `pcf.js` with the note *"a hand-typed roster beside the map it
describes rots the first time the map moves."* It rotted here for precisely that
reason, and the task that deleted the code copy walked straight past the prose one.

⭐ **So no roster is written here any more.** What this table does not declare is
whatever `NEVER_READ` and `REACHABLE_ELSEWHERE` say it is, and those two are asserted
equal to the refusal set the shipped reader actually produces — a claim that cannot
go stale without a red test.

## The work, in the order it pays

1. ~~The oscillator spelling map~~ — **DONE, and it was three rows, not eight**
   (`CCI`, `DIPLUS`, `DIMINUS`).
2. ~~The three stateful functions~~ — **DONE.** Built on `accum`, with the `-1`
   sentinel carried explicitly and evaluated over hand-counted bars rather than
   only translated. ⚠️ The seed and the body BOTH had to emit `u-` over a positive
   literal instead of a negative `num`, or `SinceTrue(...)` and its written-out
   equivalent were two `astHash`es for one column — caught by the corpus's
   tree-equality assertion, and missed on the first attempt because only the body
   was fixed.
3. ~~Four logical operators~~ — **DONE.** `XOR` / `NAND` / `NOR` / `XNOR` are DERIVED
   from the declared `&&` / `||` / `!`, so they were desugaring, not new capability.
4. ~~Five math functions~~ — **DONE.** `SQR`, `LOG`, `CLG`, `EXP`, `SGN`.
5. ~~`SUM`, `^`, `MOD`, integer divide~~ — **DONE.**
6. ~~`ADX`, and `STOC<period>.<smoothing>`~~ — **DONE, and neither cost new
   vocabulary.** ADX's blocker was never the maths but the `lookback` GRAMMAR — its
   window is `2 x period`, which the table could not say until `2*arg3` landed.
   `STOC`'s smoothing is a moving average OVER the stochastic, so the tree is
   hash-identical to `sma(stoch(...), 3)`. ⛔ In both, the dotted number is
   SMOOTHING and not an offset, and a mismatch REFUSES rather than quietly returning
   the unsmoothed value.
7. ~~`AROONUP`, `AROONDOWN`, `BOP`~~ — **DONE (2026-08-27).** Worden publishes the
   Aroon *spelling* with no formula at all, so the maths is cited to Chande's
   published `((25 - Days Since 25-day High)/25) x 100`. Its window is `n + 1` bars,
   which is arithmetic rather than a choice: over `n` bars "days since" maxes at
   `n - 1` and the indicator could never print its published 0.
8. **`FAVG` and `HAVG`** — the only two spellings still open that are not a
   principled refusal. Front-weighted and Hull moving averages: new manifest
   entries, not oscillator plumbing.
9. ⛔ **The remaining eighteen trig and hyperbolic functions: still declined, and the
   reason is recorded.** ⚰️ THIS ITEM ONCE READ *"Trig and hyperbolic: decline, and
   record why"* FULL STOP, AND THAT IS NO LONGER WHAT SHIPPED. The corpus's five
   representative spellings (`SIN`, `COS`, `TAN`, `ARCTAN`, `SINH`) were declared
   with the pure-math block, because they are deterministic mathematics with no
   formula to get subtly wrong and they cost no judgement. The other eighteen of
   Worden's twenty-three stay declined on the original ground: **no published TC2000
   screen in evidence uses one**, and adding eighteen manifest entries to move a
   coverage percentage would be measuring the yardstick instead of the work.

## What this file is really for

⚠️ **The number was unmeasurable before, and that was the actual defect.** Pine had 21
real published scripts with a snapshot that goes red if any one regresses; TC2000 had
8 hand-written cases and a claim of *"18 live spellings, 0 blocked"*. ⛔ **`0 blocked`
out of 8 is not a coverage number, it is the absence of one** — and the honest figure,
once the vocabulary became the yardstick, was under half. ⭐ **The fix was not more
translator code — it was finding the yardstick.** With Worden's own table as the
corpus, every change to `pcf.js` has a number it must not lower.

⭐⭐ And the yardstick is a RAIL rather than a document: `pcf.vocabulary.test.js` pins
the total AND each group, in BOTH directions, so a gain in one group cannot hide a
loss in another — which is exactly how a single reassuring number hid the truth the
first time. **This file is the argument. That file is the number.**

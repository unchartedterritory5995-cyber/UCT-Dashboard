# TC2000 PCF — the coverage number that did not exist

**Vocabulary source:** <https://help.tc2000.com/m/69445/l/745531-personal-criteria-formula-syntax-table>
— Worden's own syntax table, fetched 2026-08-09. **Measured by running 71 real PCF
expressions through the shipped `parsePcf`**, not by reading the translator.

## 🔴 35 / 71 → ⭐ 37 / 71 (same session)

Before this, the claim on record was *"18 live spellings, 0 blocked"* against an
8-case corpus. ⛔ **`0 blocked` out of 8 is not a coverage number, it is the absence
of one** — and the honest figure, once the vocabulary is the yardstick, is under half.

| Group | Pass | Notes |
|---|---|---|
| Price letters (`C`, `C1`, `C(1)`, `O`,`H`,`L`,`V`) | **6/6** | including both offset spellings |
| Relational (`>`,`>=`,`<`,`<=`,`=`,`<>`) | **4/4** | |
| Crossing (`XUP`, `XDOWN`) | **2/2** | |
| Conditional (`IIF`) | **1/1** | |
| Aggregates (`MAX`,`MIN`,`MAXH252.1`,`STDDEV`) | 6/7 | `SUM(w,x)` missing |
| Moving averages (`AVG`,`XAVG`,`FAVG`,`HAVG`) | 5/7 | `FAVG`, `HAVG` missing |
| Math operators | 2/5 | `^`, `MOD`, `\` (integer divide) missing |
| Logical | 3/7 | `XOR`, `NAND`, `NOR`, `XNOR` missing |
| Math functions | 3/8 | `SQR`,`LOG`,`CLG`,`EXP`,`SGN` missing |
| **Oscillators** | 3/16 → **5/16** | 🔴 see below |
| **Stateful** (`CountTrue`,`SinceTrue`,`TrueInRow`) | **0/3** | ⭐ see below |
| Trig / hyperbolic | 0/5 | 23 functions; no trading use found |

## The oscillators — 11 of 16 still refuse, and only three were ever cheap

⚰️ **THIS SECTION FIRST SAID "13 of 16 fail and the engine already computes most of
them", AND THAT WAS WRONG.** Only three were missing spellings for maths the engine
had: `CCI`, `DIPLUS`, `DIMINUS` — all three mapped, which is the whole of the 35→37
move. The full correction is below under ⚰️; the table that follows is the checked
version, kept because the wrong claim is exactly the kind a reader would otherwise
inherit from the heading.

Refusing by name (`pcf:name`) means the door is honest; it just has fewer keys than
the lock it was built for.

| Refuses today | Engine has it? |
|---|---|
| `RSI14`, `RSI(14,1,0)` | ⛔ NO — Worden says its RSI is **not Wilder's**; ours is. `WRSI` is the match, and it already worked |
| `CCI20` | ✅ `cci` — **mapped now** |
| `ADX14.14` | ⚠️ `plusDI`/`minusDI` ship; ADX itself is not declared |
| `DIPLUS14`, `DIMINUS14` | ✅ `plusDI`, `minusDI` — **mapped now** |
| `WSTOC14.3.0` | ⚠️ `stoch` ships; the Worden variant is a different formula |
| `STOC14.3` | ⚠️ `stoch` ships but takes NO smoothing argument, so a smoothing of 3 refuses `pcf:parameter`. ⛔ NOT a shape bug — an honest refusal, and I first filed it as a bug |
| `AROONUP25`, `AROONDOWN25` | ❌ not declared |
| `BOP20`, `MS20`, `OBV20`, `TSV20` | ❌ Worden-proprietary; MS and TSV have no public formula |

⚠️ **`MS` (MoneyStream) and `TSV` are Worden's own, and their formulas are not
published.** A translator that guessed at them would produce a number under a name
members trust — the same failure shape as approximating cup-with-handle. The honest
outcome for those two is a permanent named refusal, not a best effort.

## ⭐⭐ The three stateful functions are what `accum` was built for

`CountTrue(b, x)` · `SinceTrue(b, x)` · `TrueInRow(b, x)` — all three refuse today,
and all three became expressible **this session** when the bounded recurrence landed:

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

## ⚰️ WHAT I GOT WRONG IN THE FIRST DRAFT OF THIS FILE

It said *"13 of 16 fail — and the engine already computes most of them."* **Only
three did.** Checked one by one against the manifest: `CCI`, `DIPLUS` and `DIMINUS`
were genuinely missing spellings for maths this engine already had, and those three
are now mapped. The other ten are not spelling gaps at all — seven are formulas this
table does not declare (`ADX`, `AROONUP`, `AROONDOWN`, `BOP`, `OBV`, `FAVG`, `HAVG`)
and four are **different formulas wearing familiar names**.

⛔ THAT SECOND CATEGORY IS THE DANGEROUS ONE, and mapping it would have been the
`MIN`/`lowest` trap the translator's own header warns about: Worden's table says
plainly that its `RSI` is **not Wilder's**, and that `WRSI` is — and `WRSI` is
already mapped to our `rsi`. Pointing `RSI` at the same function would have produced
a formula that parses, lints, saves, scans, and is wrong.

⭐ So they refuse BY NAME WITH THE REASON now: typing `RSI14` tells you to use
`WRSI14`. `MS` and `TSV` say the formula is Worden-proprietary and unpublished. A
control asserts an ordinary unknown name does NOT get one of these sentences, so the
explanation cannot become boilerplate glued to every refusal.

## The work, in the order it pays

1. ~~The oscillator spelling map~~ — **DONE, and it was three rows, not eight.**
2. **The three stateful functions** — now that `accum` exists, plus the `-1` sentinel
   for `SinceTrue`.
3. **Four logical operators** — `XOR`/`NAND`/`NOR`/`XNOR` are all derivable from the
   declared `&&`/`||`/`!`, so this is desugaring, not new engine capability.
4. **Five math functions** — `SQR`, `LOG`, `CLG`, `EXP`, `SGN`. `SGN` already exists
   (`sign`, added today); the other four are new manifest entries.
5. **`SUM`, `FAVG`, `HAVG`, `^`, `MOD`, `\`** — small, individually cheap.
6. ⛔ **Trig and hyperbolic: decline, and record why.** Twenty-three functions, and no
   published TC2000 screen in evidence uses one. Adding 23 manifest entries to move a
   coverage percentage would be measuring the yardstick instead of the work.

## What this file is really for

⚠️ **The number was unmeasurable before, and that was the actual defect.** Pine had 21
real published scripts with a snapshot that goes red if any one regresses; TC2000 had
8 hand-written cases and a claim. ⭐ **The fix was not more translator code — it was
finding the yardstick.** With Worden's own table as the corpus, every future change to
`pcf.js` has a number it must not lower, and this document is the baseline: **37/71**, and it is now a RAIL rather than a document: `app/src/components/chart/engine/ast/pcf.vocabulary.test.js` pins the total AND each group, in BOTH directions, so a gain in one group cannot hide a loss in another — which is exactly how a single reassuring number hid the truth the first time.

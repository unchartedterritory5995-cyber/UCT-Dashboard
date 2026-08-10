# The Bulkowski index — 196 named chart patterns, with a re-fetchable address for each

> ## ⚰️ CORRECTION 2026-08-10 — PIVOT DETECTION WAS NEVER MISSING
>
> This file (and two others, and four reports) called pivot detection **"the missing
> primitive"** and **"the bottleneck"**. **It was wrong.** A pivot high with `L` bars
> left and `R` right is already sayable:
>
> ```
> high[R] == highest(high, L + R + 1)
> ```
>
> The bounded backward offset supplies the candidate, `highest` supplies the window,
> and `accum` supplies the memory for *last pivot value* and *bars since*. Three
> features that landed for three unrelated reasons compose into it. ⭐ The `R`-bar
> lag is not a compromise — a pivot is unknowable until `R` bars later, and confirming
> it late is what keeps the value **non-repainting**, which `astReach` verifies.
>
> ⛔ **What this does NOT unlock:** cup-with-handle's *"U-shaped, not V-shaped"* and
> *"rims near the same price level"* are still not expressible — those need shape
> comparison between pivots, not pivot detection. The harmonic ratios need the same.
> So the blocker was real; **I named the wrong thing as its cause.**
>
> Proven in `app/src/components/chart/engine/ast/pivots.test.js`, including the control
> that shows the obvious seed (`high[R]`) inventing a pivot level that does not exist.



**Source:** <https://www.thepatternsite.com/chartpatterns.html>, fetched 2026-08-09.
**Every page below is `http://thepatternsite.com/<slug>.html`** — so this file is a
work queue, not just a list: any row can be pulled for its identification rules and
its measured performance without another discovery step.

⭐ **WHY THIS SOURCE OVER A LISTICLE.** Bulkowski identifies each pattern with written
rules AND publishes measured statistics over a stated sample — break-even failure
rate, average rise/decline, throwback/pullback rate, and how often the measure rule
is met. That means a criterion taken from here arrives with a number **and** with the
evidence for the number, which is what the catalog's grounding rule is for. Most
pattern lists on the open web are the same eight patterns re-described.

⚠️ **A NAME IS NOT A CRITERION.** This file is the MAP. Nothing here is expressible
until its page has been read and its rules written into `setup_criteria.json` with a
quote. ⛔ Do not let the size of this list stand in for coverage — 196 addresses is
196 pieces of work, and the honest count of *defined* setups is still what is in the
criteria file.

⚠️ **SEVERAL ROWS ARE NOT PATTERNS AT ALL** — `Asset protection`, `Averaging down`,
`Best buy days/months`, `Book value`, `10 Baggers`, `38% Exit`, `Elevator stop`. They
are money-management or seasonality essays. Filed here because the index lists them,
flagged so nobody translates a position-sizing essay into a screen.

## Classic reversal — the highest-value block for a swing screener

hsb · hst · chsb · chst · BustHSB · BustHST · aadb · aadt · aedb · aedt · eadb · eadt ·
eedb · eedt · udb · BustDoubleBots · BustDoubleTops · tb · tt · BustTripleBots ·
BustTripleTops · bigm · bigw · roundb · roundingtop · vBottoms · VTop · vBottomExts ·
VTopExt · VPivot · InvVPivot · pipeb · pipet · hornb · hornt · islandrev · longisland ·
diamondb · diamondt · barrb · barrt · roof · iroof · Bottoms · Bottom

## Continuation and consolidation — where a swing entry usually lives

cup · icup · htf · flags · pennants · earnflag · FlatBase · rectbots · recttops ·
BustRectangles · at · dt · st · msymtri · BustAscTriangles · BustDescTriangles ·
BustSymTriangles · AscTriangleSetup · fallwedge · risewedge · abw · dbw · rabfa ·
rabfd · broadb · bt · channels · mmu · mmd · ascscallop · descscallops · aiscallop ·
idscallops · partdecline · partrises · throwbacks · pullbacks · uptrendlines ·
trenddown · DivingBoard · Pothole · CatsEars · Mirrors · mountain · MultiPeaks ·
MultiPeak2B · 3fp · 3rv · 123tc · 2B · Shark32

## Single-bar and few-bar — the ones a daily scan can test exactly

NR4 · nr7 · InsideDays · OutsideDays · 3Bar · 3DC · KRU · KRD · KRB2 · KRB2Bear ·
DoubleKeyBull · DoubleKeyBear · CPRU · CPRD · OCRU · OCRD · HRU · HRD · PPRU · PPRD ·
ODRB · ODRT · WRDUR · WRDDR · WeeklyRevsUpside · WeeklyRevsDownside · 2Closebull ·
2Closebear · 2StepBull · 2StepBear · 2Dance · 2Did · TallDance · TurnkeyBull ·
TurnkeyBear · FakeyBull · FakeyBear · CarlVBull · CarlVBear · spikes · minorhl

## Gaps and event-driven

gaps · volbkout · Gap2H · Gap2Hi · dcb · idcb · earnsgood · earnsbad · sssgood ·
sssbad · fda · dutchep · Cloudbank

## Harmonic and measured — geometry the engine cannot express yet

ABCDBull · ABCDBear · abc · GartleyBull · GartleyBear · BatBull · BatBear ·
ButterflyBull · ButterflyBear · CrabBull · CrabBear · WolfeWaveBull · WolfeWaveBear ·
3peaksdome

⚠️ **These need trendline/pivot geometry and Fibonacci ratios between swing points.**
The sweep already recorded trendline geometry as a missing capability for six setups;
this block is fourteen more against the same gap, which makes pivot detection the
single most valuable engine primitive still unbuilt.

## Elliott wave — a labelling scheme, not a scannable predicate

EWBasic · EWZigzag · EWDoubleZigzag · EWFlat · EWRunning · EWExpanded · EWTruncation ·
EWExtension1 · EWExtension3 · EWExtension5 · EWExtensionU · EWDiagTriangle ·
EWleadingTriangle · EWTriangleAscending · EWTriangleDescending · EWTriangleSymmetrical ·
EWTriangleRunning · EWRevSymmetrical

⛔ **Filed but NOT queued for expression.** Elliott labelling depends on a human's
choice of degree; two analysts label the same chart differently, so there is no
predicate a screener can evaluate. Recording that as the reason is worth more than
leaving eighteen rows looking like unbuilt features.

## Indicators, studies and essays in the same index

divergence · failswing · 12MonthMA · SAR · BestPatterns · AdamWhiteSetup · CPSetup ·
AssetProtection · AveragingDown · BestBuyDays · BestBuyMonths · BookValue ·
10Baggers · 38PercentExit · ElevatorStop · VerticalRunUp · VerticalRunDown

## What to pull first, and why

1. **`nr7`, `NR4`, `InsideDays`, `OutsideDays`, `3DC`** — pure OHLC over a fixed
   window. Expressible TODAY with what the manifest declares, no new column.
2. **`htf`, `FlatBase`, `cup`** — the firm already ships setups under these names, so
   Bulkowski's rules are a second published source to cross-reference against, and
   the catalog's `_no_average` rule makes disagreement a feature.
3. **`KRU`/`KRD`, `CPRU`/`CPRD`, `OCRU`/`OCRD`, `HRU`/`HRD`, `PPRU`/`PPRD`** — ten
   reversal bars, each a small exact predicate, each with published statistics.
4. **`dcb`** — the dead-cat bounce has a hard published threshold and is the cleanest
   test of whether an event-driven setup can be grounded.

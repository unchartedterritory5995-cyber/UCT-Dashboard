# Bulkowski, read page by page — identification rules AND the evidence behind them

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



**Every number below is a direct quote from `thepatternsite.com`, fetched 2026-08-09.**
This file is the second layer over `INDEX_bulkowski_patterns.md`: the index is 196
addresses, this is what comes back when one is actually read.

⭐ **WHAT MAKES THIS SOURCE DIFFERENT FROM EVERY LISTICLE.** Each pattern arrives with
a written rule *and* a measured outcome over a stated sample — failure rate, average
move, throwback rate, how often the target was met. A criterion with evidence behind
it can be argued with. A criterion without one can only be believed.

⚠️ **A STATISTIC IS NOT A CRITERION AND MUST NEVER BECOME A FILTER.** "Average rise
39%" describes what happened after the pattern in a back-test; it is not a condition
a stock can satisfy today. ⛔ A screener that turned an average rise into a predicate
would be scanning for the future. The rules go in the criteria file; the statistics
go beside them as the reason to care, and the two are kept in different columns on
purpose.

---

## High and Tight Flag — 🔴 THREE PUBLISHED DEFINITIONS, NONE OF THEM THE SAME

This is the most valuable finding of the pass, and it lands on a setup **the firm
already ships**.

| House | The number | Exact wording |
|---|---|---|
| **Bulkowski** | **≥ 90% in ≤ 2 months** | *"Price must rise at least 90% (shoot for a double) in 2 months or less."* |
| **Minervini** (Power Play) | **100%+ within 8 weeks**, consolidation correcting ≤ 20% (≤ 25% lower-priced) over 3-6 weeks | *"up 100 percent or more within eight weeks"* |
| **Firm** | — | *"the screener publishes no preset on `chg_pct_1m` at all"* |

⛔ **DO NOT RECONCILE THESE.** 90% in 2 months and 100% in 8 weeks are close enough
that averaging them would feel harmless, which is exactly why the rule exists: 8
weeks is not 2 months, and *"shoot for a double"* is advice, not a threshold. Ship
them as three named variants a member picks between, each carrying its own citation.

**Bulkowski's other HTF rules:** shape — *"A consolidation pattern forms after price
doubles. It usually doesn't look like a flag or pennant, just a pause in the price
rise."* · volume — *"Recedes for best performance"* · confirmation — *"price closes
above the highest peak in the pattern, which is usually the flagpole top."*
⚠️ He publishes **no maximum pullback**; Minervini does. That asymmetry is the whole
argument for cross-referencing rather than picking one house.

**Measured:** break-even failure 15% · average rise 39% · throwback 67% · target met
82% (half-height target) · rank 30/39 · **1,028 trades**.
⚠️ Rank 30 of 39 is worth reading twice: by his measurement this celebrated pattern
is a below-median performer, and it has the *lowest* failure rate in this file. Those
two facts are not in tension — they measure different things — and a catalog that
showed only one of them would be selling the setup rather than describing it.

---

## Cup with Handle — the base the whole CAN SLIM tradition is built on

**Rules, verbatim:** *"A rounded turn that looks like a cup with a handle on the right
of the cup."* · *"The cup should be U-shaped, not V-shaped, but allow variations."* ·
duration *"From 7 to 65 weeks (allow variations)."* · handle *"1 week minimum with no
maximum, forming in the upper half of the cup."* · rims *"Cup rims should be near the
same price level but be flexible."* · prior trend — *"Price rises into the start of
the cup, but I don't pay much attention to this guideline."*

**Measured:** break-even failure **5%** · average rise **54%** · throwback 62% ·
target met 61% · **rank 3 of 39** · 913 trades.

🔴 **AND IT IS BARELY EXPRESSIBLE, WHICH IS THE POINT.** *"U-shaped, not V-shaped"*,
*"rims near the same price level"* and *"the upper half of the cup"* are geometry over
detected pivots — none of it is a threshold on a declared column. The best-ranked
pattern in the whole set is the one our engine can say least about. ⛔ The wrong
response is to approximate it with `close near highest(high, 260)`; that would ship a
different scan under a trusted name. **Pivot detection is the missing primitive**, and
this is the strongest single argument for building it.

⚠️ Note the honest gap against the firm's own version: Bulkowski specifies **no prior
rise percentage, no cup depth, no handle depth, and no volume rule**, where O'Neil's
tradition specifies all four. Two sources, two levels of precision, and the looser one
is the one with the measured sample.

---

## NR7 — 🟢 EXPRESSIBLE TODAY, AND ALREADY A SHIPPED FILTER

**Rules, verbatim:** *"The pattern is composed of seven bars."* · *"The most recent bar
must have a smaller high-low price range than the prior six bars (seven bars,
total)."* · *"A breakout occurs when price closes above the top or below the bottom of
the NR7."*

⭐ **This is grounding for a filter the screener ALREADY SHIPS** (`nr7`, "NR7
(narrowest of 7)"). The predicate needs no new column and no new engine capability.

**Measured** — and this is the row that should change how it is offered:

| Market / breakout | Failure rate | Average move |
|---|---|---|
| Bull / up | 46% | +7% |
| Bull / down | 47% | −6% |
| Bear / up | 40% | +8% |
| **Bear / down** | **27%** | **−12%** |

Target met: 43% / 37% / 32% / 39%. Rank 11/23. **29,021 trades over 1,201 stocks,
January 1990 to March 2013.**

🔴 **THE SIGNAL IS DIRECTIONAL AND THE PRODUCT TREATS IT AS NEUTRAL.** A 46% break-even
failure rate on the long side in a bull market is close to a coin flip; the short side
in a bear market fails 27% of the time for nearly double the move. We ship `nr7` as a
plain boolean with no regime attached. ⛔ That is not a bug in the filter — it is a
missing sentence next to it, and the sample is large enough that we can say it.

---

## Dead-Cat Bounce — a hard threshold, and a rule about what NOT to buy

**Event:** *"Price usually gaps downward, closing 15% to 70% lower than the prior day.
The average event decline from prior close to trend low is 31%."* · *"From the event
day to the trend low averages 7 days."*

**Bounce:** *"The average bounce height from event low to bounce high is 28% and takes
23 days."* · gap closure — *"22% will close the gap during the bounce phase, 38% will
close it in 3 months, and 58% will close the gap in 6 months."*

**After:** *"price resumes declining, averaging 30% from the bounce high to post-bounce
low in 49 days."* · *"This places price an average of 18% below the event low 67% of
the time."*

**Recurrence:** *"26% will have a second dead-cat bounce measuring at least 15% within
3 months, and 38% will dead-cat bounce within 6 months."*

⭐ **THE EVENT IS EXPRESSIBLE TODAY**: `close / close[1] - 1 <= -0.15` is the trigger,
and 15% is a published floor rather than a chosen one.

⭐⭐ **AND IT IS THE MOST USEFUL *NEGATIVE* CRITERION IN THE CATALOG.** Two thirds of
the time price ends up 18% below the event low, and a quarter of these do it again
within three months. That makes "has had a dead-cat bounce in the last 6 months" an
**exclusion** worth attaching to every long setup — the sort of filter a member never
thinks to ask for and that quietly removes a category of losing trades.

⚠️ Sample: *"based on hundreds of perfect trades"* — **no count given**, unlike every
other entry here. Recorded as-is. It is the weakest evidence in this file and the
entry should say so wherever it is used.

---

## What this pass establishes about the road ahead

1. **Pivot detection is the bottleneck, not vocabulary.** Cup-with-handle, the
   fourteen harmonic patterns, and six setups the earlier sweep already flagged all
   need the same thing: swing highs and lows as first-class values. One primitive
   unblocks the largest block of remaining setups by a wide margin.
2. **Statistics belong in the catalog beside the rules**, in their own field, never
   as thresholds. They are what lets a member choose between three definitions of the
   high tight flag instead of trusting whichever one we shipped.
3. **Regime changes the answer.** NR7 is the proof: same pattern, same rule, failure
   rate from 27% to 47% depending on market and direction. Any setup we offer without
   a regime qualifier is offering an average of four different things.

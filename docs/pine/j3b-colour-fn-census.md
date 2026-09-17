# J3-B — colour-position / user-function census (READ-ONLY)

Instrument: `tools/pine_colour_fn_census.py`. Reproduce with

```
python tools/pine_colour_fn_census.py
```

Corpus: `corpus/committed`, `tests/fixtures/pine_oos`, `tests/fixtures/member` —
**328 files scanned**, **325 carry at least one colour position**, **7,034 colour
positions** in total. Same three directories and the same comment/string stripper
as the control tool `tools/pine_colour_census.py`.

---

## 0. THE HEADLINE, BEFORE THE TABLES

**Neither candidate (i) nor candidate (ii) carries Uncharted Clouds' 20 fills,
and the reason is not the fold.** A `fill()` in `pine.js` is given
`outputPresentation(fargs, { env })` with **no resolver** (`pine.js:11287`), and
`resolveFillHandles` holds exactly one `color` field. A *conditional* fill colour
therefore arrives with no colour **by design** — the shipped rail
`app/src/components/chart/engine/ast/fillColourCarriage.test.js` asserts it in
those words, and its Clouds case already records *"item (j) must render a
CONDITIONAL fill, not a static one"*.

All 20 of Clouds' fills are `isBullish ? getBullFillColor(k) : getBearFillColor(k)`
— a ternary. So:

| | |
|---|---|
| fills whose colour is a ternary | **20 / 20** |
| both branches fold under (i) | **0** |
| both branches fold under (i-C) — the Clouds-minimal fold | **20** |
| both branches fold under (ii) | **20** |
| fills that would actually **carry a colour** under (i), (i-C) or (ii) | **0** |

A colour fold is **necessary but not sufficient**. The binding constraint is the
fill carrier, not `staticColourOf`.

---

## 1. CONTROL — agreement with `tools/pine_colour_census.py`

```
==============================================================================
CONTROL - agreement with tools/pine_colour_census.py (recorded: 56)
==============================================================================
  control predicate re-derived here      : 56 scripts
  my plot-position reader, same predicate: 56 scripts
  AGREEMENT (control == 56)              : PASS
  AGREEMENT (mine == control, same set)  : PASS
  names FOLLOWED (a helper behind a name): 67 scripts (superset, +11)
  of the control set, scripts whose ONLY match is the substring
  `color.t` inside `color.teal` (i.e. no real helper)  : 2
      camarilla__jw9faob08r.pine
      cpr-with-mas-super-trend-vwap-by-guruprasadmeduri__htrxxqBqNz.pine
```

**PASS, both ways** — the recorded 56 re-derives to 56, and my own plot-position
reader names the **same 56 files**, not merely the same count.

Two things the control surfaced that are worth recording:

- ⚰️ **The control caught a real defect in this instrument, twice.** The first
  version read only a named `color =` and disagreed by exactly 7 scripts, every
  one of them `plot(series, "title", color.new(base, 30), linewidth = 2)` —
  Pine's **third positional argument**. Fixing that exposed the second half:
  `strip_pine` blanks string literals, so the title argument arrives empty and a
  splitter that drops empty parts shifts every positional index left by one. Both
  are now fixed and commented at the site, with a probe in the tool that proves
  the reader sees a positional colour.
- ⚠️ **2 of the recorded 56 are substring matches on the control's own
  predicate.** `'color.t' in args` also matches `color.teal`;
  `camarilla__jw9faob08r.pine` and
  `cpr-with-mas-super-trend-vwap-by-guruprasadmeduri__htrxxqBqNz.pine` contain no
  real colour helper inside a `plot()`. This is **not** a reason to change the
  recorded figure — it is stated so that "56 scripts feed a colour helper into a
  `plot()`", which is quoted verbatim in `pine.js`'s own `colourHelperAlpha`
  docstring, is read as **54 + 2 spelling collisions**.
- Following names (`c = color.new(...)` then `plot(x, color = c)`) raises the same
  question's answer to **67 scripts**. The control does not follow names; that is
  a definition difference, not a disagreement.

---

## 2. THE CANDIDATES AS MEASURED

| label | what it is |
|---|---|
| **today** | replicates `staticColourOf` + `colourConditional` exactly, **including** the `color.new` branch's non-recursive base |
| **(i)** | R32's narrow fold, read charitably: body is ONE colour expression, every call-site argument plan-time (literal, or a name bound to a literal / input default), base a static colour, alpha a literal or **arithmetic** over plan-time arguments. **No nested calls.** |
| **(i-tern)** | (i) plus a body that is a single **ternary** of colour expressions |
| **(i-C)** | (i) with exactly one relaxation — the alpha may be a plan-time **numeric user-function call** (multi-statement body, local bindings, `math.*`, `color.t` of a static colour). **This is the narrowest fold that resolves Clouds' two colour helpers.** |
| **(base)** | no user functions at all: recurse `color.new`'s base through a name / `input.color`, and allow a plan-time arithmetic alpha |
| **(ii)** | the general plan-time evaluator over user functions, measured **only in colour positions** |

---

## 3. COLOUR POSITIONS

```
position                        uses  files   carrier   today     (i)   (i-C)    (ii)
plot colour                     1101    185 flat+cond     561     561     561     602
fill colour                      254     79      flat      97      97      97     108
bgcolor                           63     40      none       0       0       0       0
barcolor                          71     61      none       0       0       0       0
plotshape/plotchar colour        690    105 flat+cond     572     572     572     574
line/label colour               2575    194 flat+cond    1219    1219    1219    1271
other (not in the six)          2280    170 flat+cond     955     955     955     992
```

`carrier` is what the **shipped code can hold** at that position, which is not the
same question as what the colour reader can resolve:

- `flat+cond` — the output loop passes `{env, resolver, kind}` (`pine.js:11586`),
  so `colourConditional` can emit `colorUp`/`colorDown`.
- `flat` — `fill` gets no resolver (`pine.js:11287`) and `resolveFillHandles` has
  one `color` field.
- `none` — `bgcolor`/`barcolor` are in `CHART_ONLY_CALLS` (`pine.js:1785`) and are
  not special-cased ahead of it, so they emit a note and **no output at all**.

⚠️ **NOT MEASURED:** whether a conditional TEST resolves into a canonical tree
(`ctx.resolver.resolve(cond.test)`). Every `flat+cond` number is therefore an
**upper bound**. ⚠️ `other` is heterogeneous — `hline` gets no ctx at all
(`pine.js:11263`) and is flat-only, while `box`/`table` sit on the object lane
whose `colorNodeOf` does carry a conditional; scoring it `flat+cond` **overstates
hline**.

---

## 4. THE SHAPE TABLE

```
shape                        uses  files   today    (i) (i-tern)  (i-C) (base)   (ii)
literal colour                445     77     422    422      422    422    422    422
colour constant              1686    197    1632   1632     1632   1632   1632   1632
color.new(...)               1448    170     904    904      904    904   1025   1025
color.rgb(...)                252     29     242    242      242    242    250    250
user-function call             83     15       0      0        0      0      0      4
ternary over the above        946    187     204    204      204    204    214    214
other                        2174    182       0      0        0      0      0      0
TOTAL                        7034    325    3404   3404     3404   3404   3543   3547
```

**Blast radius — scripts whose PRESENTATION would change:**

```
  under (i)      : 0
  under (i-tern) : 0
  under (i-C)    : 0
  under (base)   : 20   [no user functions at all]
  under (ii)     : 21   [colour positions only]
  attributable to USER-FUNCTION folding, (ii) minus (base): 1 script
```

⚠️ The `(ii)` figure counts **colour positions only**. A constant folder over user
functions *corpus-wide* also changes NUMERIC positions (lengths, offsets, plot
counts); that blast radius is **not measured** by this tool and must be measured
before (ii) is chosen.

---

## 5. ⭐ NAMED — every script whose SOURCE carries a position the rule can resolve

> ⛔⛔ **THIS SECTION WAS HEADED "every script that would change". IT IS NOT THAT,
> AND R33a MEASURED THE DIFFERENCE: predicted 20 scripts / +139 positions, measured
> 3 / 15** (re-baseline over 325 scripts, `8e7bed1d3`).
>
> The counts below are **source colour positions**. A position only becomes a
> member-visible change if it lands on a **plot or a fill** — the two things the
> presentation layer has a channel for. Across the 12 unmoved scripts in
> `corpus/committed`:
>
> | | |
> |---|---|
> | drawing-object colour sites (`box`/`line`/`label`/`table`/`bgcolor`) | **308** |
> | plot/fill carriers | **63** |
> | of the 12 scripts, those with **no `plot()` carrying a colour at all** | **10** |
> | `plot()` colour args passed **positionally** vs named `color=` | **9** vs 16 |
>
> ⭐ So the dominant term is colour that no folding rule can carry, because there is
> no plot or fill to put it on. A second term is `anchored-vwap-pinch-handoff`,
> whose chain folds perfectly (`col_H = input.color(colHi,…)`, `colHi = #ff00664d`)
> and is never read because all 9 of its colour args are **positional** — which is
> `outputPresentation`'s argument reading, not `staticColourOf`'s folding.
>
> ⛔ **SIZE A COLOUR RULING ON PLOT/FILL CARRIERS, NOT ON THE NUMBERS BELOW.** They
> bound what *could* be resolved; they do not forecast what *will* carry. This is
> the same lesson j.3b(a) already paid for once — *"a source-text census bounds what
> could carry, never what does"*, predicted 5 scripts / 7 fills, measured 1 / 1 —
> and it recurred here at eight times the scale because the header promised change.
>
> ⚠️ **AND SIX OF THE 20 BELOW ARE NOT IN `corpus/committed`.** The
> `high_engagement__` / `mid_engagement__` / `long_tail__` entries live in
> `tests/fixtures/pine_oos/`, so a re-baseline over the committed corpus alone
> silently omits them. Measure both corpora, and do not lean on
> `pine.oosBaseline.test.js` to notice — it pins no counts by design.

**Under (i): NONE. Under (i-tern): NONE. Under (i-C): NONE.**

The narrow folds change nothing corpus-wide, Clouds included. There is no
re-baseline to predict for them.

**Under (base)** — no user-function folding at all; `color.new`'s base recursed
through a name / `input.color`, plus a plan-time arithmetic alpha. **20 scripts,
+139 positions:**

```
anchored-vwap-pinch-handoff-intervals-and-signals__2174489a80.pine
cdc-btc-rainbow-road__d880789793.pine
elliot-wave-detector-pro__ce1cc9553e.pine
high_engagement__13-ultimate-opening-range-breakout-luxalgo.pine
high_engagement__22-reversal-probability-profile-algoalpha.pine
ict-turtle-soup-flux-charts__053c3e6056.pine
liquidity-levels-sonarlab__bba13c46c4.pine
long_tail__06-sector-rotation-leadership-persistence.pine
market-structure-inducements-ict-tradinfinder-choch-bos-sweeps__7569f1043e.pine
mid_engagement__09-relative-volume-breakout-context.pine
mid_engagement__22-rsi-levels-regime-map.pine
mid_engagement__23-distilled-htf-po3.pine
momentum-volatility-scanner__4d1deaa855.pine
mtf-dashboard-pro-rsi-fib-sr-volume-strixedge__bad34083e8.pine
smart-money-concepts-by-welotrades__0bff41a2e5.pine
smart-money-volume-index-algoalpha__6663950b80.pine
support-and-resistance__c4792aabd0.pine
support-resistance-mtf-flux-charts__dd04862677.pine
trend-duration-forecast-chartprime__2c5c233f31.pine
trend-lines-supports-and-resistances__413ee2ee3b.pine
```

**Under (ii) but not (base)** — the part a user-function folder is actually
responsible for. **1 script:**

```
machine-learning-logistic-regression-v3__TDlqz0q9TN.pine
```

(`cAqua(10)` / `cPink(6)` — a literal argument selecting one branch of a ten-way
ternary chain over 8-digit hex literals; 4 positions, 2 `plot` + 2 `plotshape`.)

---

## 6. USER FUNCTIONS IN A COLOUR POSITION

```
  call sites in a colour position : 208
  distinct (file, function)       : 35
  files                           : 27

  body shapes:
    multi-statement                          85 call sites
    other                                    65 call sites
    single colour expression                 43 call sites
    multi-statement (nested block)           15 call sites

  every call-site argument plan-time (strict):
    False                                   164 call sites
    True                                     44 call sites

  the body alpha is:
    none (not a helper)                      87 call sites
    absent                                   43 call sites
    user-fn call                             40 call sites
    literal / none (not a helper)            20 call sites
    n/a (nested body)                        15 call sites
    arithmetic on an argument                 3 call sites
```

The intersection (i) needs — *single-colour-expression body* **and** *plan-time
call-site arguments* — is **40 call sites, and all 40 are Clouds'**
`getBullFillColor` / `getBearFillColor`. The only other functions whose body
matches (i)'s shape with an arithmetic alpha are the three copies of
`colorWithTransparency` (`smart-money-concepts-by-welotrades`,
`supply-demand-mtf-flux-charts`, `volumized-order-blocks-flux-charts`), and every
one of their call sites passes a **runtime** argument.

---

## 7. FUNCTIONS CALLED FROM BOTH A COLOUR AND A NON-COLOUR POSITION

A call site counts as COLOUR when it sits inside any colour-named argument, one of
the six positions, or a binding a position resolves through — the **wider** test,
so a function is only listed when a genuinely non-colour use was found.

```
  heat-map-seasons__53acdf3223.pine            normalization       colour=0 non-colour=1
    :40    color_level = normalization(close - Regression_Line, 0)
  high_engagement__22-...-algoalpha.pine       getColor            colour=2 non-colour=2
    :352   pocColor = getColor(pocCluster)
    :403   clusterColor = getColor(dominantCluster)
  long_tail__02-relative-volume-candles...     _fAdjustBrightness  colour=1 non-colour=2
    :69    ProfoundBullishColor_cl = _fAdjustBrightness(...)
    :70    ConstructiveBullishColor_cl = _fAdjustBrightness(...)
  machine-learning-lorentzian-classification   color_green         colour=1 non-colour=1
  machine-learning-lorentzian-classification   color_red           colour=1 non-colour=1
  machine-learning-lorentzian-classification   solid_bar_color     colour=0 non-colour=1
  machine-learning-rsi-bullvision              calcMovingAverage   colour=0 non-colour=1
    :171   smoothedRsi = calcMovingAverage(maType, baseRsi, smoothingLength, almaSigma)
  mid_engagement__12-structure-participation   f_scoreColor        colour=2 non-colour=1
  multi-timeframe-rsi-buy-sell-strategy        ma                  colour=0 non-colour=1
    :71    rsiMA = ma(sum/n, maLengthInput, maTypeInput)
  smart-money-concepts-by-welotrades           colorWithTransparency colour=1 non-colour=1
    :437   ob.orderBox.set_bgcolor(colorWithTransparency(orderColor, 1.1))
  smoothed-gaussian-trend-filter-algoalpha     gaussianSmooth      colour=0 non-colour=1
    :94    gmaOutput = gaussianSmooth(close, polesInput, alphaValue)
  supply-demand-mtf-flux-charts                colorWithTransparency colour=1 non-colour=1
  volumized-order-blocks-flux-charts           colorWithTransparency colour=1 non-colour=1
```

Three readings, and they matter differently:

1. **`calcMovingAverage`, `gaussianSmooth`, `ma`, `normalization`** are **numeric**
   helpers that merely appear *inside* a colour position's argument tree (e.g.
   `color.from_gradient(gaussianSmooth(...), ...)`). They are the real argument
   against a **corpus-wide** folder: (ii) would put a plan-time evaluator in front
   of moving-average code.
2. **`colorWithTransparency` (×3)** is a pure colour helper whose "non-colour" call
   is `box.set_bgcolor(...)` — a colour slot the six-position taxonomy does not
   name. Scoping to colour positions is safe for it; the taxonomy is what is
   narrow, not the function.
3. ⭐ **The decisive line:** the only functions a fold under (i) or (i-C) would
   actually substitute are `uncharted-clouds.pine :: getBullFillColor` and
   `getBearFillColor`, and **neither is called from a non-colour position**
   (tool output: `=> of those, called from a non-colour position : NONE`).
   Candidate (i)'s scoping is not in question for anything it would touch.

---

## 8. CLOUDS, CLAUSE BY CLAUSE

```
  fill colour positions            : 20
  carried today                    : 0
  would carry under (i)            : 0
  would carry under (i-tern)       : 0
  would carry under (i-C)          : 0
  would carry under (ii)           : 0

  ** the fill carrier holds ONE colour, so a CONDITIONAL fill colour
     is uncarried whatever the fold does. Measured separately: **
  fills whose colour is a ternary  : 20
  BOTH branches fold under (i)     : 0
  BOTH branches fold under (i-C)   : 20
  BOTH branches fold under (ii)    : 20

  why (i) refuses each fill, clause by clause:
    getBullFillColor(0)
      call-site args plan-time (strict)           : True
      body is a SINGLE colour expression          : True
      base `bullColor` static TODAY (no recursion): False
      base `bullColor` static with recursion      : True
      alpha `getAdjustedTransparency(layerIndex, bullUserTransparency)`
        is a literal                              : False
        is arithmetic on a plan-time arg          : False
        is a NESTED USER-FUNCTION call            : True -> getAdjustedTransparency
    getBearFillColor(0)   [identical]

  getAdjustedTransparency(layerIndex, userTransparency)
    body shape : multi-statement (3 statements)
      | baseTransparency = maxTransparency - transparencyStep * layerIndex
      | adjustedTransparency = baseTransparency + (100 - baseTransparency) * (userTransparency / 100)
      | math.min(adjustedTransparency, 100)

  fold (ii) evaluation of the first three layers:
    getBullFillColor(0) -> #00897B0D    getBearFillColor(0) -> #880E4F0D
    getBullFillColor(1) -> #00897B13    getBearFillColor(1) -> #880E4F13
    getBullFillColor(2) -> #00897B19    getBearFillColor(2) -> #880E4F19
```

**(i) as written fails on four independent clauses, and the call site is not one
of them.** `getBullFillColor(0)`'s argument is the literal `0` — plan-time. What
fails is:

1. the alpha is a **nested user-function call**, which (i) forbids outright;
2. that nested function's body is **multi-statement** (two local bindings plus
   `math.min`), so even recursing (i)'s single-expression body rule refuses it;
3. its second argument `bullUserTransparency` is a name bound to
   `color.t(bullColor)` — a **builtin call over an input default**, which is
   neither "a literal" nor "a name bound to a literal/input default";
4. the base `bullColor` is a **name** bound to `input.color(color.teal, …)`, and
   today's `color.new` branch checks the base with `isColourName` / a colour
   literal and **does not recurse**. Even a perfect body substitution would still
   return null on this clause alone.

⚠️ **A disclosure the fold would need to carry:** folding the alpha reads
`input.color`'s **default** (`color.t(color.teal) = 0`). A member who changes the
colour picker's alpha would still get the default rendering. This is the same
approximation `staticColourOf`'s existing `input.color` branch already makes and
already documents — but for Clouds it governs the *entire* cloud opacity, which is
the feature, so it should be disclosed rather than inherited quietly.

---

## 9. ANSWERS TO THE FOUR QUESTIONS

**Does candidate (i) carry ALL 20 of Clouds' fills?**
**No — it carries 0 of 20**, and so does (ii). The fold is not the blocker for
either: all 20 fill colours are ternaries, and a `fill` has a single `color` field
and no resolver, so a conditional fill colour is uncarried by construction
(`pine.js:11287`, `resolveFillHandles`, rail `fillColourCarriage.test.js`). On the
fold question alone, (i) resolves **0 of 40** branch expressions for the four
clauses in §8; the narrowest fold that resolves all 40 is **(i-C)** — (i) plus a
plan-time numeric user-function call in the alpha, plus base recursion.

**How many scripts change under (i)? Under (ii)?**
(i): **0**. (i-tern): **0**. (i-C): **0**. (ii): **21 scripts / +143 colour
positions**, of which **20 scripts are attributable to base recursion + a
plan-time arithmetic alpha and have nothing to do with user functions**; exactly
**1 script** (`machine-learning-logistic-regression-v3`) is attributable to
user-function folding. (ii)'s non-colour blast radius is **not measured**.

**Are there user functions called from BOTH a colour and a non-colour position?**
Yes — 13 (file, function) pairs, named in §7. The numeric ones
(`calcMovingAverage`, `gaussianSmooth`, `ma`, `normalization`) are the real
scoping argument against a corpus-wide folder. **None of them is a function that
(i) or (i-C) would substitute**; the only two such functions are Clouds'
`getBullFillColor` / `getBearFillColor`, and neither has a non-colour call site.

**Recommended decision under R32.**
See §10.

---

## 10. RECOMMENDATION UNDER R32

**R32 asks for the narrowest fold that carries Clouds. On this measurement no fold
carries Clouds, so the ruling cannot be made on the fold alone — and (ii) must not
be adopted on the strength of Clouds, because it does not carry Clouds either.**

Recommended, in order:

1. **Do not adopt (ii).** It buys **1 script** over a no-user-function baseline in
   colour positions, its corpus-wide numeric blast radius is unmeasured, and it
   would put a plan-time evaluator in front of `gaussianSmooth`/`calcMovingAverage`-class
   code. The measured demand for user-function folding is one ten-way hex ladder in
   one script.
2. **Adopt (i-C), scoped to colour positions, as the fold** — if a fold is adopted
   at all. It is strictly narrower than (ii), it resolves **40 of 40** Clouds
   branch expressions, its corpus-wide blast radius is **0 scripts**, and the only
   two functions it would substitute have **no non-colour call sites**. It cannot
   regress anything, because it changes nothing else.
3. **But ship it only together with a conditional-fill carrier**, because on its
   own it changes nothing a member can see. That carrier is item (j)'s work and is
   already named as such by `fillColourCarriage.test.js`. Until a `fill` can hold
   two colours and a condition, (i-C) is a fold whose only consumer does not exist.
4. **Treat the `color.new` base recursion as a separate, larger decision.** One
   clause — recursing `staticColourOf`'s `color.new` base through a name /
   `input.color` — plus a plan-time arithmetic alpha changes **20 scripts and 139
   positions** with no user-function machinery at all, and it is a **prerequisite**
   for Clouds regardless of which fold is chosen. It is the highest-value and
   highest-risk item measured here, it needs its own re-baseline, and it should not
   ride along inside a fold decision.
5. If the owner wants the smallest possible step that makes Clouds render
   correctly, the sequence is: **conditional-fill carrier → `color.new` base
   recursion → (i-C)**. Each is separately reviewable, and only the middle one has
   a re-baseline.

---

## 11. WHAT THIS CENSUS DOES NOT MEASURE

- Whether a conditional colour's **test** resolves into a canonical tree. Every
  `flat+cond` number is an upper bound.
- The **non-colour** blast radius of a corpus-wide constant folder (candidate ii).
- `hline`'s flat-only carrier is folded into the `other` bucket and is therefore
  **overstated** there.
- Runtime rendering. This is a source census; nothing here was rendered.

---

## 12. CARRIER-ONLY COUNTERFACTUAL (added after §1–§11; changes no number above)

Added at the integrator's request as an **additional** section of
`tools/pine_colour_fn_census.py`. Every figure in §1–§11 was re-checked byte-for-byte
after the addition and is unchanged.

**The counterfactual, narrowly:** hold the FOLD exactly as it ships today
(`staticColourOf` unchanged — no (i), no (i-C), no base recursion) and change
**only** the carrier: suppose `fill` were passed `{env, resolver, kind}` the way
the output loop is at `pine.js:11586`, and `resolveFillHandles` carried
`colorUp`/`colorDown`/`colorCondition` beside `color`.

The only new thing a fill can then hold is `colourConditional`'s two-branch
result, so a fill gains exactly when it does **not** already fold flat today AND
its colour resolves (through a bound name) to a ternary whose **both** branches
fold flat today.

```
  fill colour positions                                  : 254
  carrying TODAY (flat static only)                      : 97
  (1) gain a colour under CARRIER-ONLY                   : 7      (+7 -> 104 / 254)
  (2) DISTINCT SCRIPTS gaining at least one fill colour  : 5
  (3) of those, via a ternary whose BOTH branches already
      fold with today's staticColourOf                   : 5
  (4) uncharted-clouds.pine in that list                 : NO

  what the 7 gaining fills actually are:
    two DIFFERENT colours (a real two-colour conditional) : 5
    colorUp == colorDown (an ALPHA-only conditional)      : 2
    branch opacities agree (carried)                      : 2
    branch opacities differ (dropped)                     : 3
    neither branch names a colour helper (no opacity)     : 2
    test compares against a STRING literal                : 2

  still uncarried after carrier-only:
    ternary, a branch is `na` (a visibility gate, correctly declined) : 31
    ternary, >2 distinct colours / nested ternary                     : 45
    not a ternary at all (a call, arithmetic, an unfoldable name)     : 74
```

**(3) equals (2) BY CONSTRUCTION, not by coincidence.** Carrier-only adds no
folding, so a two-branch-already-static ternary is the *only* mechanism by which
a fill can gain. (1) and (3) cannot differ. Stated rather than inferred.

### ⭐ (2) NAMED — every script gaining at least one fill colour

A test shown with a missing operand had a **string literal** there; `strip_pine`
blanks those. A bare-name test is shown with its binding.

| script | fills | test | up / down | opacity |
|---|---|---|---|---|
| `72s-strategy-adaptive-hull-moving-average-pt1__58ujcjLFIt.pine` | 1 | `showZone` ⇐ `input(false, …)` | `#9C27B0` / `#FFFFFF` | differ (dropped) |
| `atr-trailing-stop-by-ceyhun__UMldb6tGLd.pine` | 1 | `Bull` ⇐ `ta.barssince(Green) < ta.barssince(Red)` | `#4CAF50` / `#FF5252` | agree (carried) |
| `cumulative-volume-delta__c772250751.pine` | 1 | `delta >= ema` | `#3eb370` / `#e9546b` | agree (carried) |
| `keltner-center-of-gravity-channel__e4a81d76f6.pine` | 2 | `nzz` ⇐ `not zz` | `#2962FF` / `#2962FF` · `#FF5252` / `#FF5252` | differ (dropped) |
| `order-block-finder__fVSb3j0I87.pine` | 2 | `colors == "…"` | `#FFFFFF` / `#4CAF50` · `#2962FF` / `#FF5252` | none |

Two things in that table are not what the headline count suggests:

- ⚠️ **Keltner's 2 fills are ALPHA-only conditionals.** Source (`:91`, `:95`):
  `nzz ? color.new(color.blue, 70) : color.new(color.blue, 90)`. Both branches are
  the same hex; the conditional is entirely in the transparency. The schema holds
  **one** `opacity`, and `colourHelperAlpha` returns null when the branches
  disagree, so the carrier would draw a flat blue/red where today nothing is drawn
  — **a visible gain over nothing, but the per-bar alpha is dropped.** Counted,
  not hidden.
- ⚠️ **Order-block-finder's 2 fills test a STRING input** (`colors == "DARK"`,
  `:40`–`:41`). That is the `f_getTablePos(volPosName)` class — a value chosen at
  runtime from strings, which cannot fold to a numeric condition. These are the
  likeliest resolver refusals in the set.

So the **fold-risk-free, fidelity-clean** core is **3 fills in 3 scripts**
(`atr-trailing-stop-by-ceyhun`, `cumulative-volume-delta`, `72s-strategy-adaptive-hull`),
of which 2 also carry their opacity intact. That is the honest read of "the
member-visible win available with zero fold risk".

### (4) Clouds — confirmed explicitly

**NO.** `uncharted-clouds.pine` is **not** in the carrier-only list. Its 20 fills
are ternaries whose branches are `getBullFillColor(k)` / `getBearFillColor(k)`;
`staticColourOf` folds neither today, so both branches fail the two-branch test
and the carrier has nothing to hold. Clouds needs **(i-C) + base recursion AND the
carrier** — measured, not inferred: §8 shows `BOTH branches fold under (i)` = 0 and
`under (i-C)` = 20, while `carried today` = 0 at every fold level.

### (5) Is the `flat+cond` upper-bound caveat load-bearing here?

**NOT MEASURED, and this instrument cannot measure it.** Whether
`ctx.resolver.resolve(cond.test)` succeeds is a property of the JS translator;
answering it means running `translatePine`, a Node process, which is outside this
tool's Python-only remit.

- **UPPER bound: 5 scripts / 7 fills** (every test resolves).
- **LOWER bound: 0 scripts / 0 fills** (no test resolves). This is a real bound,
  not a rhetorical one — `outputPresentation` wraps the resolve in `try { … }
  catch { /* falls through to colorDynamic */ }`, so a resolver failure is
  **silent**, and the fill would simply keep carrying nothing.
- **Judgement, labelled as judgement:** 2 of the 7 (order-block-finder) test a
  string literal and are the likeliest refusals; the remaining 5 test a boolean
  input, a `ta.barssince` comparison, a `>=` between two series, and a `not` of a
  boolean — the shapes the resolver exists for. That is a reading of the test
  expressions, **not** a resolver result.
- **The bound closes in one command in a session that may run Node**: translate
  each of the 5 named scripts and count `presentation.fills` entries carrying
  `colorUp`. The test expression of every gaining fill is printed by the tool so
  the set does not have to be re-derived.

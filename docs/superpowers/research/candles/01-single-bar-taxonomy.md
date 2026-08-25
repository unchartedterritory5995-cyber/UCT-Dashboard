# 01 — Single-Bar Body/Shadow Taxonomy (Authoritative Reference)

Researcher 01 of 10. Scope: **single-bar** structures only (body/shadow geometry). Trend-depth
mechanics are Researcher 02's; where a pattern's identity *depends* on trend I state exactly what
each source requires and mark it `TREND-DEPENDENT`.

---

## 0. NORMALIZED PRIMITIVES (use these names in the implementation)

All rules below are expressed over these quantities. `o,h,l,c` = open/high/low/close of bar `i`.

```python
rng        = h - l                      # full range (NEVER assume > 0)
body       = abs(c - o)
upper      = h - max(o, c)
lower      = min(o, c) - l
body_pct   = body  / rng                # requires rng > 0
upper_pct  = upper / rng
lower_pct  = lower / rng
close_pos  = (c - l) / rng              # 0.0 = closed at low, 1.0 = closed at high
open_pos   = (o - l) / rng
is_white   = c >= o                     # TA-Lib convention: ties are WHITE
```

Rolling references (computed over the **N bars strictly PRIOR to `i`**, never including `i`):

```python
avg_body_N   = mean(abs(c-o))[i-N : i]      # N=10 (TA-Lib), N=10..15 (Bulkowski "2 or 3 weeks")
avg_range_N  = mean(h-l)[i-N : i]           # N=10 (TA-Lib)
ema_range_25 = EMA(h-l, 25)[i-1]            # CandleScanner's volatility reference
avg_shadow_N = mean(upper + lower)[i-N : i] # N=10 (TA-Lib ShadowShort, note /2 below)
```

**Zero-range guard is mandatory.** `rng == 0` happens on real US equity daily data (halted names,
$0.0001-tick microcaps, non-trading stubs). Every `*_pct` divides by `rng`. Detect four-price doji
FIRST and return before any division. See §B.7.

---

## A. SUMMARY TABLE — every pattern with a one-line executable rule

Recommended thresholds are my synthesis (justified per-pattern in §B); the source spread is in §C.
`AB` = `avg_body_10`, `AR` = `avg_range_10`.

### Doji family (body ≈ 0)

| # | Pattern | One-line executable rule |
|---|---------|--------------------------|
| 1 | **Four-price doji** | `rng == 0` (or `rng <= tick`) — check FIRST, before any division |
| 2 | **Dragonfly doji** (tonbo) | `body <= 0.1*AR and upper_pct <= 0.10 and lower_pct >= 0.60` |
| 3 | **Takuri line** (long-tail dragonfly) | dragonfly **and** `lower >= 3*body` **and** `lower_pct >= 0.75` |
| 4 | **Gravestone doji** (tohba) | `body <= 0.1*AR and lower_pct <= 0.10 and upper_pct >= 0.60` |
| 5 | **Long-legged doji** (juji / rickshaw man) | `body <= 0.1*AR and upper_pct >= 0.25 and lower_pct >= 0.25 and 0.35 <= close_pos <= 0.65` |
| 6 | **Doji (standard/neutral)** | `body <= 0.1*AR` and none of #1–#5 — the residual doji |
| 7 | **Doji star** (qualifier, not a label) | doji **and** gapped clear of prior long body — see §B.7 |

### Indecision, small body but body > 0

| # | Pattern | One-line executable rule |
|---|---------|--------------------------|
| 8 | **High wave** | `body < AB and body > 0.1*AR and max(upper,lower) >= 3*body and rng >= 0.7*ema_range_25` |
| 9 | **Spinning top** (koma) | `body < AB and body > 0.1*AR and upper > body and lower > body` and NOT high wave |

### Marubozu family (long body, ≥1 shadow absent)

| # | Pattern | One-line executable rule |
|---|---------|--------------------------|
| 10 | **Marubozu** (full/perfect) | `body > AB and upper_pct <= 0.03 and lower_pct <= 0.03` (signed by `is_white`) |
| 11 | **Closing marubozu** | `body > AB` and shadow at the **CLOSE** end `<= 0.03*rng`, other shadow larger |
| 12 | **Opening marubozu** | `body > AB` and shadow at the **OPEN** end `<= 0.03*rng`, other shadow larger |
| 13 | **Shaven head** | `upper_pct <= 0.03` (either color) — terminology alias, see §B.13 |
| 14 | **Shaven bottom** | `lower_pct <= 0.03` (either color) — terminology alias, see §B.13 |

### Belt hold (marubozu + required trend)

| # | Pattern | One-line executable rule |
|---|---------|--------------------------|
| 15 | **Bullish belt hold** (yorikiri) | `is_white and body > AB and lower_pct <= 0.03 and close_pos >= 0.80` **and prior DOWNtrend** |
| 16 | **Bearish belt hold** (yorikiri) | `not is_white and body > AB and upper_pct <= 0.03 and close_pos <= 0.20` **and prior UPtrend** |

### Umbrella / inverted umbrella — TWO geometries, FOUR names

| # | Pattern | One-line executable rule |
|---|---------|--------------------------|
| 17 | **Hammer** | UMBRELLA geometry **and prior DOWNtrend** |
| 18 | **Hanging man** (kubitsuri) | UMBRELLA geometry **and prior UPtrend** |
| 19 | **Inverted hammer** | INVERTED-UMBRELLA geometry **and prior DOWNtrend** |
| 20 | **Shooting star** | INVERTED-UMBRELLA geometry **and prior UPtrend** |

```python
UMBRELLA          = body < AB and lower >= 2.0*body and upper_pct <= 0.10 and close_pos >= 0.60
INVERTED_UMBRELLA = body < AB and upper >= 2.0*body and lower_pct <= 0.10 and close_pos <= 0.40
```

### Ordinary bodies (the current "none" bucket)

| # | Pattern | One-line executable rule |
|---|---------|--------------------------|
| 21 | **Long white candle** (long day, yang) | `is_white and body >= 3*AB and upper < body and lower < body` |
| 22 | **Long black candle** (long day, yin) | `not is_white and body >= 3*AB and upper < body and lower < body` |
| 23 | **White / black candle** (ordinary) | `body > AB and body < 3*AB and upper < body and lower < body` |
| 24 | **Short white / short black candle** | `body <= AB and upper < body and lower < body` |
| 25 | **Strong line** (bullish/bearish) | `body >= 3*avg_body_5 and close_pos >= 0.90` (bull) / `<= 0.10` (bear) |

**Coverage claim:** #1–#25 with the residual `#23/#24` catch-alls make the taxonomy **total** — every
bar with `rng > 0` lands in exactly one bucket if evaluated in the §B.0 order. The "none" bucket
disappears.

---

## B. DETAILED BLOCKS

### B.0 — MANDATORY EVALUATION ORDER (the taxonomy is NOT commutative)

The sub-types are strict subsets of their parents. Evaluated in the wrong order, the general label
swallows the specific one. **This is the single most common implementation error.** Correct order:

```
1.  four-price doji            (rng == 0)              ← before ANY division
2.  dragonfly / takuri / gravestone / long-legged doji  ← specific doji BEFORE generic
3.  doji (residual)
4.  umbrella / inverted-umbrella shapes (→ trend split into the 4 names)
5.  marubozu (full) → closing marubozu → opening marubozu
       (belt hold = opening marubozu + trend, applied as an upgrade at this step)
6.  high wave                  ← before spinning top (high wave ⊂ spinning top)
7.  spinning top
8.  long white/black day
9.  ordinary white/black candle
10. short white/black candle
```

CandleScanner is explicit that its generic Doji is defined by **exclusion**: "A doji candle cannot
meet requirements for these specific types: Four-Price Doji, Long-Legged Doji, Dragonfly Doji,
Gravestone Doji… it's classified as a *Classic Doji*." Mirror that exclusion semantics exactly.

---

### B.1 — Four-price doji

- **Names:** Four-price doji. JP: *doji*. No separate JP name in Morris.
- **Executable:** `h == l == o == c`, i.e. `rng == 0`. Practical relaxation: `rng <= 1 tick`.
- **Thresholds:** Morris: "all four price components are equal." CandleScanner: "all four prices
  equal (open, close, low and high)"; appears as a **short line** with no shadows.
- **Bias:** Neutral. **Intrinsic.**
- **Structure:** Indecision — but in practice a **DATA-QUALITY FLAG**, not a trading signal.
- **Implementation notes (load-bearing):**
  - Morris: "It is so rare that one should suspect data errors."
  - CandleScanner measured **zero occurrences in the Dow Jones Index over 2002–2012** on daily bars.
  - On a ~3,700-name US universe this WILL fire — on halted names, delisting stubs, and illiquid
    microcaps. Treat a four-price doji as "no meaningful candle," not as a bullish/bearish call.
  - This is the zero-division guard. Return before computing any `*_pct`.

### B.2 — Dragonfly doji

- **Names:** Dragonfly doji. JP: **tonbo** (pronounced *tombo*). Long-tail variant: *shitahigi*.
- **Executable:** `body <= 0.1*AR` AND `upper_pct <= 0.10` AND `lower_pct >= 0.60`.
- **Thresholds — the spread:**
  - **Morris:** "occurs when the open and close are at the **high of the day**." No numeric tolerance.
  - **Bulkowski:** "a small body (open and close are within pennies of each other), a long lower
    shadow." Prior trend: **"None required."**
  - **StockCharts:** "Open, high, close equal; long lower shadow" — forms a "T".
  - **TA-Lib `CDLDRAGONFLYDOJI`:** `body <= BodyDoji` AND `upper < ShadowVeryShort` AND
    `lower > ShadowVeryShort`. **The "long" lower shadow only has to exceed 0.1 × avg range** —
    that is a near-vacuous requirement and makes TA-Lib's dragonfly far looser than every book.
- **Bias:** Bullish. **CONTEXT-DEPENDENT** — TA-Lib's own comment: "dragonfly doji must be considered
  relatively to the trend"; output is always +100 and "does not mean it is bullish."
  Bulkowski measured it acting as a reversal **50%** of the time (rank 98/103 overall) — i.e. random.
- **Structure:** Reversal (claimed); measured indecision.
- **Note:** Morris — "The Hammer and Hanging Man are special cases of the Dragonfly Doji… In most
  instances, the Dragonfly Doji would be more bearish than the Hanging Man." So dragonfly must be
  tested BEFORE the umbrella shapes (a dragonfly satisfies the umbrella geometry).

### B.3 — Takuri line

- **Names:** Takuri (pron. *taguri*) line. Dragonfly with an exceptionally long tail (*shitahigi*).
- **Executable:** dragonfly AND `lower >= 3*body` AND `lower_pct >= 0.75`.
- **Thresholds:**
  - **Morris (explicit, quotable):** "A Takuri line has a lower shadow **at least three times** the
    length of the body, whereas the lower shadow of a Hammer is a minimum of only **twice** the
    length of the body." And: "A Takuri line at the end of a down trend is extremely bullish…
    Takuri lines are generally more bullish than Hammers."
  - **TA-Lib `CDLTAKURI`:** `body <= BodyDoji` AND `upper < ShadowVeryShort` AND
    `lower > ShadowVeryLong`. **⚠ DEGENERATE:** `ShadowVeryLong` = RealBody / period 0 / factor 2.0,
    i.e. `2 × the bar's OWN body`. For a doji body (≈0) the threshold collapses to ≈0, so TA-Lib's
    takuri is *looser* than its own dragonfly. Do not copy this.
- **Bias:** Bullish, strongly. **TREND-DEPENDENT** (Morris ties the claim to "end of a down trend").
- **Structure:** Reversal.

### B.4 — Gravestone doji

- **Names:** Gravestone doji. JP: **tohba**; also **hakaishi**.
- **Executable:** `body <= 0.1*AR` AND `lower_pct <= 0.10` AND `upper_pct >= 0.60`.
- **Thresholds:**
  - **Morris:** "develops when the Doji is at, or very near, the **low of the day**."
  - **Bulkowski:** "a tall upper shadow and little or no lower one… The opening and closing prices
    should be **within pennies of each other**." Reversal **51%** — "random." Rank 77/103.
  - **StockCharts:** "Open, low, close equal; long upper shadow" — inverted "T".
  - **TA-Lib `CDLGRAVESTONEDOJI`:** `body <= BodyDoji` AND `lower < ShadowVeryShort` AND
    `upper > ShadowVeryShort` — same looseness problem as dragonfly.
- **Bias:** Bearish. **CONTEXT-DEPENDENT.** TA-Lib comment: "must be considered relatively to the
  trend." Morris adds a real nuance: "Some Japanese sources claim that the Gravestone Doji can occur
  only on the ground, not in the air. This means it can be a bullish indication on the ground or at a
  market low, not as good as a bearish one."
- **Structure:** Reversal.
- **Note:** Morris — "The Gravestone Doji at a market top is a specific version of a Shooting Star.
  The only difference is that the Shooting Star has a small body and the Gravestone Doji, being a
  Doji, has no body." So gravestone must be tested BEFORE shooting star.

### B.5 — Long-legged doji / rickshaw man

- **Names:** Long-legged doji; **rickshaw man** (when the body sits at the midpoint). JP: **juji**
  ("cross").
- **Executable:** `body <= 0.1*AR` AND `upper_pct >= 0.25` AND `lower_pct >= 0.25`
  AND `0.35 <= close_pos <= 0.65` (the midpoint clause = rickshaw man).
- **Thresholds:**
  - **Morris:** "long upper and lower shadows in the **middle** of the day's trading range… If the
    opening and closing are **in the center of the day's range**, the line is referred to as a
    Long-Legged Doji."
  - **Bulkowski (relative rule — important):** "Look for a doji… accompanied by long shadows. The
    length of the shadows need not appear the same, only that they are **longer than recent shadows
    on other candles**." → a *rolling* comparison, not a fixed fraction. Reversal 51%, rank 37/103.
  - **CandleScanner:** body at/near the midpoint; must appear **as a long line**; "no numeric
    thresholds" for shadow length.
  - **TA-Lib `CDLLONGLEGGEDDOJI`:** `body <= BodyDoji` AND (`lower > ShadowLong` **OR**
    `upper > ShadowLong`) — note **OR**, and `ShadowLong` = 1 × own body ⇒ near-vacuous for a doji.
    TA-Lib does **not** require the midpoint. `CDLRICKSHAWMAN` adds it:
    `min(o,c) <= midpoint + Near` AND `max(o,c) >= midpoint - Near`, `midpoint = l + rng/2`,
    `Near` = 0.2 × avg range over prior 5.
  - **TA-Lib treats rickshaw man as long-legged doji + midpoint constraint.** That is the cleanest
    separation available; adopt it.
- **Bias:** Neutral. **Intrinsic.** TA-Lib: "long legged doji shows uncertainty."
- **Structure:** Indecision.

### B.6 — Doji (standard / neutral / classic)

- **Names:** Doji, neutral doji, standard doji, classic doji. JP: **doji** ("simultaneous"/
  "concurrent"; Morris notes it also means "goof" or "bungle").
- **Executable:** `body <= 0.1*AR` AND not #1–#5 (residual).
- **Thresholds — THE WIDEST DISAGREEMENT IN THE WHOLE TAXONOMY (see §C.1):**
  | Source | Doji body threshold |
  |---|---|
  | Nison | "the same or **very close to** being the same" — no number |
  | Morris | "within **a few ticks**"; exact equality "would put too much of a constraint on the data" |
  | Bulkowski | "the same or **nearly so**" / "within **pennies**" |
  | CandleScanner | body **0–3% of total candle height** by default; user range **0–5%** |
  | TA-Lib | `body <= 0.1 × avg(h−l) over prior 10 bars` — **10% of AVERAGE RANGE, not own range** |
  | Current UCT code | `body/rng < 0.10` — 10% of **OWN** range |
- **Bias:** Neutral. **Intrinsic** when alone; significance is context-dependent.
  StockCharts: "Alone, doji are neutral patterns." TA-Lib: "doji shows uncertainty and it is neither
  bullish nor bearish when considered alone."
- **Structure:** Indecision (warning, not a signal). Morris: "In almost all cases, a Doji by itself
  would not be significant enough to forecast a change in the trend of prices, only a **warning** of
  impending trend change."
- **Context rule both StockCharts and Morris state:** a doji among other small-bodied candles is
  **not** significant; a doji among long real bodies **is**. Executable as
  `avg_body_10 >= k * body` — i.e. gate the doji label on the *neighbourhood* having real bodies.
- **Nison asymmetry (worth carrying):** Morris quoting Nison — "Doji tend to be better at indicating
  a change of trend when they occur at **tops** instead of at bottoms," because an uptrend needs new
  buying to continue while "a downtrend can continue unabated."

### B.7 — Doji star (the gapped qualifier)

- **Names:** Doji star. Star family JP: **hoshi**.
- **Executable (TA-Lib `CDLDOJISTAR`, 2-bar):**
  ```python
  prev_body_long = abs(c1 - o1) > avg_body_10_at(i-1)
  this_is_doji   = body <= 0.1 * AR
  gap_up   = min(o, c) > max(o1, c1)     # prior candle white  → bearish doji star
  gap_down = max(o, c) < min(o1, c1)     # prior candle black  → bullish doji star
  ```
- **Thresholds:** Morris (Stars, *hoshi*): "A Star appears whenever a **small body gaps above or
  below the previous day's long body**. **Ideally, the gap should encompass the shadows, but this is
  not always necessary.**" ⇒ two strictness tiers: body-gap (TA-Lib, laxer) vs full-range gap
  (Nison's ideal, stricter). **TA-Lib uses the BODY gap.**
- **Bias:** Sign is inherited from the prior candle's color, not from the doji.
- **Structure:** Reversal (a warning; the doji star is the middle bar of morning/evening doji star).
- **Implementation note:** This is a **qualifier**, not a mutually-exclusive label. Emit it as a
  boolean/suffix alongside the doji sub-type (`doji-star`, `dragonfly-doji-star`), or you break
  single-label exclusivity. It is also the only entry in this document that reads bar `i-1`'s body,
  so it belongs with Researcher 02/03's multi-bar work — included here because it re-labels a
  single-bar doji.

### B.8 — High wave candle

- **Names:** High wave, high-wave candle.
- **Executable:** `body < AB` AND `body > 0.1*AR` (i.e. NOT a doji) AND `max(upper, lower) >= 3*body`
  AND `rng >= 0.7 * ema_range_25` (long line).
- **Thresholds:**
  - **CandleScanner (the only crisp number):** high wave requires "the length of **at least one**
    shadow is **at least 3 times larger than the body**," and it must appear **as a long line**.
    Correspondingly their spinning top caps shadows: on a long line "**none of the shadows can exceed
    three times the body**." ⇒ **the spinning-top/high-wave boundary is exactly 3× body.**
  - **Nison — changed between editions:** 1st edition required **both** shadows long; the next
    edition holds it "sufficient that only **one** of the shadows is very long." (§C.4)
  - **Bulkowski:** "Look for tall upper and lower shadows attached to a small body" — **no numeric
    thresholds.** Decisive qualitative rule: "the body is **not a doji** (meaning that the opening and
    closing prices must be **more than a few pennies apart**)." Reversal 51% (random),
    frequency rank 17/103, overall rank 67/103.
  - **TA-Lib `CDLHIGHWAVE`:** `body < BodyShort` AND `upper > ShadowVeryLong` AND
    `lower > ShadowVeryLong`, i.e. **both** shadows > 2 × the bar's **own** body. Requires both
    (1st-edition Nison), uses **2×** not 3×, and has no doji exclusion — so TA-Lib's high wave fires
    on near-doji bars where the threshold degenerates toward zero.
- **Bias:** Neutral. **Intrinsic.** TA-Lib: "it does not mean bullish or bearish."
- **Structure:** Indecision. CandleScanner: "The market is losing its direction bias."
- **⚠ The distinction the current code is missing entirely:**
  | | Spinning top | High wave | Long-legged doji |
  |---|---|---|---|
  | Body | small, **> 0** | small, **> 0** (explicitly NOT a doji) | ≈ **0** |
  | Shadow vs body | > body, but **< 3× body** | **≥ 3× body** | n/a (body ≈ 0) |
  | Line length | short or long | **long line required** | long line |
  So: **high wave = long-legged doji that has a real body**, and **= spinning top with 3×+ shadows.**
  These are three different labels, and the current code emits one (`spinning-top`) or zero of them.

### B.9 — Spinning top

- **Names:** Spinning top. JP: **koma** (a spinning top / child's top).
- **Executable:** `body < AB` AND `body > 0.1*AR` AND `upper > body` AND `lower > body`
  AND NOT high wave.
- **Thresholds:**
  - **Morris:** "small real bodies with **upper and lower shadows that are of greater length than the
    body's length**. …The color of the body of a spinning top, along with the actual size of the
    shadows, **is not important**. The small body **relative to the shadows** is what makes the
    spinning top." ⇒ the definition is a **ratio to the body**, never a fraction of range.
  - **StockCharts:** "A long upper shadow, long lower shadow, and small real body."
  - **CandleScanner:** "at least one shadow required… at least one shadow has to be **longer than the
    body**"; on a long line "none of the shadows can exceed **three times** the body." Note: CS needs
    only **one** shadow > body; Morris and TA-Lib need **both**.
  - **Bulkowski:** "Look for a small white bodied candle with tall shadows." Prior trend: "None
    required." Frequency rank **2/103** (2nd most common candle of all). Reversal 50%. His verdict:
    "I really do not see any benefit to this candle."
  - **TA-Lib `CDLSPINNINGTOP`:** `upper > body` AND `lower > body` AND `body < BodyShort`.
- **Bias:** Neutral. **Intrinsic** (Morris: color "is not important").
- **Structure:** Indecision. StockCharts: after an advance or decline, signals "a potential change or
  interruption in trend."
- **⚠ Frequency warning:** rank 2/103 means this label will dominate the column if the body threshold
  is loose. The current `body/range < 0.30` with **no shadow-vs-body test** is far looser than every
  source and will over-assign massively.

### B.10 — Marubozu (full / perfect)

- **Names:** Marubozu; white marubozu = **Major Yang / Marubozu of Yang**; black marubozu =
  **Major Yin / Marubozu of Yin**. JP: **marubozu** = "close-cropped"/"close-cut"; also rendered
  **"Bald"** or **"Shaven Head."**
- **Executable:** `body > AB` AND `upper_pct <= 0.03` AND `lower_pct <= 0.03`; sign by `is_white`.
- **Thresholds:**
  - **Morris:** "no shadow extending from the body at either the open or the close, or at both." Black
    marubozu = "a **long** black body with **no shadows on either end**" — "extremely weak line";
    white marubozu = "a **long** white body with no shadow on either end" — "extremely strong line."
    **Note Morris requires the body to be LONG.**
  - **StockCharts:** white marubozu = "open equals low **and** close equals high"; black marubozu =
    "open equals high and close equals low." Strict equality, no tolerance.
  - **Bulkowski (white marubozu):** "Look for a **tall** white candlestick with **no upper or lower
    shadows**." Prior trend: "None required." Continuation **56%** — "near random." Rank 71/103.
  - **CandleScanner:** "does not have both shadows"; may appear as a **short or long line**, though a
    long line "has a substantial significance." No percentage tolerance published for the full marubozu.
  - **TA-Lib `CDLMARUBOZU`:** `body > BodyLong` AND `upper < ShadowVeryShort` AND
    `lower < ShadowVeryShort` ⇒ shadows < 0.1 × avg range, body > 1 × avg body.
- **Bias:** Directional, **intrinsic** (white bullish / black bearish) — but measured as near-random
  by Bulkowski (56%).
- **Structure:** Continuation primarily; also the first bar of many reversal patterns.
- **Tolerance choice:** strict `o==l and c==h` (StockCharts) is unusable on real US equity data —
  almost nothing qualifies. TA-Lib's 0.1 × *average range* is too loose (allows a visible wick).
  `<= 3% of the bar's own range` is the practical middle and matches how the pattern is drawn.

### B.11 — Closing marubozu

- **Names:** Closing marubozu. Black closing marubozu JP: **yasunebike**.
- **Executable:** `body > AB` AND shadow **at the close end** `<= 0.03*rng`, other shadow present:
  ```python
  # white: close is the top of the body  → NO UPPER shadow
  # black: close is the bottom of body   → NO LOWER shadow
  closing_maru = body > AB and ((is_white and upper_pct <= 0.03 and lower_pct > 0.03)
                             or (not is_white and lower_pct <= 0.03 and upper_pct > 0.03))
  ```
- **Thresholds:**
  - **Morris (definitive):** "A Closing Marubozu has no shadow extending from the **close** end of the
    body… If the body is white, there is no **upper** shadow because the close is at the top of the
    body. Likewise, if the body is black, there is no **lower** shadow… The Black Closing Marubozu
    (*yasunebike*) is considered a **weak** line and the White Closing Marubozu is a **strong** line."
  - **Morris ranking (load-bearing):** "The Opening Marubozu is **not as strong as** the Closing
    Marubozu." Closing > opening in conviction, because the close is what matters.
  - **Bulkowski (closing white marubozu):** "Look for a tall white candle with a **lower shadow but no
    upper one**." Prior trend: "None required." Continuation 55% ("near random"), frequency rank
    15/103, overall 70/103.
  - **TA-Lib `CDLCLOSINGMARUBOZU`:** `body > BodyLong` AND (white → `high - close < ShadowVeryShort`;
    black → `open - low < ShadowVeryShort`). Note TA-Lib checks only the close-end shadow and does
    **not** require the other shadow to be non-trivial, so a full marubozu also matches — order matters.
- **Bias:** Directional, intrinsic. White = strong bullish, black = weak/bearish.
- **Structure:** Continuation.

### B.12 — Opening marubozu

- **Names:** Opening marubozu. Black opening marubozu JP: **yoritsuki takane**.
- **Executable:** `body > AB` AND shadow **at the open end** `<= 0.03*rng`, other shadow present:
  ```python
  # white: open is the bottom of body → NO LOWER shadow
  # black: open is the top of body    → NO UPPER shadow
  opening_maru = body > AB and ((is_white and lower_pct <= 0.03 and upper_pct > 0.03)
                             or (not is_white and upper_pct <= 0.03 and lower_pct > 0.03))
  ```
- **Thresholds:**
  - **Morris:** "The Opening Marubozu has no shadow extending from the **open** price end of the body.
    If the body is white, there would be no **lower** shadow, making it a strong bullish line. The
    Black Opening Marubozu (*yoritsuki takane*), with no **upper** shadow, is a weak and therefore
    bearish line."
  - **Bulkowski (opening white marubozu):** "Look for a tall white candle with an **upper shadow but
    no lower one**." Body "tall," assessed **relatively by comparing it to other recent candles**.
    Prior trend: "None required." Continuation 54%, frequency rank **7/103** (very common),
    overall 75/103.
  - **CandleScanner (opening white marubozu) — a crisp number:** "**the body must be at least 51
    percent of the total candle height**"; upper shadow permitted but must be **smaller than the
    body**; may appear as a long or short line.
- **Bias:** Directional, intrinsic, but explicitly **weaker than the closing marubozu** (Morris).
- **Structure:** Continuation.

### B.13 — Shaven head / shaven bottom (terminology)

These are **aliases describing which end is flat**, orthogonal to color — a frequent source of
confusion. The mapping, reconciled across Morris + thismatter + the belt-hold literature:

| Term | Geometry | Equivalent labels |
|---|---|---|
| **Shaven head** (shaven top) | `upper_pct ≈ 0` (no upper shadow) | white **closing** marubozu, **or** black **opening** marubozu |
| **Shaven bottom** | `lower_pct ≈ 0` (no lower shadow) | white **opening** marubozu, **or** black **closing** marubozu |

- Morris: "*Marubozu* means close-cropped or close-cut… Other interpretations refer to it as **Bald or
  Shaven Head**." So "shaven head" is also used loosely for marubozu in general — context decides.
- thismatter: "**Shaven top**: occurs when open or close equals the day's high… **Shaven bottom**:
  when opening or closing price equals the low."
- The bullish belt hold is canonically called a **"white opening shaven bottom."**
- **Recommendation:** do NOT emit `shaven-head`/`shaven-bottom` as screener labels. They are ambiguous
  (each maps to two different marubozu types). Emit the opening/closing marubozu names instead and
  keep these as search synonyms only.

### B.14 — Bullish belt hold

- **Names:** Bullish belt hold, belt-hold line, white opening shaven bottom. JP: **yorikiri**
  (sumo: "to push out" — pushing your opponent from the ring while holding his belt). Morris credits
  **Nison** with coining the English name.
- **Executable:** `is_white` AND `body > AB` AND `lower_pct <= 0.03` AND `close_pos >= 0.80`
  AND **prior DOWNTREND**.
- **Thresholds:**
  - **Morris — Rules of Recognition (verbatim):** "1. The Belt Hold line is identified by the **lack of
    a shadow on one end**. 2. The bullish white Belt Hold **opens on its low and has no lower
    shadows**." Commentary: "a white opening marubozu that occurs in a **downtrend**. It opens on the
    low of the day, rallies significantly against the previous trend, and then **closes near its high
    but not necessarily at its high**." Morris header: **"Trend Required: Yes."**
  - **Bulkowski:** "Look for a white candle with **no lower shadow, but closing near the high**."
    Prior trend: **"Downward."** Bullish reversal **71%** — reversal rank 11/103 (one of his better
    single candles), frequency 22/103, overall 62/103. Perform best when within one-third of yearly
    lows and taller than median height.
  - **Nison (1991, p. 94), as cited:** "if a bullish belt hold occurs at low prices, it forecasts a
    rally; the **longer the height** of the belt hold candlestick, the more important it becomes."
  - **CandleScanner (bearish twin, numeric):** formed by an Opening Black Marubozu, no upper shadow,
    lower shadow "**no more than 25 percent of the candle**," appears as a long line, stronger when
    "three times longer than an average length of n last candles."
- **Bias:** Bullish. **TREND-DEPENDENT** — without the prior downtrend it is merely an opening
  marubozu.
- **Structure:** Reversal.
- **★ HOW IT DIFFERS FROM AN OPENING MARUBOZU — the exact answer:**
  Morris: "The Belt Hold pattern is **the same as** the Opening Marubozu." The geometry is
  **identical**. The differences are two, both non-geometric:
  1. **Trend is REQUIRED** for belt hold ("Trend Required: Yes") and **NOT required** for the opening
     marubozu (Bulkowski: "None required" for every marubozu variant).
  2. Belt hold additionally wants the close **near the far extreme** (`close_pos >= 0.80`), i.e. a
     large body that ran the whole session — Morris's "rallies significantly against the previous
     trend… closes near its high."
  **A gap is NOT part of the recognition rules.** Morris's *psychology* section says "The market is
  trending when a **significant gap** in the direction of trend occurs on the open," and much popular
  literature ("the bullish belt hold **gaps down** on the open") treats the gap as definitional. But
  Morris's own numbered Rules of Recognition contain **no gap condition**, and TA-Lib's `CDLBELTHOLD`
  has **no gap condition** either. ⇒ **Do not require a gap.** (See §C.5.)
  - **TA-Lib `CDLBELTHOLD`:** `body > BodyLong` AND (white → `lower < ShadowVeryShort`;
    black → `upper < ShadowVeryShort`). **No trend test at all** — so TA-Lib's belt hold is exactly an
    opening marubozu and cannot distinguish the two. Do not copy.

### B.15 — Bearish belt hold

- **Names:** Bearish belt hold; black opening shaven head. JP: **yorikiri**.
- **Executable:** `not is_white` AND `body > AB` AND `upper_pct <= 0.03` AND `close_pos <= 0.20`
  AND **prior UPTREND**.
- **Thresholds:**
  - **Morris:** "3. The bearish black Belt Hold **opens on its high and has no upper shadows**."
    Commentary: "a black opening marubozu that occurs in an **uptrend**… opens on its high, trades
    against the trend of the market, and then **closes near its low**." Trend Required: **Yes**;
    Confirmation: **Required** (stronger requirement than the bullish version's "Suggested").
  - **Bulkowski:** "Price **opens at the high** for the day and closes near the low, forming a tall
    black candle, **often with a small lower shadow**." Prior trend: **"Upward."** Bearish reversal
    **68%** in bull markets; frequency 19/103, overall 63/103.
  - **CandleScanner:** lower shadow **≤ 25% of the candle**; no upper shadow; long line.
- **Bias:** Bearish. **TREND-DEPENDENT.**
- **Structure:** Reversal.
- **Morris's measured asymmetry (worth knowing):** his Belt Hold + net profit/loss is roughly flat
  (+0.14 → +0.31 over 1–7 days) while Belt Hold − is **negative throughout** (−0.10 → −0.72), i.e.
  the bearish belt hold did **not** work as a bearish signal in his 7,275-stock / 14.6M-day sample.

### B.16–B.19 — THE FOUR UMBRELLA NAMES (two geometries, split 100% by trend)

**★ This is the most important structural fact in this document.** Hammer, hanging man, inverted
hammer and shooting star are **two shapes with four names**. The geometry does not distinguish them.

```python
UMBRELLA          = body < AB and lower >= 2.0*body and upper_pct <= 0.10 and close_pos >= 0.60
INVERTED_UMBRELLA = body < AB and upper >= 2.0*body and lower_pct <= 0.10 and close_pos <= 0.40
```

| Geometry | After a DOWNTREND | After an UPTREND |
|---|---|---|
| UMBRELLA (long lower shadow) | **Hammer** (bullish) | **Hanging man** (bearish) |
| INVERTED UMBRELLA (long upper shadow) | **Inverted hammer** (bullish) | **Shooting star** (bearish) |

Note the diagonal: the **same shape flips sign** depending only on where it sits. Emitting one name
for both is not an incomplete taxonomy — it is a **wrong sign roughly half the time**.

- **Umbrella family JP names:** paper umbrella = **karakasa**; hammer = **tonkachi** (also means
  "the ground/soil"); hanging man = **kubitsuri** ("a man hanging"); the doji-bodied cousins are
  **tonbo/takuri** (down) and **tohba** (up). Morris files the Inverted Hammer under JP name **tohba**.

#### What each source requires for the TREND context (stated as assigned, even though R02 owns depth)

| Source | Hammer | Hanging man | Inverted hammer | Shooting star |
|---|---|---|---|---|
| **Morris** | "occurs in a **downtrend**"; "the low of the body should be **below the trend**" | "occurs at the **top of a trend or during an uptrend**"; body low **above the trend** | "**No gap down is required, as long as the pattern falls after a downtrend**" | "**Prices gap open after an uptrend**" |
| **Bulkowski** | Trend: **"Downward"** | Trend: **"Upward"** | Trend: **"Downward"** (and he makes it a **2-line** pattern) | Trend: **"Upward"**; no gap required |
| **StockCharts** | "forms **after a decline**" | "forms **after an advance**" | "forms **after a decline**" | "forms **after an advance**" |
| **StockCharts (window)** | prior-trend window **1–4 weeks** of price action | same | same | same |
| **TA-Lib** | *proxy only*: `min(o,c) <= low[i-1] + Near` — body at/below **prior bar's low** | *proxy only*: `min(o,c) >= high[i-1] - Near` — body at/above **prior bar's high** | *proxy only*: **gap down** vs prior body | *proxy only*: **gap up** vs prior body |
| **Nison (via Morris)** | confirmation = next day opens/closes higher | confirmation = black body + next day opens lower | next day opening above the body | — |

**⚠ TA-Lib has NO trend detection.** It substitutes a **one-bar positional proxy**. That proxy is
weak (a single prior bar is not a trend) and, for shooting star / inverted hammer, requires a **true
gap** — which is why `CDLSHOOTINGSTAR` almost never fires on daily US equities (this is a known,
filed complaint: TA-Lib/ta-lib-python issue #647, "Candle pattern 'Shooting Star' is not detected").
**Do not adopt the TA-Lib proxy.** Use a real trend measure (R02's job).

#### B.16 Hammer
- **Executable:** `UMBRELLA and prior_downtrend`.
- **Thresholds:**
  - **Morris — Rules of Recognition (verbatim):** "1. The small real body is at the **upper end** of
    the trading range. 2. The **color of the body is not important**. 3. The long lower shadow should
    be much longer than the length of the real body, **usually two or three times**. 4. There should
    be **no upper shadow**, or if there is, it should be **very small**."
  - **Morris — Pattern Flexibility (the hard numbers):** "The lower shadow should be, at a minimum,
    **twice as long as the body, but not more than three times**. The upper shadow should be **no more
    than 5 to 10 percent of the high-low range**."  ← note the **upper BOUND** on the lower shadow;
    beyond 3× it becomes a **Takuri line** (B.3), which Morris says is "generally more bullish."
  - **Bulkowski:** "have a **long lower shadow at least two or three times the height of the body**
    with **little or no upper shadow**," in a downward price trend. Bullish reversal **60%**
    (reversal rank 26); overall rank 65/103; 88% hit price targets in bull markets/up breakouts.
  - **StockCharts:** "the long shadow should be **at least twice the length of the real body**."
  - **thismatter:** "short real body and a lower shadow that is **2 to 3 times longer** than the body."
  - **TradingView / common Pine:** `lower_wick > 2*body and upper_wick < body`; the wick-to-body ratio
    is a configurable parameter, **default 2.0**.
  - **Academic (fuzzy-candlestick literature):** wick-to-body ≥ 2.0 and "the body should occupy **no
    more than one-third** of the total high-to-low range" (`body_pct <= 0.333`).
  - **TA-Lib `CDLHAMMER`:** `body < BodyShort` AND `lower > ShadowLong` (= 1 × own body — much weaker
    than 2×) AND `upper < ShadowVeryShort` AND `min(o,c) <= low[i-1] + Near`.
- **Bias:** Bullish. **CONTEXT-DEPENDENT** (the shape alone is a hanging man in an uptrend).
- **Structure:** Reversal.
- **Enhancers (Morris):** "an extra long lower shadow, no upper shadow, very small real body (almost
  Doji), the preceding sharp trend, and a body color that reflects the opposite sentiment." Also
  "a Hammer with a **white** body would be more bullish than one with a black body."

#### B.17 Hanging man
- **Executable:** `UMBRELLA and prior_uptrend`.
- **Thresholds:** identical geometry to the hammer; Morris shares one Rules-of-Recognition block for
  both. Bulkowski: "Look for a **small bodied candle atop a long lower shadow in an uptrend**."
- **Bias:** Bearish. **CONTEXT-DEPENDENT** (the bias is *entirely* the trend).
- **Structure:** Reversal.
- **⚠ Measured performance is bad — carry this:** Bulkowski found the hanging man acts as a
  **bullish continuation 59% of the time** — i.e. it fires the **opposite** of its textbook meaning.
  Overall rank **87/103**. Nison's own qualifier (via Morris): a hanging man is more credible if
  "the body is **black** and the next day **opens lower**."
- **Color rule (Morris):** "A Hanging Man with a **black** body is more bearish than one with a white
  body." Worth exposing as a sub-flag rather than changing the label.

#### B.18 Inverted hammer
- **Executable:** `INVERTED_UMBRELLA and prior_downtrend`.
- **Thresholds:**
  - **Morris — Rules of Recognition (verbatim):** "1. A small real body is formed near the **lower
    part** of the price range. 2. **No gap down is required**, as long as the pattern falls after a
    downtrend. 3. The upper shadow is usually **no more than two times** as long as the body.
    4. The lower shadow is **virtually nonexistent**."
  - **⚠ Morris contradicts himself:** his Pattern Flexibility section for the same pair says "The
    upper shadow should be **at least twice** the length of the body." Rule 3 is an **upper** bound,
    the flexibility note a **lower** bound, on the same quantity. (See §C.6.)
  - **Morris — Pattern Flexibility:** "There should be **no lower shadow**, or at least **not more
    than 5 to 10 percent of the high-low range**." Trend Required: **Yes**; Confirmation: **No**.
  - **Bulkowski — treats it as a TWO-line pattern:** "Number of candle lines: **Two.**… Look for a
    **tall black candle with a close near the day's low** followed by a short candle with a tall upper
    shadow and little or no lower shadow. The second candle **cannot be a doji**… and the **open on
    the second candle must be below the prior candle's close**." Measured: **bearish continuation 65%**
    (again the opposite of the textbook claim), but overall rank **6/103** — his 6th best pattern.
  - **TA-Lib `CDLINVERTEDHAMMER`:** `body < BodyShort` AND `upper > ShadowLong` AND
    `lower < ShadowVeryShort` AND **gap down**: `max(o,c) < min(o1,c1)`.
- **Bias:** Bullish. **CONTEXT-DEPENDENT.** Morris: verification "is most important" because the
  close is near the low while the market traded much higher.
- **Structure:** Reversal.
- **Morris's "pattern breakdown" caution:** the inverted hammer "reduces to a **long black candle
  line**, which is always viewed as a bearish indication when considered alone… **in direct conflict**
  with their breakdowns."

#### B.19 Shooting star
- **Executable:** `INVERTED_UMBRELLA and prior_uptrend`.
- **Thresholds:**
  - **Morris — Rules of Recognition (verbatim):** "1. **Prices gap open after an uptrend.** 2. A small
    real body is formed near the lower part of the price range. 3. The upper shadow is **at least
    three times** as long as the body. 4. The lower shadow is virtually nonexistent." Morris:
    "The body of the Shooting Star **does gap above** the previous day's body. This fact actually means
    that the Shooting Star could be referred to as a **two-line pattern**."
  - **Bulkowski — no gap:** "small bodied candle (**but not a doji**), **tall upper shadow at least
    twice the height of the body**, little or no lower shadow," prior trend "Upward." **No gap
    requirement.** Bearish reversal 59% ("near random"), overall rank 55/103.
  - **StockCharts:** "the upper shadow should be relatively long and **at least 2 times the length of
    the body**"; forms after an advance.
  - **TA-Lib `CDLSHOOTINGSTAR`:** `body < BodyShort` AND `upper > ShadowLong` AND
    `lower < ShadowVeryShort` AND **gap up**: `min(o,c) > max(o1,c1)`.
- **Bias:** Bearish. **CONTEXT-DEPENDENT.**
- **Structure:** Reversal. Morris: "It is **not a major reversal signal**."
- **Relationship to gravestone doji (Morris):** "The Gravestone Doji at a market top is a specific
  version of a Shooting Star. The **only** difference is that the Shooting Star has a small body and
  the Gravestone Doji, being a Doji, has no body." ⇒ test gravestone first.

### B.20–B.23 — Long / ordinary / short plain candles

- **Names:** Long white candle = **long day**, **yang line**, *Major Yang*; long black = **yin line**,
  *Major Yin*. Morris: "Yin relates to bearish and yang relates to bullish." (Morris counts "9 basic
  yin and yang lines… expanded to **15** different candle lines.")
- **Executable:**
  ```python
  plain      = upper < body and lower < body          # CandleScanner: "two shadows shorter than the body"
  long_day   = plain and body >= 3*avg_body_10
  ordinary   = plain and avg_body_10 < body < 3*avg_body_10
  short_day  = plain and body <= avg_body_10
  ```
- **★ How "long" is defined — RELATIVE, never a fixed fraction of range. All sources agree on the
  principle and disagree on the number (§C.2):**
  - **Morris:** "**Long describes the length of the candlestick BODY**, the difference between the open
    price and the close price… How much must the open and close price differ to qualify as a long day?
    …**Long compared to what?** It is best to consider only the **most recent price action**…
    **Anywhere from the previous 5 to 10 days** should be more than adequate." Short days "may also be
    based on the same methodology." He explicitly notes many days "do not fall into any of these two
    categories" — i.e. an **ordinary** middle tier is expected.
  - **Bulkowski (long white day) — the most precise rule found anywhere:** "Look for a **tall white
    candle with shadows shorter than the body** and a **body at least THREE TIMES taller than the
    average body height over the last 2 or 3 weeks**." Prior trend: "None required." Continuation 58%,
    frequency rank 10/103, overall 53/103.
  - **Bulkowski (short white candle):** "A **short candle with shadows shorter than the body**."
    Prior trend "None required." **No numeric threshold given.** Reversal 52%, overall rank 85/103.
  - **CandleScanner — RANGE-based, not body-based:** long vs short line is set by "the **exponential
    average distance between the highest and lowest prices** of individual candles for the **previous
    25 candles**." A candle spanning **more than 70 percent** of that value is a **long line**; below
    is a **short line**. The 70% is user-adjustable; "the optimal range is somewhere between **65 and
    80 percent**."
  - **TA-Lib `CDLLONGLINE`:** `body > BodyLong` AND `upper < ShadowShort` AND `lower < ShadowShort`,
    where `BodyLong` = **1.0 ×** avg body over prior 10. `CDLSHORTLINE` = `body < BodyShort` AND both
    shadows `< ShadowShort`, and `BodyShort` is **also** 1.0 × avg body over prior 10.
    **⚠ TA-Lib's "long" and "short" partition at the SAME point** (above vs below the 10-bar mean
    body) — there is **no middle tier and no gap**, and "long" means merely "above average."
  - **StockCharts:** qualitative only — "The longer the body is, the more intense the buying or
    selling pressure."
- **Bias:** Directional, intrinsic (white bullish / black bearish), weak — Bulkowski measures
  continuation at 58% for the long white day.
- **Structure:** Continuation.

### B.24 — Strong line (bullish / bearish)

- **Names:** Bullish strong line / bearish strong line (CandleScanner terminology).
- **Executable:** `body >= 3*avg_body_5 and close_pos >= 0.90` (bullish) / `close_pos <= 0.10` (bearish).
- **Thresholds:** CandleScanner: "the candlestick body needs to be **at least three times higher than
  the average body of the last 5 or 10 candles**."
- **Bias:** Directional, intrinsic.
- **Structure:** Continuation.
- **Note:** overlaps heavily with long day + closing marubozu. Include only if you want a "conviction"
  flag; otherwise fold into #21/#22. Listed for completeness of the taxonomy.

### B.25 — Structures the assignment's list misses (found in the sweep)

1. **Takuri line** (B.3) — a named, *more bullish* dragonfly. Morris gives a hard 3×-body rule.
2. **Rickshaw man as a distinct constraint** — TA-Lib separates `CDLRICKSHAWMAN` from
   `CDLLONGLEGGEDDOJI` by the **midpoint** clause (`Near` = 0.2 × avg range over prior 5). Treating
   "rickshaw man" as a pure synonym for long-legged doji loses that.
3. **Ordinary (middle-tier) white/black candle** — Morris explicitly notes days that are neither long
   nor short. Without this tier the "none" bucket cannot be eliminated.
4. **Northern doji / Southern doji** (Bulkowski, `NorthernDoji.html` / `SouthernDoji.html`) — the same
   doji geometry qualified by an up- vs down-trend, exactly parallel to hammer/hanging man. If the
   screener carries trend, doji should get the same North/South split.
5. **Gapping up doji / gapping down doji** (Bulkowski) — the doji-star qualifier as standalone labels.
6. **Shaven head / shaven bottom** (B.13) — ambiguous aliases; document, don't emit.
7. **Four-price doji as a data-quality flag** rather than a pattern (B.1).
8. **Star (hoshi) as a general qualifier** — any small body gapping clear of a prior long body,
   not just a doji body. Morris B.7.

---

## C. SOURCES DISAGREE — every numeric conflict found

### C.1 ★ Doji body threshold — the widest spread in the taxonomy
| Source | Rule | As a number |
|---|---|---|
| Nison | "the same or very close to being the same" | none |
| Morris | "within a few ticks" | ~$0.01–0.05 absolute |
| Bulkowski | "within pennies of each other" | ~$0.01–0.03 absolute |
| CandleScanner | 0–3% of candle height (default), configurable 0–5% | `body_pct <= 0.03` |
| TA-Lib | `body <= 0.1 × avg(h−l) over prior 10` | ~10% of **average range** |
| Current UCT code | `body/rng < 0.10` | 10% of **own range** |

Two axes of disagreement, not one: **(a) the magnitude** (pennies vs 3% vs 10%) and **(b) the
denominator** (absolute ticks vs own range vs 10-bar average range). CandleScanner's own analysis
warns the choice is consequential: widening tolerance from strict equality to 3–5% increases doji
counts by "**dozens to several hundred percent**," and higher tolerances "risk misidentifying other
patterns (Hammer, Hanging Man, Shooting Star) as doji candles." They also note nominal price level
matters — assets above $20 need larger absolute body allowances. **On a 3,700-name universe spanning
$1 to $1,000+, an absolute-pennies rule is unusable; the denominator must be a range.**

### C.2 ★ "Long body" multiple — 3× vs 1× (the biggest practical conflict)
| Source | Threshold | Lookback | Measures |
|---|---|---|---|
| **Bulkowski** | body ≥ **3×** average body | **2–3 weeks** (~10–15 bars) | **body** |
| **CandleScanner (strong line)** | body ≥ **3×** average body | **5 or 10** candles | **body** |
| **TA-Lib `BodyLong`** | body > **1.0×** average body | **10** bars | **body** |
| **TA-Lib `BodyVeryLong`** | body > **3.0×** average body | **10** bars | **body** |
| **CandleScanner (long line)** | range > **70%** of EMA25 | **25** candles | **range (h−l)** |
| **Morris** | "no rigid rules, only guidelines" | **5–10** days | **body** |

Three-way conflict: **3× vs 1×** on the multiple, **5 vs 10 vs 15 vs 25** on the lookback, and
**body vs range** on what is measured. TA-Lib's `BodyLong` at 1.0× means ~half of all bars are "long."
Bulkowski's 3× is ~10× more selective. **Note TA-Lib's `BodyVeryLong` (3.0×/10) reconciles exactly
with Bulkowski's long-day rule** — that is the setting to use, not `BodyLong`.

### C.3 ★ TA-Lib `BodyLong` and `BodyShort` are IDENTICAL parameters
Both are `RangeType_RealBody, avgPeriod 10, factor 1.0`. So `body > BodyLong` and `body < BodyShort`
partition at the **same point** — the 10-bar mean body. TA-Lib therefore has **no "ordinary" tier and
no dead-band**: every bar is either "long" or "short," and "long" merely means "above average." Every
other source expects three tiers with a gap. This is almost certainly why TA-Lib's long/short line
functions fire so often.

### C.4 ★ High wave — one long shadow or two? And 2× or 3×?
| Source | Shadows required | Multiple | Line length |
|---|---|---|---|
| **Nison, 1st edition** | **both** long | — | — |
| **Nison, later edition** | **one** is sufficient | "very long" | — |
| **CandleScanner** | **at least one** | **≥ 3× body** | **long line required** |
| **TA-Lib `CDLHIGHWAVE`** | **both** | **> 2× own body** | none |
| **Bulkowski** | "tall upper **and** lower shadows" | **no number** | none |

Nison contradicts **himself across editions**. CandleScanner (3×, one shadow) vs TA-Lib (2×, both
shadows) is a genuine 50%-different threshold on a different quantifier. Only Bulkowski supplies the
clean qualitative separator: **high wave is not a doji** — "the opening and closing prices must be
more than a few pennies apart."

### C.5 ★ Belt hold — is a gap required?
- **Morris — Rules of Recognition:** **no gap condition.** Only "lack of a shadow on one end" + trend.
- **Morris — psychology section:** "a **significant gap** in the direction of trend occurs on the open."
- **TA-Lib `CDLBELTHOLD`:** **no gap condition** (and no trend condition either).
- **Bulkowski:** **no gap** — "a white candle with no lower shadow, but closing near the high."
- **Popular/retail literature (babypips, tradingsim, litefinance):** "the bullish belt hold **gaps
  down** on the open… This gap down is a **key characteristic**."

The formal sources (Morris's numbered rules, Bulkowski, TA-Lib) **do not require a gap**; the
narrative/retail sources do. **Resolution: do not require a gap.** Requiring one would cut the
population by an order of magnitude on daily equity bars, exactly as it does for TA-Lib's shooting star.

### C.6 ★ Morris contradicts himself on the inverted hammer's upper shadow
- Rules of Recognition #3: "The upper shadow is usually **no more than two times** as long as the body."
- Pattern Flexibility (same section, same pair): "The upper shadow should be **at least twice** the
  length of the body."
One is a ceiling, the other a floor, on the same measurement. **Resolution: treat 2× as the FLOOR**
(consistent with Bulkowski, StockCharts, TradingView and the shooting-star rule), and treat Rules #3
as a typo/mis-edit.

### C.7 ★ Hammer lower shadow — is there an upper bound?
- **Morris:** "at a minimum, twice as long as the body, **but not more than three times**" — an
  explicit **ceiling**, because beyond 3× it becomes a **Takuri line**.
- **Bulkowski:** "at least two or three times the height of the body" — a **floor**, no ceiling.
- **StockCharts / TradingView / academic:** "at least twice" — floor only, no ceiling.
Only Morris caps it. **Resolution:** use 2× as the floor for hammer, and use 3× as the *promotion*
threshold to takuri rather than as a rejection.

### C.8 Umbrella upper-shadow tolerance
| Source | Max upper shadow (umbrella) |
|---|---|
| Morris | **5–10% of the high-low range** (`upper_pct <= 0.05–0.10`) |
| TA-Lib | `< 0.1 × avg range over prior 10` (not own range) |
| TradingView / common Pine | `upper_wick < body` (a body-relative test, not range-relative) |
| Current UCT code | `upper/range < 0.15` |
The current 0.15 is **looser than every source**; Morris's ceiling is 0.10 at its most permissive.

### C.9 Body-size cap for umbrella shapes
- **Academic (fuzzy candlestick):** "the body should occupy **no more than one-third** of the total
  high-to-low range" → `body_pct <= 0.333`.
- **Morris / Bulkowski / StockCharts:** "small real body" — relative to *recent* bodies, no fraction.
- **TA-Lib:** `body < BodyShort` = below the 10-bar mean body (relative, not a fraction of range).
- **Current UCT code:** `body/range < 0.35`.
The current 0.35 happens to sit near the academic 0.333, but it is a **fraction-of-own-range** test
where the books call for a **relative-to-recent-bodies** test. These select different bars.

### C.10 Shooting star — gap required?
- **Morris:** **YES** — Rule #1 is "Prices gap open after an uptrend"; he says this makes it
  arguably a two-line pattern.
- **TA-Lib:** **YES** — `min(o,c) > max(o1,c1)`.
- **Bulkowski:** **NO** — no gap in his identification guidelines.
- **StockCharts:** **NO** — only "forms after an advance."
Consequence: on daily US equities the gap requirement makes the pattern nearly extinct
(TA-Lib issue #647). **Resolution: no gap; use a real trend test.**

### C.11 Inverted hammer — one candle or two?
- **Morris / StockCharts / TA-Lib:** **one** candle line.
- **Bulkowski:** **"Number of candle lines: Two."** — requires a preceding tall black candle closing
  near its low, and "the open on the second candle must be below the prior candle's close."
A structural, not numeric, disagreement — but it changes what the detector reads.

### C.12 Marubozu shadow tolerance
| Source | Tolerance |
|---|---|
| StockCharts | **exact**: open == low and close == high |
| Morris / Bulkowski | "**no** upper or lower shadows" (qualitative, effectively exact) |
| TA-Lib | `< 0.1 × avg range over prior 10` (a visible wick passes) |
| CandleScanner (opening white marubozu) | body **≥ 51% of total candle height**, upper shadow < body |
| CandleScanner (belt hold) | permitted shadow **≤ 25% of the candle** |
| Current UCT code | `body/range > 0.85` (⇒ shadows sum ≤ 15%) |
Spread runs from **0%** (StockCharts, exact) to **49%** (CandleScanner's 51%-body rule). That is the
single widest *relative* spread in the document, and it means "marubozu" is not one population.

### C.13 Doji star gap strictness
- **TA-Lib:** gap measured **body-to-body** (`min(o,c) > max(o1,c1)`).
- **Morris/Nison:** "**Ideally, the gap should encompass the shadows**, but this is not always
  necessary" — a stricter, full-range gap as the ideal.

### C.14 Measured bias contradicts textbook bias (not a threshold conflict, but decisive)
Bulkowski's testing repeatedly inverts the classical claim:
| Pattern | Textbook | Bulkowski measured |
|---|---|---|
| Hanging man | bearish reversal | **bullish continuation 59%** |
| Inverted hammer | bullish reversal | **bearish continuation 65%** |
| Dragonfly doji | bullish reversal | reversal **50%** (random) |
| Gravestone doji | bearish reversal | reversal **51%** (random) |
| Shooting star | bearish reversal | reversal **59%** ("near random") |
| Hammer | bullish reversal | reversal **60%** |
| Spinning top | indecision | reversal **50%**; "I really do not see any benefit to this candle" |
| High wave | indecision | reversal **51%** |
| Bullish belt hold | bullish reversal | reversal **71%** ← one of the few that holds up |
**Implication for the CANDLE column:** label the *geometry* faithfully; do not let the column imply a
forecast. The one single-bar structure with a defensible edge in Bulkowski's sample is the
**bullish belt hold (71%, reversal rank 11/103)**.

---

## D. SOURCES

| # | Source | URL | Used for |
|---|---|---|---|
| 1 | **TA-Lib C source** — `ta_global.c` | https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_common/ta_global.c | The complete `TA_CandleDefaultSettings` table (rangeType/avgPeriod/factor for all 11 settings) |
| 2 | **TA-Lib** — `ta_utility.h` | https://raw.githubusercontent.com/TA-Lib/ta-lib/main/src/ta_func/ta_utility.h | Verbatim `TA_REALBODY`/`TA_UPPERSHADOW`/`TA_LOWERSHADOW`/`TA_CANDLERANGE`/`TA_CANDLEAVERAGE` macros — the exact averaging semantics incl. the `/2.0` for Shadows rangeType |
| 3 | **TA-Lib** — pattern sources (15 files) | `.../src/ta_func/ta_CDL{DOJI,DOJISTAR,DRAGONFLYDOJI,GRAVESTONEDOJI,LONGLEGGEDDOJI,RICKSHAWMAN,TAKURI,MARUBOZU,CLOSINGMARUBOZU,BELTHOLD,HIGHWAVE,SPINNINGTOP,HAMMER,HANGINGMAN,INVERTEDHAMMER,SHOOTINGSTAR,LONGLINE,SHORTLINE}.c` | Exact per-pattern conditions, "Must have" comments, and output-sign semantics |
| 4 | **Greg Morris, _Candlestick Charting Explained_** (full text, extracted from PDF) | https://oxycapitals.com/wp-content/uploads/2025/04/Candlestick-Charting-Explained.pdf | Ch.2 basic candle lines (long/short days, marubozu variants, spinning top/koma, all doji types, stars/hoshi, paper umbrella/karakasa); Ch.3 Rules of Recognition + Pattern Flexibility numerics for hammer/hanging man/inverted hammer/shooting star/belt hold; Japanese names; his 7,275-stock / 14.6M-day statistics |
| 5 | **Thomas Bulkowski — thepatternsite.com** (13 pages) | Hammer.html, HangingMan.html, HammerInv.html, ShootingStar.html, Dragonfly.html, Gravestone.html, LongLegDoji.html, HighWave.html, SpinTopWhite.html, WhiteMarubozu.html, ClosingWhiteMarubozu.html, OpenWhiteMarubozu.html, BeltHoldBull.html, BeltHoldBear.html, LongWhiteDay.html, ShortWhiteCandle.html, CandleEntry.html | Identification guidelines, the **3× average body over 2–3 weeks** long-day rule, prior-trend requirements, and measured reversal/continuation rates + frequency/performance ranks out of 103 |
| 6 | **StockCharts ChartSchool — Introduction to Candlesticks** | https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/introduction-to-candlesticks | The "2× the real body" long-shadow rule, the 1–4 week prior-trend window, the hammer≡hanging-man and inverted-hammer≡shooting-star identity statements, doji-in-context rule |
| 7 | **StockCharts ChartSchool — Candlestick Pattern Dictionary** | https://chartschool.stockcharts.com/table-of-contents/chart-analysis/candlestick-charts/candlestick-pattern-dictionary | Short-form definitions of doji types, marubozu, spinning top, long/short bodies |
| 8 | **CandleScanner** (10 pages) | /basic-candles/, /long-and-short-lines/, /doji-2/, /long-legged-doji/, /four-price-doji/, /the-problem-with-doji-candles-part-i/, /high-wave/, /white-spinning-top/, /white-marubozu/, /opening-white-marubozu/, /bearish-belt-hold/ | The only fully **mutually-exclusive** taxonomy found; the **70% of EMA25(h−l) over 25 candles** long/short line rule; **0–3% (max 5%) doji body**; the **3× body** spinning-top/high-wave boundary; **51% body** opening-marubozu rule; **25%** belt-hold shadow cap; the Nison edition change on high wave; doji-by-exclusion semantics |
| 9 | **Steve Nison, _Japanese Candlestick Charting Techniques_** (via Morris's direct citations + CandleScanner's edition comparison + p.94 belt-hold citation) | quoted in #4 and #8 | "Virtually equal" doji standard; the tops-vs-bottoms doji asymmetry; hanging-man confirmation rule; belt-hold height significance; the 1st-vs-2nd-edition high-wave change; coined the name "Belt Hold" |
| 10 | **thismatter.com — Candlestick Chart Analysis** | https://thismatter.com/money/technical-analysis/candlestick-charts.htm | Shaven top / shaven bottom terminology mapping; "2 to 3 times" hammer rule |
| 11 | **TradingView** (Pine detection conventions, pattern script pages) | https://www.tradingview.com/scripts/hammer/ , /shootingstar/, /invertedhammer/, /hangingman/, /doji/ | The de-facto Pine formulation `lower_wick > 2*body and upper_wick < body`; wick-to-body ratio as a configurable parameter with **default 2.0** |
| 12 | **Academic — fuzzy-candlestick literature** (Expert Systems with Applications; "Fuzzy modeling of stock trading with fuzzy candlesticks"; "Investigating candlestick patterns using fuzzy logic") | https://www.sciencedirect.com/science/article/abs/pii/S0957417417306784 ; https://turcomat.org/index.php/turkbilmat/article/view/11151 ; https://www.sciencedirect.com/science/article/abs/pii/S1058330012000092 | Normalized shadow formulations (`k_up=(h−max(o,c))/o`, `k_low=(min(o,c)−l)/o`); the `body ≤ 1/3 of range` umbrella constraint; the argument that crisp thresholds on inherently vague definitions produce unstable detection |
| 13 | **TA-Lib issue #647** | https://github.com/TA-Lib/ta-lib-python/issues/647 | Field evidence that TA-Lib's gap-requiring shooting star effectively never fires on daily equity data |

---

## E. DEFECTS IN THE CURRENT RULES

The five rules under audit:
```
hammer:        lower/range > 0.5  AND body/range < 0.35 AND upper/range < 0.15
shooting-star: upper/range > 0.5  AND body/range < 0.35 AND lower/range < 0.15
doji:          body/range < 0.10
marubozu:      body/range > 0.85
spinning-top:  body/range < 0.30
```

### E.1 ☠ CRASH — no zero-range guard
Every rule divides by `range`. `range == 0` is a **four-price doji**, and on ~3,700 US tickers it
occurs (halted names, delisting stubs, illiquid microcaps, non-trading days that still emit a bar).
`body/range` raises `ZeroDivisionError` (or yields `nan`, which makes every comparison `False` and
silently dumps the bar into "none"). **Fix:** detect `rng == 0` first and return `four-price-doji`
(and treat it as a data-quality flag, not a signal). This is the highest-severity defect because it
is either an exception or a silent wrong answer.

### E.2 ☠ WRONG SIGN ~50% of the time — no trend split on the two umbrella geometries
This is the most damaging *correctness* defect, not merely a missing feature.
- The `hammer` rule matches the UMBRELLA geometry. After an **uptrend** that same shape is a
  **hanging man — bearish**. The column currently prints "hammer" (bullish) for both.
- The `shooting-star` rule matches the INVERTED-UMBRELLA geometry. After a **downtrend** that shape is
  an **inverted hammer — bullish**. The column currently prints "shooting-star" (bearish) for both.

Every source is unanimous that the split is 100% context: StockCharts calls them "**identical
candlesticks**"; Morris shares one Rules-of-Recognition block across hammer and hanging man and says
the shooting star "**looks exactly the same as** the Inverted Hammer"; Bulkowski assigns opposite
required trends. **A screener column that names a bullish reversal on a bearish structure is worse
than emitting "none."** Until trend context exists, the honest labels are neutral geometry names
(`umbrella` / `inverted-umbrella`), not `hammer` / `shooting-star`.

### E.3 ☠ Label collisions — the rule set is not mutually exclusive, so output depends on evaluation order
The five predicates overlap heavily and nothing enforces precedence:
- `body/range < 0.10` (doji) ⊂ `body/range < 0.30` (spinning-top). **Every doji is also a spinning
  top.** Whichever is checked first wins.
- A bar with `body=0.05, upper=0.02, lower=0.93` satisfies **both** `doji` and `hammer`. Classically it
  is a **dragonfly doji** (or a **takuri line**) — and the code can emit *neither*, only whichever of
  the two overlapping rules is tested first.
- A bar with `body=0.05, upper=0.47, lower=0.48` satisfies `doji` and `spinning-top`; it is a
  **long-legged doji / rickshaw man**.
- `body/range < 0.35` (hammer/star) overlaps `body/range < 0.30` (spinning-top) across `[0, 0.30)`.

**Fix:** impose the §B.0 order and define the generic labels by **exclusion**, the way CandleScanner
does ("a doji candle cannot meet requirements for these specific types…").

### E.4 ☠ Everything is normalized to the bar's OWN range — no comparison to recent bars anywhere
This is the deepest architectural defect, and it is the one the assignment flagged. Not a single rule
references a rolling average. Consequences:
- **"Long"/"short" is unrepresentable.** Every classical source defines a long body **relative to
  recent bodies** — Morris ("Long compared to what? …the previous 5 to 10 days"), Bulkowski (3× the
  2–3 week average body), TA-Lib (`BodyLong`/`BodyShort` vs the 10-bar mean), CandleScanner (70% of
  EMA25 of range). `body/range` **cannot express this**: a doji-range inside day and a limit-up bar
  both have `body/range ≈ 0.9`.
- **`marubozu: body/range > 0.85` mislabels noise as conviction.** A $0.03-range bar with a
  $0.027 body scores 0.90 and is labeled `marubozu` — "an extremely strong line" (Morris) — when the
  stock effectively did not move. Morris, Bulkowski and TA-Lib **all** require the body to be **long**
  in addition to shadowless. The missing `body > k*avg_body_10` conjunct is what makes this rule
  actively misleading.
- **The doji threshold is on the wrong denominator.** TA-Lib uses `0.1 × avg range over prior 10`;
  the current code uses 10% of the bar's **own** range. On a narrow inside day a genuinely dead bar
  fails the doji test; on a huge-range day a large absolute body passes it. Recommend requiring
  **both** (`body_pct` small **and** `body <= 0.1*avg_range_10`).
- **The "significance" rule from StockCharts and Morris is inexpressible** — "a doji that forms among
  candlesticks with **small** real bodies would not be considered important; a doji that forms among
  candlesticks with **long** real bodies would be deemed significant." That needs `avg_body_10`.

**Fix:** add `avg_body_10`, `avg_range_10`, `ema_range_25` as first-class inputs. Rolling means over a
3,700-name daily panel are one `df.groupby('ticker').rolling(10).mean().shift(1)` — cheap. Note the
**`.shift(1)`: the window must exclude the current bar**, matching TA-Lib, or the bar contaminates its
own threshold.

### E.5 Thresholds are looser than every source, in the same direction
| Rule | Current | Sources | Effect |
|---|---|---|---|
| umbrella upper shadow | `< 0.15` | Morris **0.05–0.10** | admits bars with a visible opposing wick |
| hammer shadow-to-body | **absent** | Morris/Bulkowski/StockCharts/TradingView **≥ 2×** | see below |
| umbrella body cap | `< 0.35` | academic `≤ 0.333`; books: relative to recent bodies | wrong denominator |
| spinning-top shadows | **absent** | Morris/TA-Lib: **both** shadows > body | see E.6 |

**The missing shadow-to-body ratio is a real false-positive source.** `lower/range > 0.5` combined
with `body/range < 0.35` permits `lower/body` as low as `0.5/0.35 = 1.43`. Every source requires
**≥ 2.0**. Bars with a 1.4–2.0 ratio are currently labeled hammers and are not hammers under any
authority consulted.

### E.6 `spinning-top: body/range < 0.30` omits the pattern's defining condition
Morris is explicit: "The small body **relative to the shadows** is what makes the spinning top" —
the shadows must **exceed the body** (Morris and TA-Lib require *both*; CandleScanner at least one).
The current rule tests only body-vs-range and never compares shadows to the body at all. Combined
with spinning top's **frequency rank 2 of 103** (Bulkowski — the 2nd most common candle in existence),
a too-loose rule makes this label swamp the column. It is also acting as an unlabeled catch-all for
`[0, 0.30)`, which is precisely why the taxonomy below it looks empty.

### E.7 No sub-types — four families collapsed to one label each
- **Doji → 1 label instead of 6.** Dragonfly (bullish), gravestone (bearish), long-legged/rickshaw
  (neutral), takuri (strongly bullish), four-price (data flag) and standard doji all print `doji`.
  **This discards directional information that exists in the bar**: dragonfly and gravestone are
  geometric opposites with opposite biases, and both currently print the same neutral label.
- **Marubozu → 1 label instead of 3 (+2 belt holds).** Full vs closing vs opening marubozu are
  distinguished by *which* shadow is absent, and Morris ranks them ("The Opening Marubozu is not as
  strong as the Closing Marubozu"). `body/range > 0.85` cannot tell them apart because it never looks
  at *which* side is flat. **Belt hold — the single best-performing single-bar structure in
  Bulkowski's sample (71% reversal, rank 11/103) — is entirely undetectable** by the current rules.
- **Spinning top → 1 label instead of 2.** High wave is a distinct, named structure (boundary at
  exactly **3× body**, CandleScanner) and is never emitted.

### E.8 The "none" bucket is structural, not residual — and it is the majority of bars
The five rules cover only `body/range < 0.35` (umbrella shapes, doji, spinning top) and
`body/range > 0.85` (marubozu). The band **`0.35 ≤ body/range ≤ 0.85`** has **no rule at all** — that
is 50 percentage points of the 0–1 body/range space, and it is where ordinary trending bars live.
Those bars are exactly the classical **long white/black candle (long day, yang/yin line)**, the
**ordinary candle**, and the **short day** — patterns #21–#24. Adding the plain-candle tiers plus the
marubozu/belt-hold split closes the bucket; nothing else will, because no amount of tuning the five
existing thresholds reaches that band.

### E.9 `is_white` tie convention is unspecified
`c == o` with `range > 0` is common on low-priced US names. TA-Lib's `TA_CANDLECOLOR` resolves ties as
**white** (`inClose >= inOpen ? 1 : -1`). Pick that explicitly, or the signed labels
(marubozu, belt hold, long day) will be non-deterministic across refactors.

### E.10 The column implies a forecast the geometry does not support
Given §C.14 — hanging man measured as *bullish* continuation 59%, inverted hammer as *bearish*
continuation 65%, spinning top / high wave / both plain doji at 50–51% — a CANDLE column whose values
read as buy/sell calls will mislead. **Recommendation:** the column names the **structure**; any
bullish/bearish rendering (color, sort key, screening preset) should come from a separate,
explicitly-labeled bias field that carries the `intrinsic` vs `context-dependent` distinction from
§B, so a `hanging-man` is never rendered with the same confidence as a `bullish-belt-hold`.

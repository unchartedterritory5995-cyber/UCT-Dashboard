# Mark Minervini — VCP, Power Play, Trend Template, 3-C / Cheat, SEPA

Research file 03 of the multi-bar / base-structure corpus. Scope is **multi-bar base structures only**;
single-, two- and three-bar candle formations are out of scope and are not covered here.

## Sources actually fetched

**PRIMARY — Minervini's own book, full text read**

1. Mark Minervini, *Think & Trade Like a Champion: The Secrets, Rules & Blunt Truths of a Stock Market Wizard*
   (Access Publishing Group, LLC, 2017) — full PDF fetched and text-extracted from
   `https://moecapital.com/fx/Think%20&%20Trade%20Like%20a%20Champion_%20-%20Mark%20Minervini.pdf`
   (218 PDF pages). **Every quote below marked `[TTLAC]` is verbatim from this text.**
   Relevant material: Section 6 "How and When to Buy Stocks — Part 1" (The Trend Template; Volatility
   Contraction Pattern; The Contraction Count; The Technical Footprint; The VCP Footprint at Work;
   Overhead Supply; What Does VCP Tell Us?; The Pivot Point; Volume at the Pivot) and Section 7
   "How and When to Buy Stocks — Part 2" (base-depth guidance; The 3-C Pattern; The "Cheat" Explained;
   The "Low Cheat"; The "Dream Pattern"; The Double Bottom; The Power Play).
   *Page-number caveat:* the scanned PDF's page indices do not match the printed book's page numbers, and
   the book's own index reports inconsistent offsets. I therefore cite **section + heading name** plus the
   PDF page of the copy I read, never a fabricated printed page number. Where the book's own index gives a
   printed range (e.g. "Trend Template, 118–120"; "the power play, 164–167"), I reproduce it as the index states.
   *Transcription caveat:* the PDF's text layer renders em-dashes and curly quotes as replacement characters;
   I have restored them as `—` / `'` / `"` and changed nothing else. Wording, numbers and order are untouched.

**PRIMARY — Minervini's own site**

2. `https://www.minervini.com/` — product site (Minervini Private Access, Master Trader Program, Markets 360).
   Contains **no** published pattern criteria. There is no public blog/article archive on the domain;
   `https://www.minervini.com/blog` returns 404.

**PRIMARY-adjacent — quote account**

3. `https://x.com/MinerviniQuote/status/1878502780802904321` (surfaced via search, not directly fetched;
   quoted only for the five SEPA elements, and flagged as such).

**SECONDARY (fetched; used only where explicitly labelled)**

4. `https://profitvisionlab.com/en/sepa-e02-vcp` — "VCP — The Volatility Contraction Pattern"
5. `https://profitvisionlab.com/en/sepa-e05-handle-cheat` — "The 3-C Entry System: Handle, Cheat, and Low Cheat"
6. `https://profitvisionlab.com/en/sepa-m05-power-play-en/` — "Power Play: Tight Consolidation and Re-Entry After Doubling in 8 Weeks"
7. `https://deepvue.com/screener/volatility-contraction-pattern/`
8. `https://deepvue.com/screener/how-mark-minervini-screens-for-stocks/`
9. `https://www.finermarketpoints.com/post/vcp-criteria-complete-checklist`
10. `https://www.finermarketpoints.com/post/what-is-mark-minervini-s-trading-strategy-the-complete-sepa-vcp-guide`
11. `https://tradingmomentum.substack.com/p/the-volatility-contraction-pattern-b57`
12. `https://the7circles.uk/mark-minervini-1-specific-entry-point-analysis-sepa/` — summary of *Trade Like a Stock Market Wizard* (2013)
13. `https://vdoc.pub/documents/trade-like-a-stock-market-wizard-how-to-achieve-super-performance-in-stocks-in-any-market-634b4qgndfv0` — preview of the 2013 book; **only chapters 1–4 are exposed**, which stop before the VCP / pivot / Power Play chapters
14. `https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns/cup-with-handle.md` — StockCharts ChartSchool restatement of O'Neil's cup-with-handle (used for the `conflicts` sections)
15. `https://en.wikipedia.org/wiki/Cup_and_handle`
16. `https://tintintrading.substack.com/p/the-power-play-setup` — high tight flag
17. `https://tradingengineered.substack.com/p/the-powerplay-setup`

**Attempted and FAILED (recorded so the gaps are auditable)**

- `traderlion.com/technical-analysis/volatility-contraction-pattern/` — HTTP 403
- `chartmill.com/documentation/.../464-` and `/465-` (Minervini Strategy Parts 1 & 2) — HTTP 403
- `medium.com/@tradingdirty/learning-from-the-master-mr-mark-minervini-...` — HTTP 403
- `investors.com` (IBD) — blocked at the fetch layer, so **no primary IBD page could be read**
- `archive.org` search / `ia-fts.archive.org` / `api.archivelab.org` — DNS or connection refused
- `lilys.ai` transcript notes — JS-rendered, no text returned
- `dokumen.pub` — "website under maintenance"
- **`Trade Like a Stock Market Wizard` (2013) full text — NOT obtained.** Every rule below that lives only in
  the 2013 book is therefore marked `value: null` or `confidence: low`, never guessed.

**Search budget note:** the session's WebSearch quota (200 calls) was exhausted partway through; the last
several sources were reached by direct WebFetch on URLs already surfaced. 14 distinct searches were issued
before the cap.

---

## The Trend Template

- **origin / source_name**: Mark Minervini. `[TTLAC]` Section 6, heading "THE TREND TEMPLATE" / "TREND TEMPLATE
  CRITERIA" (book index: "Trend Template, 118–120"; PDF pp. 104–106). Minervini calls it his qualifier:
  "My Trend Template outlines the criteria I apply to every stock I'm considering. It's my qualifier, or what
  I refer to as 'non-negotiable criteria.' Any stock that fails to make the cut is off my radar."

- **definition**: An eight-condition screen that must be **fully** satisfied before any chart pattern is even
  looked at. `[TTLAC]` "The following are the eight criteria a stock must meet to be considered in a confirmed
  a Stage 2 uptrend" and "A stock must meet all eight criteria to be deemed in a confirmed Stage 2 uptrend."
  It is a gate on the *trend*, not on the base; VCP analysis begins only after it passes — `[TTLAC]` "Once I
  determine a stock is in a confirmed Stage 2 uptrend—it meets all eight of my Trend Template criteria—I look
  at the current chart pattern."

- **criteria**:
  - price above both 150-day and 200-day MA — both, simultaneously — "Stock price is above both the 150-day (30-week) and the 200-day (40-week) moving average price lines." — high
  - 150-day MA above 200-day MA — strict inequality — "The 150-day moving average is above the 200-day moving average." — high
  - 200-day MA slope positive — minimum 1 month; preferred 4–5 months or longer — "The 200-day moving average line is trending up for at least 1-month (preferably 4 to 5 months or longer)." — high
  - 50-day MA above both 150-day and 200-day MA — strict inequality — "The 50-day (10-week moving average) is above both the 150-day and the 200-day moving averages." — high
  - price above 52-week low — **at least 25 percent** — "The current stock price is at least 25 percent above its 52-week low. (Many of the best selections will be 100 percent, 300 percent, or more above their 52-week low before they emerge from a healthy consolidation period and mount a large-scale advance)." — high
  - price near 52-week high — **within at least 25 percent** — "The current stock price is within at least 25 percent of its 52-week high (the closer to a new high the better)." — high
  - relative strength rank floor — **RS ≥ 70**, preferred 90s — "The relative strength (RS) ranking (as reported in Investor's Business Daily) is no less than 70, but preferably in the 90s, which will generally be the case with the better selections." — high
  - RS *line* direction — uptrend for **at least 6 weeks, preferably 13 weeks or more**; must not be in a strong downtrend — "(Note: The RS line should not be in a strong downtrend. I like to see the RS line in an uptrend for at least 6 weeks, preferably 13 weeks or more.)" — high
  - price above 50-day MA at the point of emergence — no percentage given — "Current price is trading above the 50-day moving average as the stock is coming out of a base." — high
  - volume confirmation on the Stage 1→2 transition — value: null — "As the stock transitions from Stage 1 to Stage 2, you should see a meaningful pickup in volume—a sign of institutional support." — high (assertion), but **missing: what multiple of what averaging window constitutes a "meaningful pickup"** — the book publishes no number here.

- **conflicting edition value — 52-week-low floor**: the widely circulated version of the Trend Template
  (attributed to the 2013 book *Trade Like a Stock Market Wizard*) states the floor as **30 percent** above the
  52-week low, not 25 percent. I could not obtain the 2013 text, so:
  `condition: price above 52-week low (2013 edition) — value: null (30 percent asserted by third parties, no verbatim quote obtained) — confidence: low — missing: the verbatim sentence from Trade Like a Stock Market Wizard (2013).`
  **Record both. Do not reconcile.** The 2017 verbatim value is 25 percent.

- **measured_performance**: **none published.** No hit rate, no forward return, no sample. The book supplies
  illustrative single-name outcomes only (JBLU "soared 350 percent"; VRX "fell a whopping 92 percent" after
  closing below its 200-day) — anecdotes, not a measured population. **No base rate is given anywhere**, so
  the template's screening value cannot be evaluated from the source.

- **invalidation**: any one of the eight conditions failing. The book's worked counter-example is GoPro:
  `[TTLAC]` "True, GoPro's stock price was above its own 200-day (40-week) moving average, but it did not meet
  all the Trend Template criteria: the 150-day line was below the 200-day, and both were trending down."

- **detection_notes**: fully computable from daily OHLCV **except** RS.
  Primitives: SMA(close, 50), SMA(close, 150), SMA(close, 200); rolling 252-session max/min of close (or of
  high/low — the book does not say which, so pick one and document it); slope of SMA200 over a ≥21-session
  window (the book says "trending up for at least 1-month", which is a *direction over a window*, not a
  scalar slope threshold — implement as `SMA200[t] > SMA200[t-21]` and record the choice).
  **NOT computable from a single symbol's daily OHLCV:** the IBD Relative Strength rank (1–99) is a
  *cross-sectional percentile against a universe* and requires a full universe of price histories plus IBD's
  undisclosed weighting; a self-computed percentile is an approximation, not the published number. The RS
  *line* (stock ÷ index) needs an index series. Flag both explicitly.
  Also note: criterion 6 uses "within at least 25 percent of its 52-week high" — this is a *distance-below-high*
  test, `close >= 0.75 * high_252`, and is not the same as the criterion-5 low test.

- **conflicts**: none of the numbers above have a competing O'Neil/IBD figure for the *same named rule* — the
  Trend Template is Minervini's own construct. The nearest neighbour is IBD's own RS Rating ≥ 80–90 house
  preference, which I could not source (investors.com unreachable) and therefore do not record a value for.

---

## Volatility Contraction Pattern (VCP)

- **origin / source_name**: Mark Minervini. `[TTLAC]` Section 6, headings "VOLATILITY CONTRACTION PATTERN",
  "THE CONTRACTION COUNT", "OVERHEAD SUPPLY", "WHAT DOES VCP TELL US?" (book index: "volatility contraction
  pattern (VCP), 123–124"; "successive contractions, 125–126"; PDF pp. 109–116). Minervini states authorship:
  "I came up with the VCP concept because I saw so many people relying on patterns that seemed to trace the
  general appearance of a constructive price base, but they missed some of the most important elements of the
  structure, which can make it invalid and prone to failure."

- **definition**: Not a shape but a *property* imposed on whatever base shape is present — volatility must
  contract left-to-right, with volume receding at specific points.
  `[TTLAC]` "The most common characteristic shared by constructive price structures (stocks that are under
  accumulation) is a contraction of volatility accompanied by specific areas in the base where volume recedes
  noticeably." And: "In virtually all the chart patterns I rely on, I'm looking for volatility to contract from
  left to right. I want to see the stock move from greater volatility on the left side of the price base to
  lesser volatility on the right side."
  Critically, it is a **continuation** pattern inside an existing advance: `[TTLAC]` "the VCP is going to happen
  at higher levels, after the stock has already moved up 30, 40, 50 percent or even much more, because the VCP
  is a continuation pattern as part of a much larger upward move."

- **criteria**:
  - number of contractions (outer bound) — **2 to 6** — "During a VCP, you will generally see a sequence of anywhere from two to six price contractions." — high
  - number of contractions (typical) — **2 to 4**, occasionally 5 or 6 — "Typically, most VCP setups will be formed by two to four contractions, although sometimes there can be as many as five or six." — high
  - contraction halving ratio — **each successive contraction ≈ half the previous, "plus or minus a reasonable amount"** — "As a rule of thumb, each successive contraction is generally contained to about half (plus or minus a reasonable amount) of the previous pullback or contraction." — high. **Note the tolerance is explicitly unquantified**; `missing: a numeric band for "plus or minus a reasonable amount"` — the book does not publish one, so any implementation's tolerance (e.g. 0.35×–0.75×) is the implementer's invention, not Minervini's.
  - worked contraction sequence (illustrative, not a rule) — **25% → 15% → 8%** — "For example, a stock will initially come off by, say, 25 percent from its absolute high to its low. Then the stock rallies a bit, and then sells off 15 percent. At that point buyers come back in, and the price rallies a bit more within the base. Finally, it retreats by 8 percent." — high (as an example; it is prefaced "For example", so it is not a threshold)
  - contraction naming — each contraction is a "T" — "I refer to each of these contractions as a 'T.'" — high
  - volume must fall with the contractions — no percentage — "with each contraction in a VCP, the price of the stock gets 'tighter'—meaning, it corrects less and less from left to right on successively lower volume as the supply diminishes." — high. value: null. `missing: a stated volume ratio and averaging window for "successively lower volume".`
  - tight closes as a constructive marker — no numeric tightness threshold — "Tightness in price from absolute highs to lows and tight closes with little change in price from one day to the next and from one week to the next are generally constructive. These tight areas should be accompanied by a significant decrease in trading volume." — high. value: null. `missing: what daily/weekly close-to-close change counts as "little change", and what percentage drop counts as a "significant decrease" in volume.`
  - minimum base duration — **value: null** — the VCP section publishes **no** minimum. The book's worked examples run 6 weeks (MELI), 8 weeks (BITA), 19 weeks (MIK), 27 weeks (NFLX) and 40 weeks (VIVO). — `missing: an explicit minimum number of weeks for a VCP base.` (The 3-C section *does* publish a 3-week floor — see that entry — but it is stated for the 3-C, not for the VCP generally.) — high confidence that the number is absent
  - maximum base depth (normal conditions) — **10% to 35%, some as much as 40%** — "Most constructive setups correct between 10 percent and 35 percent, some as much as 40 percent. Very deep correction patterns, however, are failure prone." — high (Section 7 opening; PDF p. 119)
  - maximum base depth (bear-market conditions) — **as much as 50%, but he rarely buys it** — "During major bear market corrections, some stocks can decline by as much as 50 percent and still work. But I rarely buy a stock that is down that much." — high
  - hard depth cutoff — **60% or more is disqualifying** — "A stock that has corrected 60 percent or more is off my radar, especially because a decline of that magnitude often signals a serious problem." — high
  - depth relative to the general market — **more than 2.5× to 3× the index decline is disqualifying** — "Under most conditions, stocks that correct more than two and a half or three times the decline of the general market should be avoided." — high

- **measured_performance**: **none published.** The book gives per-name outcomes after the fact
  (BITA "skyrocketed 465 percent in just 10 months"; VIVO "gained 118 percent in 15 months"; NFLX "525 percent
  in 21 months"; MELI "shot up 75 percent in just 13 days") but **no win rate, no failure rate, no sample size,
  no period, and no base rate**. These are selected illustrations of successful trades, so they carry survivorship
  selection by construction and must not be read as performance. One near-statistic does appear and is recorded
  under *invalidation* below; it too has no sample.

- **invalidation**:
  - Right side never quiets down: `[TTLAC]` "If the stock's price and volume don't quiet down on the right side of the consolidation, supply most likely is still coming to market, making the trade too risky and prone to failure."
  - Post-breakout close below the 20-day MA — Minervini's only quasi-measured claim, **with no sample published**: `[TTLAC]` "But my studies have shown that, after a stock breaks out of a proper VCP, if it closes below its 20-day moving average shortly thereafter, the probability of it being successful before stopping you out is cut in about half." **This is a relative claim with no absolute base rate**: he never publishes the unconditional success probability, so "cut in about half" cannot be converted into a number. Treat as an assertion, not a measurement.
  - Three lower lows on increasing volume after a breakout: `[TTLAC]` "Three lower lows on increased volume is a red flag" and "every consecutive lower low after the third becomes more and more ominous, and even much more so if volume is high."
  - Depth breaches above (60%+, or >2.5–3× the market's decline).
  - **Not** invalidating: a pullback to the breakout level. `[TTLAC]` "Often, a stock will emerge through a buy point and then pull back to or slightly below the initial breakout level; this will happen 40 to 50 percent of the time." (A frequency claim, again with no stated sample.) Likewise a "squat" (breakout day closing back inside the range) is given up to ~10 days to stage a "reversal recovery": `[TTLAC]` "In some cases, it can take up to 10 days for a recovery to occur."

- **detection_notes**: computable from daily OHLCV alone, *given* a swing-detection choice the source does not make.
  Required primitives:
  - **Pivot highs / pivot lows with explicit left/right bar counts.** The book never specifies a fractal width;
    contraction boundaries are described visually ("from its absolute high to its low"). The left/right window is
    the implementer's parameter and must be documented as such — it is the single largest source of
    non-reproducibility in any VCP detector.
  - **Successive swing-range comparison:** for contraction *i*, `depth_i = (swing_high_i - swing_low_i) / swing_high_i`.
    Assert `depth_{i+1} < depth_i` for all i, and score the halving with `depth_{i+1} / depth_i ≈ 0.5` — but see the
    unquantified-tolerance flag above.
  - **T-count** = number of qualifying contractions; gate on `2 <= T <= 6`.
  - **Base depth** = `(base_high - base_low) / base_high` over the whole consolidation; gate 0.10–0.40 normal,
    reject ≥ 0.60.
  - **Relative-to-market depth:** requires an index series (SPX/NDX) over the same window to compute
    `stock_drawdown / index_drawdown > 2.5` — **not computable from the stock's own bars alone.**
  - **Volume:** rolling mean of volume over 50 sessions; per-contraction mean volume; monotone-decrease test
    across contractions. Windows are the implementer's choice — the book states none for the contractions
    (it does state 50-day for the pivot; see next entry).
  - **Weekly resampling** is needed for the "tight closes … from one week to the next" test and for the
    week-count footprint (`nW`).
  - **Prior advance:** the VCP is a continuation pattern, so require a preceding advance; the book's phrasing
    ("already moved up 30, 40, 50 percent or even much more") is illustrative and publishes no threshold —
    `missing: a minimum prior-advance percentage for a VCP.`
  - ATR is **not** used by Minervini for the VCP; his "volatility" is swing-range contraction, not ATR
    contraction. An ATR-ratio implementation is a substitution, not the published rule — flag it if used.
  - **Not computable from daily OHLCV:** the Trend Template gate that precedes the VCP (RS rank), and the
    "institutions are accumulating" interpretation.

- **conflicts**: on base *depth*, Minervini's published 10–35% (up to 40%, 50% in bear markets, hard stop at 60%)
  is looser than the cup-with-handle depth restated for O'Neil by StockCharts ChartSchool: "Ideally, the depth of
  the cup should retrace 1/3 or less of the previous advance. However, the retracement could range from 1/3 to
  1/2 with volatile markets and over-reactions." Note the two are **not even the same measurement**: O'Neil's is a
  *retracement of the prior advance*, Minervini's is a *drawdown from the base high*. Record both; do not average.
  Wikipedia's cup-and-handle entry gives yet a third framing ("the cup lasts from 1 to 6 months, while the handle
  should only last for 1 to 4 weeks") and does **not** attribute those figures to O'Neil.
  IBD's commonly cited house numbers (7-week minimum base, 12–33% depth, handle 8–12%) could **not** be sourced —
  investors.com is unreachable from this environment — so they are recorded here as `value: null, confidence: low`
  rather than asserted.

---

## The Technical Footprint (VCP notation)

- **origin / source_name**: Mark Minervini. `[TTLAC]` Section 6, heading "THE TECHNICAL FOOTPRINT" and
  "THE VCP FOOTPRINT AT WORK" (book index: "technical footprints, 126–127"; PDF pp. 111–113, 117–118).

- **definition**: A three-part shorthand that encodes a base without looking at the chart.
  `[TTLAC]` "The immediate distinguishing features of the VCP will be the number of contractions that are formed
  throughout the base, their relative depths, and the level of trading volume associated with specific points
  within the structure."

- **criteria**:
  - component 1 — Time — "Time. The number of days or weeks that have passed since the base started." — high
  - component 2 — Price — "Price. The depth of the largest correction and narrowness of the smallest contraction at the very right of the price base." — high
  - component 3 — Symmetry — "Symmetry. The number of contractions throughout the entire basing process." — high
  - notation form `<n>W <first>/<last> <k>T` — worked example **6W 32/6 3T** — "Figure 6-10 shows Mercadolibre (MELI) and its technical footprint of 6W 32/6 3T, meaning that the basing period occurred over six weeks, with corrections that began at 32 percent and concluded at 6 percent at the pivot." — high
  - second worked example **19W 16/3 4T**, with the full depth sequence — "The technical footprint of 19W 16/3 4T indicated a 19-week base with successively tighter pullbacks of 16 percent, 8 percent, 6 percent, and then 3 percent." — high
  - third worked example — **3T over 27W** — "Netflix contracted three times (a 3T) before it emerged out of its 27-week (27W) consolidation." — high
  - fourth worked example — **4T over 40W**, depths 31/17/8/3 — "Meridian Bioscience contracted four times (4T) before it emerged out of its 40-week (40W) consolidation and advanced more than 100 percent over the next 15 months." plus, from the same passage, "correcting 31 percent from high to low", "a 17 percent pullback", "a much tighter price range of about 8 percent", and "a short and narrow pullback of just 3 percent over two weeks on very low volume formed the pivot buy point." — high
  - fifth worked example — 8-week base, depths 28/16/6 — "The consolidation period lasted eight weeks, correcting 28 percent, then 16 percent, and finally just 6 percent on the far right." — high

- **measured_performance**: none published. The footprint is a *description* format, not a strategy; the book
  offers no distribution of footprints over any sample.

- **invalidation**: n/a — a footprint cannot be invalid, only a base can. Note however that the published examples
  do **not** all obey the halving rule: 16→8→6→3 (MIK) halves, then does not (8→6 is 0.75×), then over-halves
  (6→3). 31→17→8→3 (VIVO) is 0.55×, 0.47×, 0.38×. 28→16→6 (BITA) is 0.57×, 0.38×. So the ratio observed across
  his own five published examples spans roughly **0.38× to 0.75×**, which is the only empirical basis in the
  source for the unquantified "plus or minus a reasonable amount". This is *derived from his examples*, not stated
  by him — do not present it as a published tolerance.

- **detection_notes**: the footprint is trivially emitted once the VCP primitives above exist:
  `weeks = ceil(base_bars / 5)` (or count weekly bars after resampling), `first = depth_1 * 100`,
  `last = depth_k * 100`, `T = k`. It is the right shape for a screener column and for regression fixtures,
  because it collapses a base into three integers that a human can eyeball against a chart.

- **conflicts**: none — no other authority publishes this notation.

---

## The Pivot Point (and Volume at the Pivot)

- **origin / source_name**: Mark Minervini. `[TTLAC]` Section 6, headings "THE PIVOT POINT" and
  "VOLUME AT THE PIVOT" (PDF pp. 116–118). Minervini credits the underlying idea to Livermore's
  "line of least resistance": `[TTLAC]` "This is what the legendary trader Jesse Livermore called
  'the line of least resistance.'"

- **definition**: `[TTLAC]` "A pivot point is a 'call-to-action' price level. I often refer to it as the optimal
  buy point. A pivot point can occur in connection with a stock breaking into new high territory or below the
  stock's high. A proper pivot point represents the completion of a stock's consolidation and the cusp of its
  next advance." The pivot is formed by the **final (tightest) contraction**, on the right side of the base:
  `[TTLAC]` "This is what you want to see before you initiate your purchase on the right side of the base, which
  forms what we call the pivot buy point."

- **criteria**:
  - trigger — price moves **above** the pivot (the high of the final contraction) on expanding volume — "Specifically, the point at which you want to buy is when the stock moves above the pivot point on expanding volume." — high
  - **maximum distance above the pivot for an entry** — **value: null** — "You want to buy as close to the pivot point as possible without chasing the stock up more than a few percentage points." — high confidence in the quote, **but the number is not published.** `missing: a numeric ceiling for "a few percentage points".` Third-party implementations (ProfitVision LAB: "Opens more than 5% above the Pivot → don't chase"; finermarketpoints: no threshold given at all) assert 5%, but **no source I fetched supplies a Minervini quote containing that number.** Record as null, not 5.
  - **breakout volume expansion percentage** — **value: null** — the 2017 book contains **no** percentage anywhere for breakout volume. Exhaustive regex over the full text found only three volume-and-percent sentences, none of which is a breakout threshold. The strongest wording published is "on expanding volume" and, for a worked example, "cracked above the pivot buy point at $17 a share on a noticeable increase in volume". — high confidence the number is absent. `missing: a stated multiple/percentage of a stated averaging window for breakout volume.` **Third parties uniformly assert 40–50% above average (deepvue, finermarketpoints, ProfitVision LAB "at least 1.4–1.5× the 50-day average"), and every one of them presents it without a quotation or a page citation.** Do not adopt it as Minervini's published number.
  - volume dry-up at the pivot — **below the 50-day average, with one or two extremely low days** — "In fact, we want to see volume on the final contraction that is below the 50-day average, with one or two days when volume is extremely low; in some of the smaller issues, volume will dry up to a trickle." — high. This is the **one** volume rule in the book with a named window.
  - volume dry-up (stronger form) — near the lowest in the whole base — "In addition, there will be at least one day when volume contracts very significantly, in many cases to almost nothing or near the lowest volume level in the entire base structure." — high
  - volume dry-up (relative to the whole advance) — "In some instances, volume dries up at or near the lowest levels established since the beginning of the stock's advance." — high
  - post-breakout confirmation — multiple follow-through days on increased volume — "The best trades emerge and rally for several days on increased volume. This is how you differentiate institutional buying from retail buying." — high; value: null, `missing: how many days counts as "several".`

- **measured_performance**: **none published with a sample.** The book asserts "Rarely does a correct pivot point
  fail coming out of a sound consolidation in a healthy market." — that is a claim with **no rate and no base
  rate**, and it is circular as stated (a "correct" pivot is partly defined by its behaviour). The 40–50%
  pullback-to-breakout-level frequency quoted above is the closest thing to a statistic in the section and it too
  has no stated sample or period.

- **invalidation**: a "squat" — `[TTLAC]` "Sometimes a stock will break out through a pivot point only to fall back
  into its range and close off the day's high—and then, squat." Not an automatic exit; up to ~10 days are allowed
  for a "reversal recovery". Fatal combination: `[TTLAC]` "When you combine these two scenarios soon after a
  breakout—a close below the 20-day moving average and a third lower low without supportive action, or worse,
  higher volume with a bad close—that trade has slim chances of success."
  Also fatal to the *setup* (before entry): volume and price failing to quiet on the right side.

- **detection_notes**: from daily OHLCV.
  - `pivot = max(high)` over the final contraction window (pivot-high detection again requires a left/right bar
    parameter; and note Minervini's pivot may be **below** the 52-week high — "A pivot point can occur … below the
    stock's high" — so a naive "breakout to new 52-week high" detector is **not** the same rule).
  - dry-up test: `mean(volume over final contraction) < SMA(volume, 50)` **and**
    `min(volume over final contraction) <= <extremely low>` — the second half needs a threshold the book does not
    publish; the auditable choice is a percentile of the base's own volume (e.g. the base minimum), because the
    book anchors it to "near the lowest volume level in the entire base structure" rather than to an absolute.
  - breakout test: `close > pivot` (or `high > pivot`) with `volume > SMA(volume, 50)` — **the expansion multiple
    is a free parameter with no published anchor.** Any rail that hard-codes 1.4× is encoding a third party's
    number, and should say so in a comment.
  - entry-distance test: `(entry_price - pivot) / pivot <= X` where **X is not published**. Emit it as a
    configurable with an explicit "not sourced" marker rather than a silent 0.05.
  - follow-through: count of consecutive/near-consecutive up days with volume above its 50-day mean in the N days
    after the breakout; N is unpublished.
  - post-breakout violation rails: `close < SMA(close, 20)` within a short window after the breakout;
    3+ consecutive lower lows with rising volume.
  - All computable from daily OHLCV. Nothing here needs intraday, fundamentals, or a universe — **except** that
    the pivot only counts if the Trend Template gate passed, which needs RS.

- **conflicts**: on the breakout-volume figure, O'Neil/IBD is usually cited as "at least 40% above average", but
  the only O'Neil-attributed source I could fetch (StockCharts ChartSchool) publishes **no number**: "There should
  be a substantial increase in volume on the breakout above the handle's resistance." So both authorities, as
  sourced here, publish qualitative volume language and no threshold. The "40%" figure circulating for both men
  is, on this evidence, **unsourced in both directions.** Record: Minervini = null; O'Neil (ChartSchool) = null;
  third-party consensus = 40–50%, unattributed.

---

## The 3-C Pattern (Cup Completion Cheat) and the "Cheat" entry

- **origin / source_name**: Mark Minervini. `[TTLAC]` Section 7, headings "THE 3-C PATTERN" and
  "THE 'CHEAT' EXPLAINED" (book index: "3-C pattern, 154–155"; "explained, 156–158"; PDF pp. 132–135).
  Naming: `[TTLAC]` "The cup completion cheat, or 3-C, is a continuation pattern. It's called a 'cheat' because
  at one time I considered it to be an earlier entry than the optimal buy point, so I would say 'I'm cheating.'
  Today, I would say that it is the earliest point at which you should attempt to buy any stock."

- **definition**: An early pivot formed *inside* a cup, before the handle/breakout. `[TTLAC]` "The cheat setup has
  the same qualifications as the classic cup with handle, because it's simply the cup portion being completed."
  Once price clears the pause high, the stock has "made the turn": `[TTLAC]` "Once the stock trades above the high
  of the pause or pivot point, it has made what I call the turn."

- **criteria**:
  - prior advance required — **at least 25 to 100 percent, sometimes 200 or 300 percent, over the previous 3 to 36 months** — "To qualify, the stock should have already moved up by at least 25 to 100 percent—and in some cases by 200 or 300 percent—during the previous 3 to 36 months of trading." — high
  - trend gate — above a rising 200-day MA — "The stock also should be trading above its upwardly trending 200-day moving average (provided that 200 days of trading in the stock has occurred)." — high
  - pattern duration — **3 weeks minimum to 45 weeks maximum; most 7 to 25 weeks** — "The pattern can form in as few as 3 weeks to as many as 45 weeks (most are 7 to 25 weeks in duration)." — high. **This is the only explicit minimum base duration Minervini publishes anywhere in this book.**
  - pattern depth — **15 or 20 percent to 35 or 40 percent, as much as 50 percent depending on market conditions** — "The correction from peak to low point varies from 15 or 20 percent to 35 or 40 percent in some cases, and as much as 50 percent, depending on the general market conditions." — high
  - depth disqualifier — **in excess of 60 percent** — "Corrections in excess of 60 percent are usually too deep and are extremely prone to failure." — high
  - cheat plateau depth — **contained within 5 percent to 10 percent, high to low** — "The stock will pause over a number of days or weeks and form a plateau area (the cheat), which should be contained within 5 percent to 10 percent from high point to low point." — high
  - right-side rally before the pause — **recouping about one-third to one-half of the prior decline** — "The price will start to run up the right side, usually recouping about one-third to one-half its previous decline." — high
  - preferred shakeout — plateau drifting below a prior low — "The optimum situation is to have the cheat drift down to where the price drops below a prior low point, creating a shakeout—exactly what you'd want to see during the formation of a handle in a cup-with-handle pattern." — high
  - volume/price at the cheat — dry-up and tightness, no number — "A typical sign that indicates that the stock is ready to break out is when volume dries up dramatically, accompanied by tightness in price." and "A valid cheat area should exhibit a contraction in volume and tightness in price." — high; value: null, `missing: a volume ratio and window for "dries up dramatically".`
  - entry — above the high of the plateau — "As the stock rallies above the high of the plateau area, you place your buy order." — high
  - where the handle normally forms (for contrast) — **upper third of the cup** — "When a handle forms, it usually occurs in the upper third of the cup. If it forms in the middle third or just below the halfway point, you could get more than one buy point." — high

- **the four steps (verbatim structure)**: `[TTLAC]` "Following are the four steps to a stock turning up through
  the cheat area": **1. Downtrend** ("an intermediate-term price correction that takes place within the context of
  a longer-term Stage 2 uptrend"), **2. Uptrend** ("The price will attempt to rally and break its downtrend. You do
  not want to buy just yet."), **3. Pause** (the plateau, 5–10%), **4. Breakout** (above the plateau high).
  Note the book's own numbered list labels step 2 "Uptrend"; the widely repeated third-party rendering of these
  four steps as "downtrend / pause / breakout / …" mislabels them.

- **measured_performance**: **none published.** Per-name illustrations only: AMZN "rose 1,700 percent in 16 months"
  and "shot up 240 percent in just 12 months" from a 22-week base; CRUS "+162 percent in four months"; JBLU
  "advanced 130 percent in 11 months"; MAXY "shot up 100 percent in just 14 days"; HUM "advanced 1,000 percent in
  38 months". No sample, no failure rate, **no base rate** — these are selected winners.

- **invalidation**: depth in excess of 60%; plateau wider than 5–10%; volume not contracting in the pause;
  buying at step 2 rather than step 4 ("You do not want to buy just yet. It's too early because the price and
  volume lack the necessary confirmation that the stock has bottomed and entered a new uptrend."). Structures with
  no pause at all are called out as failure-prone in the double-bottom passage: `[TTLAC]` "Structures that run
  straight up off the lows with no cheat or handle are more prone to failure."

- **detection_notes**: from daily OHLCV.
  - Locate the cup: base high (left rim), base low, and the current right-side rally.
  - **Vertical zoning** is the core primitive: `zone = (price - base_low) / (base_high - base_low)`;
    low cheat = lower third, cheat = middle third, handle = upper third. (The zoning is stated qualitatively in
    the book — "The low cheat forms in the lower third of the base"; "When a handle forms, it usually occurs in
    the upper third of the cup" — the exact thirds boundaries are a reasonable literal reading.)
  - Right-side retracement test: `(rally_high - base_low) / (base_high - base_low)` in [1/3, 1/2].
  - Plateau detection: a run of N bars whose `(max(high) - min(low)) / max(high) <= 0.10`, with a preference for
    `<= 0.05`; N is unpublished ("a number of days or weeks").
  - Shakeout test: plateau low undercuts a prior swing low within the base.
  - Prior-advance test: `close / min(close over previous 3–36 months) - 1 >= 0.25` — note the window is
    **3 to 36 months**, which is unusually wide and will admit almost anything; it is a weak filter as published.
  - Duration: 15 to 225 trading sessions (3 to 45 weeks); typical 35 to 125.
  - All computable from daily OHLCV. The Stage-2 gate on top of it is not (RS).

- **conflicts**: Minervini's cheat is explicitly a *modification* of O'Neil's cup-with-handle, so the two disagree
  on **where entry is permitted**: O'Neil/IBD buys the handle breakout at the top of the cup; Minervini permits an
  entry in the middle third and even the lower third of the same structure. On handle geometry, the O'Neil-attributed
  restatement (StockCharts ChartSchool) says the handle "can retrace up to 1/3 of the cup's advance, but usually not
  more" and "is ideally completed within one to four weeks"; Minervini's *cheat* plateau is 5–10% of price high-to-low
  over "days or weeks", which is a different measurement basis (percent of price vs. fraction of the cup's advance).
  Record both. On cup duration: O'Neil/ChartSchool "one to six months"; Minervini 3 to 45 weeks, most 7 to 25 weeks.
  Do not average.

---

## The "Low Cheat"

- **origin / source_name**: Mark Minervini. `[TTLAC]` Section 7, heading "THE 'LOW CHEAT'"
  (book index: "low cheats, 158–160"; PDF pp. 135–137).

- **definition**: `[TTLAC]` "The low cheat forms in the lower third of the base. It's riskier to buy in the lower
  third of the base than in the middle third (the classic cheat area) or the upper third (from the handle). But if
  you get it right, the profit potential is even greater because you're getting in at a lower price."

- **criteria**:
  - location — **lower third of the base** — "The low cheat forms in the lower third of the base." — high
  - intended universe — larger caps and recent IPOs — "I like to use the low cheat for larger cap names, and in some cases new issues that recently went public." — high; value: null, `missing: a market-cap floor.` (ProfitVision LAB asserts ">$10B"; that number is theirs, not Minervini's.)
  - IPO condition — must not spend much time below the IPO price — "The low cheat can work for IPOs that don't spend much time trading below their IPO price and don't correct too excessively. It's best if the stock holds above the IPO price." — high; value: null on "much time" and "too excessively"
  - **minimum post-IPO basing period — at least 10 days** — "The basing period after the IPO should be at least 10 days." — high
  - worked example durations — **14 days (GOOG), 19 days (TWTR)** — "the stock corrected and formed a low cheat over in 14 days" and "The Twitter base formed in 19 days." — high (examples, not thresholds)
  - confirmation — inside days on very low volume — "Before I buy, I also like to see some inside days on very low volume, another sign that supply coming to market has slowed to a trickle and the line of least resistance is forming." — high
  - position sizing — scale in, do not commit fully — "I will often start a position at a low cheat and then add as it forms additional pivot points at progressively higher prices. This is how you can scale into a name and lower your average cost." — high; value: null on the fractions. (ProfitVision LAB's "≤20% at the low cheat, ~50% at the cheat, full at the handle" is **their** allocation ladder, not a published Minervini number.)

- **measured_performance**: **none published.** GOOG "soared 625 percent in 40 months" and TWTR "ran up 77 percent
  in just 16 days" are single illustrations. No sample, no base rate.

- **invalidation**: heavy overhead supply above the entry — `[TTLAC]` "As with any base, you want to avoid buying
  into heavy overhead supply and a steep ladder of trapped buyers." For the AAPL example he notes the clean
  invalidation: "If the stock had continued lower, it would become obvious that something was wrong, providing a
  very clear-cut exit point."

- **detection_notes**: same zoning primitive as the 3-C (`zone < 1/3`), plus:
  - **inside-day detection**: `high[t] < high[t-1] and low[t] > low[t-1]`, combined with `volume[t] < SMA(volume, 50)`.
    This is a multi-bar structural test and is in scope here (it is a base-completion marker, not a candlestick
    pattern read for its own sake).
  - **gap-fill low cheat** (the AAPL 2004 case): detect an up-gap on volume far above its 50-day mean, then a
    return into the gap on volume below its 50-day mean.
  - **IPO age**: requires a listing date — **not derivable from an OHLCV series alone unless the series itself
    begins at the IPO.** Flag it. The "holds above the IPO price" test needs the first-day price, which is
    available if the series starts at listing.
  - Duration floor of 10 sessions is directly computable.

- **conflicts**: this entry has no O'Neil counterpart — IBD does not sanction an entry in the lower third of a base.
  That absence is itself the conflict: the same cup structure yields **one** IBD buy point and **up to three**
  Minervini buy points. Record both positions; do not reconcile.

---

## The Power Play (a.k.a. the High Tight Flag)

- **origin / source_name**: Mark Minervini. `[TTLAC]` Section 7, heading "THE POWER PLAY"
  (book index: "the power play, 164–167"; PDF pp. 139–141). Minervini names the equivalence himself:
  `[TTLAC]` "Rounding out our discussion here is the power play, also referred to as the high tight flag."
  He classes it as a velocity pattern: `[TTLAC]` "The power play is what I call a velocity pattern for two
  reasons. First, it takes a great deal of momentum to qualify as a power play; in fact, the first requirement is
  a sharp price thrust upward. Second, these setups can move up fast in the shortest time…"

- **definition**: an explosive thrust followed by a shallow, tight sideways consolidation. Notably, it is the one
  setup Minervini will take **without fundamentals**: `[TTLAC]` "Therefore, this is the type of situation I will
  enter even with a dearth of fundamentals." But not without VCP behaviour: `[TTLAC]` "Although I don't demand that
  a power play have fundamentals on the table, I do require the same VCP characteristics that I do with all the
  other setups. Even the power play must go through a proper digestion of supply and demand."

- **criteria**:
  - **prior advance** — **100 percent or more within eight weeks**, on huge volume — "An explosive price move on huge volume that propels the stock price up 100 percent or more within eight weeks." — high
  - stage condition on the thrust — must not come off a late-stage base — "Stocks that have already made a huge gain coming off a late-stage base usually don't qualify. The best power plays are stocks that were quiet in Stage 1 and then suddenly explode." — high
  - **consolidation depth** — **not more than 20 percent; some lower-priced stocks as much as 25 percent** — "Following the explosive move, the stock price moves sideways in a relatively tight range, not correcting more than 20 percent (some lower-priced stocks can correct as much as 25 percent) over a period of three to six weeks (some can emerge after only 10 or 12 days)." — high
  - **consolidation duration** — **three to six weeks; some emerge after only 10 or 12 days** — same sentence as above — high
  - tight weekly closes — **over three to six weeks** — "With a power play, you should look for tight weekly closes over three to six weeks." — high; value: null on how tight, `missing: a numeric weekly close-to-close range.`
  - **the 10-percent VCP waiver** — **if the base's high-to-low correction does not exceed 10 percent, no volatility contraction is required** — "If the correction in the base, from high to low, does not exceed 10 percent, it is not necessary to see price tightening in the form of a volatility contraction, because the price is already tight enough." — high. **Important scoping finding: in this book the 10% waiver is published as the third bullet of the Power Play criteria list — not as a general VCP rule.** Applying it to every base is an extension beyond the source. Whether the 2013 book states it more broadly is unverified (that text could not be obtained).
  - "huge volume" on the thrust — value: null — "An explosive price move on huge volume…" — high confidence in the quote, `missing: a volume multiple and window for "huge".`

- **measured_performance**: **none published.** One illustration: PCYC, bought 2010-02-04, "Over the next 48
  trading days, Pharmacyclics advanced 90 percent, during which time the Nasdaq rallied only about 18 percent"
  and "the stock advanced 2,600 percent in 43 months." That is n=1 with a benchmark for that single trade — it is
  **not** a win rate and carries no base rate. Third-party statistics circulating for the high tight flag
  (tintintrading.substack.com: "307 patterns analyzed; only 5 failed to climb 10%", "82% reaching price target",
  "Average rise (bull market): 69%", "Average rise (bear market): 42%", "Throwback rate: 67%") are presented on
  that page **with no attribution**; they match the profile of Thomas Bulkowski's chart-pattern encyclopedia
  statistics, but I could not confirm that, and they are **not Minervini's numbers**. Do not attach them to the
  Power Play entry as if he published them.

- **invalidation**: correction beyond 20% (25% for lower-priced names); consolidation running past six weeks
  without resolving; and, from the ProfitVision LAB secondary (labelled as secondary): "Volume expands (not dries
  up) during consolidation" and "Closes sink to lower half of range". The book itself supplies the depth and
  duration bounds and the general VCP requirement; it does not enumerate a separate failure list for this setup.

- **detection_notes**: from daily and weekly OHLCV.
  - **Thrust:** `max over t of (close[t] / close[t-40] - 1) >= 1.00` using 40 trading sessions ≈ 8 weeks.
    Decide and document whether the 100% is measured close-to-close, low-to-high, or base-low-to-thrust-high —
    the book says "propels the stock price up 100 percent or more within eight weeks" and does not specify.
  - **Consolidation:** the window from the thrust high forward; `depth = (thrust_high - consol_low) / thrust_high`;
    gate `depth <= 0.20` (or `<= 0.25` for low-priced names — **"lower-priced" is undefined in the source**;
    `missing: a price threshold for "lower-priced stocks"`).
  - **Duration:** 15 to 30 sessions typical; floor of 10 sessions ("10 or 12 days").
  - **Tight weekly closes:** requires **weekly resampling**; compute weekly close-to-close percent change over the
    consolidation and require it to be small — threshold unpublished.
  - **The 10% waiver** is a clean, computable branch: `if depth <= 0.10: skip the contraction-sequence test.`
    This is one of the few places where the source hands you an exact, unambiguous, implementable number.
  - **Stage-1 quiescence** before the thrust: measure realised range or volume in the 6–12 months prior and
    require it to be low relative to the thrust — the book says "quiet in Stage 1" and publishes no threshold.
  - Volume on the thrust: `volume / SMA(volume, 50)` at the thrust — multiple unpublished.
  - All computable from daily OHLCV. The "major news development such as an FDA drug approval, litigation
    resolution, a new product or service announcement, or even an earnings report" catalyst is **not** computable
    from bars — and Minervini explicitly says it is optional here ("it can also occur on no news at all").

- **conflicts**: this is the sharpest Minervini-vs-O'Neil disagreement in the file, because it is the **same pattern
  under two names** with different published tolerances.
  - **Minervini (verbatim, 2017)**: prior advance **100%+ within 8 weeks**; consolidation **≤20%** (≤25% for
    lower-priced), **3 to 6 weeks** (as short as 10–12 days).
  - **O'Neil / IBD**: the classic published figures are usually given as **100–120% in 4 to 8 weeks** with a flag
    correcting **no more than 10–25% over 3 to 5 weeks**. **I could not fetch a primary IBD/O'Neil source**
    (investors.com is blocked from this environment; ChartSchool has no high-tight-flag page). Therefore:
    `O'Neil prior advance — value: null — confidence: low — missing: a fetchable O'Neil/IBD page or book quote.`
  - **Third-party (tintintrading, unattributed)**: "The stock has made an advance of +100% in between 20 - 40 days.
    The stock then corrects less than 20% in between 5-25 days." Note this is a *day* window (20–40 days ≈ 4–8
    weeks) versus Minervini's *within eight weeks*, and a 5–25 day flag versus his 10 days–6 weeks.
  - Record all three. **Do not average, and do not present the third-party day-counts as either man's rule.**

---

## SEPA — Specific Entry Point Analysis

- **origin / source_name**: Mark Minervini. Primary definition `[TTLAC]` Section 1, heading "MODEL SUCCESS"
  (book index: "Specific Entry Point Analysis (SEPA®), 8"; PDF p. 11). The full exposition is in
  *Trade Like a Stock Market Wizard* (McGraw-Hill, 2013), which Minervini names in `[TTLAC]`: "In my first book,
  Trade Like a Stock Market Wizard (McGraw-Hill, 2013), I provided a foundation for those interested in learning
  my SEPA® trading strategy." **That 2013 text could not be obtained** (see Sources).

- **definition**: `[TTLAC]` "my Specific Entry Point Analysis (SEPA®) strategy is predicated on a Leadership
  Profile® for identifying promising stock candidates. Using historical data from as far back as the late 1800s,
  SEPA® develops a blueprint of the characteristics shared by superperformance stocks. It is based on an ongoing
  effort to identify the qualities and attributes of the most successful stocks of the past to determine what
  makes a stock likely to dramatically outperform its peers in the future."

- **criteria**:
  - the five key elements — **1) Trend 2) Fundamentals 3) Catalyst 4) Entry Points 5) Exit Points** — "The Five Key Elements of SEPA are: 1) Trend 2) Fundamentals 3) Catalyst 4) Entry Points 5) Exit Points." — **med** (this quote comes from the @MinerviniQuote X account, a fan quote-aggregator, not from a Minervini-controlled channel I fetched; the same five elements are independently listed by the7circles.uk summary of the 2013 book. Neither is a primary fetch of the book.)
  - study period — **"as far back as the late 1800s"** — quoted above — high (verbatim from the 2017 book)
  - study sample size — **value: null** — `missing: how many superperformance stocks the Leadership Profile was built from, and over what exact date range.` The source names a start era and nothing else.
  - screen survivorship — **95 percent of trending stocks fail the filters** — value: null for a verbatim Minervini quote; the7circles.uk states "95% of trending stocks will fail the filters" as its own paraphrase of the 2013 book — low
  - proportion of big winners emerging after bear markets/corrections — **more than 90 percent** — value: null for a verbatim quote; the7circles.uk reports "More than 90% of big winners began surges after bear markets/corrections" as a paraphrase of the 2013 book — low. `missing: the verbatim sentence and the sample.` (Note this is directionally consistent with the 2017 book's un-numbered statement: "Market leaders often emerge from consolidations around the time the general market is coming off a bear market or correction low.")
  - age of big winners — **less than 10 years public** — `[TTLAC]` has a compatible but differently worded and un-numbered version: "Most big winners are companies that just went public within 8 or 10 years." — high for the 8-or-10 phrasing; the flat "less than 10 years" is the7circles' paraphrase — med

- **measured_performance**: Minervini's *account* performance is published, not the *method's* hit rate.
  `[TTLAC]` (author bio): "averaging 220 percent per year for more than five consecutive years with only one
  losing quarter—an incredible 33,500 percent total return" and, for the 1997 U.S. Investing Championship,
  "a 155 percent annual return". Schwager is quoted in the same bio: "Most traders and money managers would be
  delighted to have Minervini's worst year—a 128 percent gain—as their best."
  **These are account returns for one trader over one stated period (five-plus consecutive years, and 1997).
  They are not a pattern win rate, they carry no trade count, and no benchmark base rate is given alongside them
  beyond the championship comparison.** They must not be used as the expected performance of any pattern in this file.
  Elsewhere the book gives an explicit *low* expectation for entry accuracy: `[TTLAC]` "On average, over time you
  will likely be correct on only 50 percent of your purchases." — a stated hit rate of ~50% with no sample, which
  directly contradicts the way third parties market these setups.

- **invalidation**: n/a (a framework, not a pattern).

- **detection_notes**: only element 1 (Trend) and element 4 (Entry Points) are computable from daily OHLCV.
  Element 2 (Fundamentals — earnings, sales, margin acceleration) needs a fundamentals feed. Element 3 (Catalyst)
  needs news/corporate-action data. Element 5 (Exit Points) is a position-management rule set, not a detector.
  **Any "SEPA screener" built on bars alone implements at most two of the five elements** — say so in the UI.

- **conflicts**: SEPA vs. O'Neil's CAN SLIM is the natural comparison, but they are different frameworks rather
  than competing values for one named quantity, so there is no both-values-recorded conflict here.

---

## "Footprints" of institutional accumulation

- **origin / source_name**: Mark Minervini, `[TTLAC]`, distributed across Section 1 ("LOOK FOR FOLLOW-THROUGH
  BUYING", "HOLD TENNIS BALLS AND SELL EGGS"; PDF pp. 29–30, 34) and Section 6 (VCP / Overhead Supply /
  Volume at the Pivot; PDF pp. 109–118). **Terminology caution:** in this book "technical footprint" means the
  *VCP notation* (see that entry), not institutional traces. The institutional-accumulation evidence is described
  in ordinary language, and the corpus term "footprints" should not be read as a Minervini-coined label for it.

- **definition**: the observable, bar-level residue of large buyers absorbing supply. `[TTLAC]` "A price
  consolidation represents a period of equilibrium. As strong investors replace weak traders, supply is absorbed.
  Once the 'weak hands' have been eliminated, the lack of supply allows the stock to move higher because even a
  small amount of demand will overwhelm the negligible inventory." And, as an assertion of near-universality:
  `[TTLAC]` "A stock that is under accumulation will almost always show these characteristics (price tightness
  with contacting volume)." (`contacting` is the book's typo for `contracting`; quoted as printed.)

- **criteria**:
  - contracting volatility + receding volume in the base — value: null — "The most common characteristic shared by constructive price structures (stocks that are under accumulation) is a contraction of volatility accompanied by specific areas in the base where volume recedes noticeably." — high; `missing: a threshold for "recedes noticeably".`
  - price tightness with contracting volume — value: null — "Tightness in price from absolute highs to lows and tight closes with little change in price from one day to the next and from one week to the next are generally constructive. These tight areas should be accompanied by a significant decrease in trading volume." — high; `missing: numeric definitions of "tight closes" and "significant decrease".`
  - multi-day follow-through after the breakout — value: null ("several days") — "The best trades emerge and rally for several days on increased volume. This is how you differentiate institutional buying from retail buying. If big institutions are in there accumulating a position, it will likely happen over a number of days with persistent buying." — high
  - "tennis ball" recovery after the first pullbacks — **two to five days, or one to two weeks** — "Tennis ball action will generally occur after two to five days or even one to two weeks of pullback, followed by the stock bouncing back up again, taking out the most recent highs." — high
  - volume behaviour through that pullback — contract down, expand into new highs — "Volume should contract during the pullback and then expand as the stock moves back into new highs." — high; value: null on the magnitudes
  - the "MVP" / "ants" signature — **up 12 out of 15 days; volume +25% or more over the 15-day period; price +20% or more over the 15 days** — "Momentum. The stock is up 12 out of 15 days. Volume. The volume increases 25 percent or more during the 15-day period. Price. The stock price is up 20 percent or more during the 15 days (the larger the move and the stronger the volume during these 15 days, the better)." — high. **Attribution: this is David Ryan's indicator, reported by Minervini, not Minervini's own.** `[TTLAC]` "David originally called the setup 'ants.' … refer to it as the 'MVP indicator,' which stands for momentum, volume, and price." This is the **most precisely specified institutional-footprint test in the entire book** and the only one with three hard numbers.
  - Stage 1→2 transition volume — value: null — "you should see a meaningful pickup in volume—a sign of institutional support." — high

- **measured_performance**: **none published** for any of these. The MVP criteria are stated as characteristics
  that "separated" continuing winners "from the rest" — `[TTLAC]` "Stocks that continued much higher had the
  following characteristics that separated them from the rest" — but **no sample, no period, and no base rate**
  (i.e. no statement of how often stocks that were *not* big winners also printed 12-of-15 up days). Without that
  denominator the MVP signature's discriminating power is unknown.

- **invalidation**: `[TTLAC]` "Low volume out, high volume in is a big warning" (heading), plus the violation set —
  close below the 20-day MA soon after a breakout, three or more lower lows on increasing volume, and:
  "A stock may not be down 15 or 20 percent on large volume. Maybe it's down only 4 or 5 percent, but the volume
  is the largest since the beginning of a big move." — i.e. distribution can be shallow in price and still fatal.

- **detection_notes**: all computable from daily OHLCV.
  - MVP: `sum(close[t] > close[t-1] over last 15) >= 12`; `sum(volume last 15) / sum(volume previous 15) - 1 >= 0.25`
    (**the book does not say what the 25% is measured against** — prior 15 days? the 50-day mean? — so document the
    choice); `close[t]/close[t-15] - 1 >= 0.20`.
  - Tennis-ball: after a breakout, find the first pullback low; require a new high within 2–10 sessions of that low.
  - Follow-through: consecutive up-closes with `volume > SMA(volume, 50)` in the days after the pivot breakout.
  - Distribution warning: `close down 4–5% or more on volume == max(volume) since the advance began` —
    needs an "advance start" anchor, which is itself the base-detection problem.
  - Nothing here requires intraday, order-flow, or fundamentals. **But note that none of it actually observes
    institutions** — every one of these is an inference from price and volume, and the source presents them as
    such. Do not label the output "institutional accumulation confirmed."

- **conflicts**: O'Neil/IBD's equivalent is the accumulation/distribution rating and up/down volume ratio, for
  which I could not fetch a primary source (investors.com blocked). No competing value is recorded.

---

## Cross-cutting notes for implementers

**What the source actually publishes as hard numbers** (usable as gates): the eight Trend Template conditions;
2–6 / 2–4 contractions; the ~half halving rule (with unquantified tolerance); base depth 10–35/40%, 50% bear,
60% reject, 2.5–3× market; pivot volume below the 50-day average; 3-C 3–45 weeks (most 7–25), depth 15/20–35/40%
(to 50%), cheat plateau 5–10%, right-side retrace 1/3–1/2, prior advance 25–100% over 3–36 months; low cheat
≥10-day post-IPO base; Power Play 100%/8 weeks, ≤20% (25%), 3–6 weeks (min 10–12 days), and the 10% waiver;
MVP 12/15 days, +25% volume, +20% price; 50/80 rule; 20-day-line and three-lower-lows violations;
40–50% of breakouts pull back to the breakout level; risk 1.25–2.5% of equity per trade; 4–12 positions.

**What the source does NOT publish, and where third parties silently supply a number** — every one of these must
be marked as unsourced in code and in any UI copy:
1. **Breakout volume expansion percentage.** Minervini: "expanding volume", no number. Third parties: 40–50% /
   1.4–1.5× the 50-day. **No fetched source produced a quote.**
2. **Maximum distance above the pivot for an entry.** Minervini: "more than a few percentage points". Third
   parties: 5%.
3. **Minimum VCP base duration.** Minervini publishes a 3-week floor only for the *3-C*, not for VCPs generally.
   Third parties: "3 weeks" and "under 3 weeks hasn't absorbed enough supply", stated as a VCP rule.
4. **The halving tolerance.** "plus or minus a reasonable amount" — his own five worked examples span ~0.38×–0.75×.
5. **Volume dry-up magnitude during contractions** (only the *pivot* has the 50-day-average anchor).
6. **"Lower-priced stocks"** in the Power Play 25% allowance.
7. **Market-cap floor** for the low cheat.

**Base-rate warning to carry forward:** across every pattern in this file, Minervini publishes **zero** win rates,
failure rates, or sample sizes for any setup. The only frequencies he states are the 40–50% pullback-to-breakout
figure, the 50/80 rule, and "you will likely be correct on only 50 percent of your purchases" — all without samples,
and the last of which is a *pessimistic* number that sits awkwardly beside third-party marketing of these setups.
Any win rate attached to VCP, Power Play, 3-C or the Trend Template elsewhere in this corpus comes from someone
other than Minervini and must be labelled with its own source and its own base rate.

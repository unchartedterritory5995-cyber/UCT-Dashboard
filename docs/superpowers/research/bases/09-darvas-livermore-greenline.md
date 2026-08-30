# The All-Time-High / Box School — Darvas, Livermore, Green Line Breakout

Research file 09 of the multi-bar / base-structure corpus. Single-candlestick and 1–3 bar candle
formations are out of scope and covered elsewhere; Livermore's "One-Day Reversal" is therefore
recorded here only as an *invalidation* signal, not as a concept in its own right.

## Sources actually fetched

**Primary (full book text obtained and read directly):**

1. Nicolas Darvas — *How I Made $2,000,000 in the Stock Market* (1960; this scan includes the
   reader-question appendix carried in the later editions).
   `http://www.r-5.org/files/books/trading/investment/Nicolas_Darvas-How_I_Made_$2_Million_in_the_Stock_Market-EN.pdf`
2. Jesse Livermore — *How to Trade in Stocks* (1940 original, Duell, Sloan and Pearce).
   `http://www.r-5.org/files/books/trading/speculation/Jesse_Livermore-How_To_Trade_In_Stocks_(1940_original)-EN.pdf`
3. Richard Smitten — *Trade Like Jesse Livermore* (Wiley, 2005), 237pp.
   `http://www.r-5.org/files/books/trading/speculation/Richard_Smitten-Trade_Like_Jesse_Livermore-EN.pdf`
4. Edwin Lefèvre — *Reminiscences of a Stock Operator* (1923).
   `http://www.r-5.org/files/books/trading/speculation/Edwin_LeFevre-Reminiscences_of_a_Stock_Operator-EN.pdf`

**Secondary (fetched web pages):**

5. Eric Wish — "Green line breakout (GLB) explained; GMI remains Green", Wishing Wealth Blog, 2018-05.
   `https://wishingwealthblog.com/2018/05/green-line-breakout-glb-explained-gmi-remains-green/`
6. Thomas Bulkowski — "Bulkowski on the Darvas Box Technique". `https://thepatternsite.com/Darvas.html`
7. ShareScope — "Tutorial: Darvas Boxes". `https://www.sharescope.co.uk/sharescope_tutorial33.jsp`
8. Heather Cullen — "Darvas Boxes". `https://heathercullen.com/darvas-boxes/`
9. Richard Moglen — "The Green Line Breakout Strategy", Trading Engineered.
   `https://tradingengineered.substack.com/p/the-green-line-breakout-strategy`
10. GreatStockMark — "Green Line Breakout (GLB)" indicator description, TradingView.
    `https://www.tradingview.com/script/d6hg0wPr-Green-Line-Breakout-GLB/`

**Attempted and failed:** archive.org copies of the Darvas book (lending-gated, OCR search text 403);
`dokumen.pub` (site under maintenance); TraderLion GLB article (403); O'Reilly excerpt of
*Trade Like an O'Neil Disciple* "Pivotal Points versus Pivot Points" (403). The last one matters —
the O'Neil-side conflict entries below are therefore reasoned from the primary texts I did read,
not from a fetched O'Neil source.

**OCR caveat.** The Darvas scan renders vulgar fractions unreliably: `⅛` appears variously as
`y8`, `%`, or `½`. Wherever a criterion's number depends on a fraction I have marked it
`value: null` rather than guess, and quoted the OCR artifact verbatim so a later reader can check
the physical page.

---

## Three findings that reset the premises of this file

1. **"Reversal Pivotal Point" and "Continuation Pivotal Point" do not appear in Livermore's book
   at all.** The 1940 original contains 49 instances of "Pivotal Point" and **zero** instances of
   either compound term. Both are Richard Smitten's 2005 coinages. Livermore's own Pivotal Point is
   a *different concept*: round numbers and brand-new highs.
2. **"The line of least resistance" is also absent from Livermore's own book** (zero matches for
   "resistance" in the 1940 text). It is Lefèvre's phrase, spoken by the fictionalised narrator
   "Larry Livingston" in *Reminiscences* (1923).
3. **The Market Key numbers ARE Livermore's own words, not Smitten's reconstruction** — the inverse
   of what one would assume. Smitten states his Chapter 11 "is exactly as it was written in the 1940
   version," and I verified the six-point and three-point rules independently in the 1940 original.

---

## The Box (the "Darvas Box")

- **origin / source_name**: Nicolas Darvas, *How I Made $2,000,000 in the Stock Market* (1960),
  Ch. 4 "Developing the Box Theory" for the concept; the **operational three-day rule comes from the
  reader-question appendix**, not from the narrative. This distinction is load-bearing: in the
  narrative body Darvas explicitly disclaims a fixed rule — *"I did not find any fixed rule as to how
  this takes place. It just has to be observed and instantly acted upon."* The precise day count
  exists only because readers wrote in and forced him to formalise it. Both are Darvas's own words;
  they are simply from different parts of the book and they are in tension.
- **definition**: A price frame bounded by a high and a low within which a stock oscillates.
  *"Within this trend stocks moved in a series of frames, or what I began to call 'boxes'. They would
  oscillate fairly consistently between a low and a high point. The area which enclosed this
  up-and-down movement represented the box or frame."* Darvas required the stock to actually move
  inside the frame: *"if it did not bounce up and down inside that box I was worried. No bouncing, no
  movement, meant it was not a lively stock."*
- **criteria**:
  - Box top confirmation — 3 consecutive days — *"The top of a box is established when the stock does not touch or penetrate a previously set new high for three consecutive days. This is true — in reverse — for the bottom of the box."* — confidence: high
  - Box top is the extreme of the advance, not an arbitrary level — value: n/a — *"The upper limit of its new box will be the highest price that will be reached during this advance and which will not be touched or penetrated during three consecutive days."* — confidence: high
  - Box bottom may NOT be established until the top is set — ordering constraint — *"Equally important: the lower limit of the new box cannot be established until the upper limit is firmly set. The method of establishing it is the exact reverse of how you establish the upper limit."* — confidence: high
  - Top and bottom cannot be set on the same bar, but may be set within the same day — value: n/a — *"Simultaneously, it cannot. But on the same day, or even in the same hour, it can. It is an exceptionally rare case."* — confidence: high
  - The three-day rule governs box *construction* only, never entry timing — value: n/a — *"The three consecutive days rule does not apply in all instances. It only applies to establish the lower and upper limit of the boxes."* — confidence: high
  - Typical box height, narrow stocks — ~10% each way — *"some stocks moved in a very small frame, perhaps not more than 10% each way"* — confidence: med (Darvas presents this as observation, not as a filter)
  - Typical box height, wide stocks — 15% to 20% — *"Other wide-swinging stocks moved in a frame between 15% and 20%."* — confidence: med (same caveat)
  - Box violated by any trade below the lower frame — value: n/a — *"Take a stock which was within the |45/50| box... If, however, it fell to 44½, I eliminated it as a possibility."* (OCR shows `44 /2`) — confidence: high
  - Duration in a box is unbounded — value: null — *"I found that a stock sometimes stayed for weeks in one box. I did not care how long it stayed in its box as long as it did and did not fall below the lower frame figure."* — missing: Darvas publishes no minimum or maximum box length, so a screener must choose its own dwell bounds and cannot claim they are Darvas's. — confidence: high
- **measured_performance**: **None published by Darvas.** The only evidence in the primary source is
  one trader's anecdotal account of his own account equity — *"a series of purchases that were to net
  $2,000,000 in eighteen months"* — with no trade count, no win rate, no benchmark, and no
  independent audit. Darvas himself sets the expectation at a coin flip: *"There is no sure thing in
  the market — I was bound to be wrong half of the time."* He also publishes his own losing
  sequences (Allegheny Ludlum, Dresser, Cooper-Bessemer netting $2,442.36, then North American
  Aviation wiping all of it out).
  *Independent measurement* comes only from Bulkowski, whose implementation differs from Darvas's
  (see conflicts): 49% win rate, 10.5% average gain per trade, 13.7% average drawdown, **262 trades**,
  297-day average hold, ETFs on weekly data with a 52-week lookback, **2001-03-12 to 2010-10-01**,
  against a benchmark in which *"the S&P 500 lost 0.7%"* over the test period. That benchmark is what
  makes the 49%/10.5% figures interpretable; note that a 49% win rate is *below* a coin flip and the
  edge is carried entirely by gain asymmetry, not by hit rate.
- **invalidation**: A decisive trade below the box bottom. *"The task was to define the frame exactly
  and be sure the stock did not move decisively below the lower edge of the box. If it did, I sold it
  at once, because it was not acting right."* Note "decisively" is undefined by Darvas, while the
  |45/50| example shows him voiding the box on a single half-point violation to 44½ — the text is
  internally inconsistent on strictness. A *pending* box top is also invalidated by any touch: the
  three-day count resets if the stock *"touch[es] or penetrate[s]"* the high.
- **detection_notes**: Requires a **stateful machine across bars**, not a per-bar predicate. Primitives:
  - a running extreme-high tracker; a counter of consecutive bars whose `high` is `< pending_top`
    (note: *touch* invalidates, so the comparison is strict `<`, not `<=`);
  - a state enum `SEEKING_TOP → TOP_SET → SEEKING_BOTTOM → BOX_CONFIRMED`, with the ordering
    constraint that `SEEKING_BOTTOM` cannot start before `TOP_SET`;
  - a symmetric consecutive-bar counter on `low > pending_bottom` for the floor;
  - reset-on-touch semantics for both counters.
  - **Intraday-dependent**: Darvas's own rules are expressed on the daily *high* and *low*, not the
    close, and his answers show he considered same-hour resolution. The "top and bottom set on the
    same day" case is **not computable from daily OHLCV** — with one daily bar you cannot order the
    high before the low. Treat it as the rare case Darvas said it was and skip it.
  - The 10% / 15–20% box heights are descriptive, so implement them as a *reported statistic* of the
    detected box, never as a gate.

- **conflicts**:
  - **Darvas (narrative) vs Darvas (appendix)** — the same author, on the same page-set. Narrative:
    *"I did not find any fixed rule as to how this takes place."* Appendix: a hard three-consecutive-day
    rule. Every mechanical Darvas implementation in existence is built on the appendix and silently
    discards the narrative disclaimer. Record both.
  - **Darvas vs Bulkowski on the breakout trigger** — Darvas triggers on any intraday penetration
    (see the Buy-Stop entry). Bulkowski uses the close and says so: Darvas used *"a higher high above
    the top of the box or a lower low below the bottom of the box as a trigger,"* whereas Bulkowski
    found *"waiting for a close works better."* These are different systems and their statistics are
    not interchangeable.
  - **Darvas vs O'Neil on what a valid consolidation at highs is** — Darvas imposes **no minimum base
    length** (a box can be four days old) and no maximum depth. O'Neil/IBD bases carry a stated
    minimum duration in weeks and a maximum depth. A Darvas box will therefore fire on structures
    O'Neil would reject as too short and too shallow to have shaken anyone out. See the O'Neil file
    in this corpus for those numbers; I did not fetch an O'Neil primary source here and will not
    restate his figures from memory.

---

## The Box-Within-a-Box / Pyramid Progression

- **origin / source_name**: Nicolas Darvas, same book, Ch. 4. Darvas's own words. Widely reported as
  "stacked boxes"; Darvas's own term is a pyramid.
- **definition**: Boxes standing on one another, with the tradable stock resident in the topmost.
  *"When the boxes of a stock in which I was interested stood, like a pyramid, on top of each other,
  and my stock was in the highest box, I started to watch it."* Worked example in his own text:
  `50 52 57 58 60 55 52 56` → *"That meant it was in the |52/60| box."* then
  `58 61 66 70 66 63 66` → *"This meant it was well inside the |63/70| box."*
- **criteria**:
  - Stock must occupy the highest box of the stack — value: n/a — *"my stock was in the highest box"* — confidence: high
  - A drop into a lower box disqualifies — value: n/a — *"anything below 45 meant it was falling back into a lower box and this was all wrong — I wanted it only if it was moving into a higher box."* — confidence: high
  - New box bottom is NOT the old box top — explicit denial of the intuitive rule — *"The bottom of a new box is not necessarily the top of the old box and can only be established by the stock itself and not by prediction."* — confidence: high
  - Boxes may overlap / a pullback into the prior box's range is normal — value: null — *"Profit-taking in a firmly rising stock usually drops the price to the lower half of its new box and not back into its old lower one."* — missing: "usually" carries no frequency; Darvas never publishes how often a pullback into the old box is tolerable versus fatal. — confidence: med
  - Number of stacked boxes required before acting — value: null — missing: Darvas never states a minimum count of prior boxes; "like a pyramid" is qualitative. A screener must pick its own N and label it as its own choice. — confidence: high (that the number is absent)
- **measured_performance**: none published.
- **invalidation**: *"When to sell then? Why, when the boxes started to go into reverse! When the
  pyramids started to tumble downwards, that was the time to close the show and sell out."*
- **detection_notes**: Needs a **persistent ordered list of confirmed boxes**, not a single box.
  Primitives: box history array; a monotonic check that `box[n].top > box[n-1].top` and
  `box[n].bottom > box[n-1].bottom`; a "current box index == last" residency test. The overlap
  tolerance is the un-computable part — with no published threshold, any depth-of-pullback filter is
  the implementer's invention and must be labelled as such.
- **conflicts**: Darvas's *"the bottom of a new box is not necessarily the top of the old box"*
  directly contradicts a very common third-party rendering of the Darvas Box in which each new box
  sits exactly on the previous box's ceiling. The chart-package versions that draw contiguous
  stacked rectangles are drawing something Darvas explicitly disowned. Record both.

---

## The On-Stop Buy Order and the Automatic Stop-Loss

- **origin / source_name**: Nicolas Darvas, same book. Note Darvas credits the *mechanism* to his
  broker, not to himself — *"He told me I should have put in an automatic 'on stop' buy order."*
  The placement rules are Darvas's own, mostly from the appendix answers.
- **definition**: A resting buy-stop a fraction above the box ceiling (or the historic high, when the
  historic high sits above the box ceiling), paired at entry with a resting sell-stop a fraction
  below. *"I decided to give 'on-stop' orders to buy at a certain figure with an automatic 'stop-loss'
  order on them in case the stock went down."*
- **criteria**:
  - Entry fires on penetration, not on the close, and not on a confirmed day-count — value: n/a — *"An order should be placed in such a way that the stock is purchased the moment it pushes (even a fraction) through the top of its box."* — confidence: high
  - No multi-day confirmation of the breakout — value: n/a — *"It is never necessary to wait for the third consecutive day for a stock's breakthrough in order to make a purchase. My purchases were made at the time of the breakthrough."* and *"No three fractional penetrations were necessary."* — confidence: high
  - Buy-stop offset above the historic high — value: null — *"Where the historic high is above a box high, I placed my on-stop purchase order y8 above the historic high and my stop-loss order % below its historic high."* — missing: the offset is a vulgar fraction the OCR destroyed (`y8` / `%`); the physical page is needed. Elsewhere Darvas says only *"a fraction"*. Do not assume ⅛ without the page. — confidence: low (on the number), high (that an offset exists)
  - Initial stop sits just below the breakout ceiling — value: null — *"I placed my stop-losses one fraction below the ceiling through which the stock broke through. I gave instructions to my broker to place this stop-loss order immediately after the purchase of the stock."* — missing: "one fraction" is unquantified. — confidence: high (rule), null (number)
  - A stop is NEVER placed inside a box — value: n/a — *"I have never set a stop-order (either buy or sell) inside a box."* — confidence: high
  - Trailing: move the stop only when the NEXT box is fully formed — value: n/a — *"I have always waited until the top and bottom of the next new box are firmly established. As soon as that happened, I placed my stop-loss orders a fraction below the new bottom."* — confidence: high
  - Re-entry after being stopped out is allowed, at a new all-time high — value: n/a — *"my attitude was to sell out on stop-loss and buy the stock back again on a new all-time high."* — confidence: high
- **measured_performance**: none published as a rate. The one worked example is anecdotal and is a
  *loss*: Lorillard bought on stop at 27½ with a 26 stop, *"On Tuesday, November 26th, the stock
  dropped back exactly to my stop-loss of 26 and I was sold out. To add insult to injury, seconds
  after I was stopped out, it started to rise and closed at 26⅞."* Darvas re-entered at 28¾. He
  accepts the whipsaw cost explicitly: *"I knew that many times I would be 'stopped out' for the sake
  of a point just to see my stock climb up immediately after."* No stop-out frequency is published.
- **invalidation**: the stop-loss firing. Darvas's stated logic is that the breakout was simply wrong.
- **detection_notes**: The entry is an **intraday-penetration** event. On daily OHLCV you can detect
  it (`high > trigger`) but you **cannot know the fill sequence within the bar** — specifically, on a
  bar where `high > buy_trigger` and `low < stop_level`, daily data cannot tell you whether you were
  filled and then stopped, or never filled. Flag every such bar as ambiguous rather than assuming an
  order. Trailing the stop requires the full stateful box machine above, since the trail only moves on
  *box confirmation events*, not on new highs — that is a genuinely different trailing rule from a
  chandelier or an N-bar-low trail and must not be substituted.
- **conflicts**: Darvas's intraday trigger versus Bulkowski's close-based trigger (above). Also
  against O'Neil, whose buy zone is a *band* above the pivot rather than a single stop price — Darvas
  has no concept of a maximum chase distance in the appendix rules, though the narrative shows him
  regretting a 65 fill on a 61 signal (*"I could not wait any longer. I bought 100 shares at 65 at the
  top of its new box because I had missed it at the bottom."*). Record both; do not merge the O'Neil
  band into the Darvas rule.

---

## Darvas's "Techno-Fundamentalist" Screen (the precondition to any box)

- **origin / source_name**: Nicolas Darvas, same book, Part "The Techno-Fundamentalist". Darvas's own
  words. This is the entry-universe filter that runs *before* box logic.
- **definition**: Buy expensive stocks getting more expensive, identified by unusual volume plus price
  strength, with earnings growth as a secondary reason to hold. *"I made up my mind to buy high and
  sell higher."* And on the technical half: *"if I studied price action and volume, discarding all
  other factors, I could get positive results."*
- **criteria**:
  - Volume must break from the stock's own history — no fixed multiple — value: null — *"There is no clear-cut answer to a good, steady volume. It is entirely dependent on the stock's past history."* — missing: a threshold. Darvas refuses to publish one. — confidence: high
  - Illustrative volume expansion — 4,000–5,000 → 20,000–25,000 shares/day (≈4–5×) — *"If, for instance, a stock was traded for a long period of time, 4,000-5,000 shares a day, then suddenly its trading volume swells to 20,000-25,000 shares a day, for that stock the latter volume is good and steady and it is clear proof of a changed behavior."* — confidence: med (Darvas frames it as an example, not a rule)
  - Worked case volume expansion — 126,700 vs ~10,000 weekly (≈12.7×) — *"Its volume for that week was 126,700 shares, which sharply contrasted with its usual 10,000 shares earlier in the year."* (Lorillard, Oct 1957) — confidence: high (as a datum), low (as a generalisable threshold: n=1)
  - The high must be at or near the all-time high, not a shorter-lookback high — value: n/a — *"I strictly adhere to historical high."* (answering a reader who proposed a 5-year high instead) — confidence: high
  - Range screen: year's high at least 2× the year's low — 2.0× — the questioner cites *"you selected stocks in which the high of the year was at least double the low. The remaining stocks were 'chaff' and ignored"* (citing p.149) and Darvas answers the apparent exception without disputing the rule — confidence: med (the quote is the reader's paraphrase of Darvas's page, not Darvas's own sentence in this appendix)
  - Before April, use two years combined — value: n/a — *"When it is only April, I have always gone back to the two years' combined high."* — confidence: high
  - Minimum data required to run the method at all — all-time high; 2–3 years of high/low; 4–6 months of weekly range and volume — *"a. All-time high. b. High and low for the past two or three years. c. Weekly price range and volume for at least the last four to six months."* — confidence: high
- **measured_performance**: none published. No hit rate, no base rate, no sample.
- **invalidation**: Volume contracting back to the historical norm, and price falling out of the box.
  Darvas gives no separate volume-based exit.
- **detection_notes**: Computable from daily OHLCV plus volume. Primitives: running all-time high with
  an **unbounded** lookback (Darvas's "historical high" is genuinely all-time — a 252-day rolling max
  is a *different* screen and will produce different candidates); trailing-median or trailing-mean
  volume over the stock's own prior regime with a ratio; a 52-week (or April-adjusted 2-year)
  high÷low ratio. The "2 years combined before April" rule is a **calendar-dependent** state, which is
  awkward in a pure per-bar predicate and is really an artefact of 1959 newspaper stock tables — flag
  it as historical context, not as a rule worth reimplementing. The earnings half of
  "techno-fundamentalist" is **not computable from OHLCV** and needs a fundamentals join.
- **conflicts**:
  - **Darvas vs the popular Darvas Box indicator** on whether volume is part of the system at all.
    Heather Cullen, writing specifically on Darvas, states volume *"was not part of the theory"* and
    lists volume among what Darvas did NOT use — that is contradicted by Darvas's own text, which
    lists *"1. Price and volume"* first among his four weapons and uses a volume observation to
    initiate the Lorillard trade. The reconcilable reading: volume drives the **watchlist**, never the
    **breakout trigger** — Darvas's on-stop order has no volume condition on it whatsoever. Most
    third-party descriptions wrongly attach a volume confirmation to the breakout. Record both.
  - **Darvas vs O'Neil on lookback**: Darvas requires the *all-time* high ("I strictly adhere to
    historical high"), O'Neil's bases form off 52-week and shorter structures and explicitly permit
    buying below the all-time high. Do not merge.

---

## The Pivotal Point (Livermore's own)

- **origin / source_name**: Jesse Livermore, *How to Trade in Stocks* (1940), Chapter V "The Pivotal
  Point". **Livermore's own words, verified against the 1940 original.** This is NOT the concept most
  modern writing calls a Livermore pivotal point — see the two Smitten entries below.
- **definition**: A price level, arrived at from the record book, at which a fast move
  characteristically begins. Livermore names two concrete generators. **(a) Round numbers**:
  *"Frequently I had observed that when a stock sold at 50, 100, 200 and even 300, a fast and straight
  movement almost invariably occurred after such points were passed."* **(b) A brand-new high after a
  long dormancy**: *"let us say that a new stock has been listed in the last two or three years and
  its high was 20, or any other figure, and that such a price was made two or three years ago. If
  something favorable happens in connection with the company, and the stock starts upward, usually it
  is a safe play to buy the minute it touches a brand-new high."*
- **criteria**:
  - Round-number pivot levels — 50, 100, 200, 300 — *"when a stock sold at 50, 100, 200 and even 300"* — confidence: high (that Livermore names these), low (as a modern rule: pre-split 1920s price levels; Livermore himself notes *"Since those days there have been various splitups in shares of high-priced stocks and, accordingly, opportunities such as those I have just reviewed do not occur so often."*)
  - Dormancy before the new-high pivot — 2 to 3 years — *"its high was 20, or any other figure, and that such a price was made two or three years ago"* — confidence: high
  - Entry on the new-high pivot is immediate, not confirmed — value: n/a — *"buy the minute it touches a brand-new high"* — confidence: high
  - Confirmation of a resumed trend past a pivot — 3 points or more — *"it should sell below its Pivotal Point of 40 by three points or more before it has another rally of importance"* and *"it will continue to advance and reach a price over the Pivotal Point of 49½ — by 3 points or more"* — confidence: high
  - Failed-pierce rally entry — 3 points — *"If it fails to pierce 40 it is an indication to buy as soon as it rallies 3 points from the low price made on that reaction."* — confidence: high
  - Insufficient-pierce entry — buy at 43 in the 40-pivot example — *"If the 40 point has been pierced but not by the proper extent of 3 points, then it should be bought as soon as it advances to 43."* — confidence: high
  - Expected follow-through after a healthy pivot cross — 10 to 15 points — *"there was a very fast advance of at least 10 to 15 points right after the Pivotal Point had been crossed"* — confidence: med — **this is Livermore describing Anaconda's past behaviour at 100 and 200, not stating a rule.** Do not implement as a threshold.
  - Timing of the payoff — last 48 hours — *"It is significant that a large part of a market movement occurs in the last forty-eight hours of a play, and that is the most important time to be in it."* — confidence: high (as a quote), low (as anything measurable)
- **measured_performance**: **None published.** The only support is a handful of narrated single trades
  (Anaconda at 100/200/300; Bethlehem Steel accumulated 99–99⅞ on 1915-04-08, *"the stock sold up to a
  high of 117"*, then 155 by 1915-04-13). These are anecdotes with n=1 each, no failure cases counted,
  and no benchmark. Livermore's own strongest claim is not a rate but an absolute:
  *"WHENEVER I have had the patience to wait for the market to arrive at what I call a 'Pivotal Point'
  before I started to trade, I have always made money in my operations."* — which is unfalsifiable as
  written, since a losing trade can always be reclassified as impatience.
- **invalidation**: Failure to move after the cross. *"Bear in mind when using Pivotal Points in
  anticipating market movements, that if the stock does not perform as it should, after crossing the
  Pivotal Point, this is a danger signal which must be heeded."* Livermore's worked invalidation is
  Anaconda at 300: *"It sold only to 302⅞. Plainly it was flashing the danger signal."*
  Livermore also gives an explicit **base-failure** rule, which is directly relevant to a base
  screener: *"A stock may be brought out at 50, 60 or 70 a share, sell off 20 points or so, and then
  hold between the high and low for a year or two. Then if it ever sells below the previous low, that
  stock is likely to be in for a tremendous drop."*
- **detection_notes**:
  - Round-number pivots: computable, but **point-based and therefore not scale-free**. A "3 point"
    confirmation on a $40 stock is 7.5%; on a $300 stock it is 1%. Livermore never expressed these as
    percentages. Any percentage conversion is the implementer's invention and must be flagged; do not
    silently re-express his points as percents.
  - New-high pivot: running all-time (or listing-to-date) maximum, plus a **dormancy test** — no new
    high for 2–3 years. Stateful: needs `bars_since_last_new_high >= ~504` on daily bars.
  - The 3-point confirmation is a **stateful two-pivot machine**: you must retain the last extreme in
    the prior direction (Livermore's "Pivotal Point of 40") across an arbitrary number of intervening
    bars, then test penetration depth against it.
  - The base-failure rule is computable: a 1–2 year range, then `low < range_low`.
  - "Last forty-eight hours of a play" is **not computable** — it can only be known ex post.
- **conflicts**:
  - **Livermore vs Smitten** on what a pivotal point even is. Livermore: round numbers and brand-new
    highs, with a 3-point tolerance. Smitten: reversal and continuation formations with a 5–10%
    tolerance. These are not the same concept and produce different signals on the same chart. Record
    both separately; never blend them into "Livermore's pivotal point."
  - **Livermore vs O'Neil** on entry timing at a new high. Livermore buys *"the minute it touches a
    brand-new high"* with no volume condition and no consolidation-quality condition. O'Neil requires
    a *formed base* of stated minimum length and a volume surge on the breakout day. Livermore's rule
    will fire on structures O'Neil rejects outright.
  - **Livermore vs Darvas** on round numbers: Darvas's boxes are drawn from actual traded extremes
    and he is emphatic that his round-number examples were pedagogical only — *"For the purpose of
    explaining my box theory, I have used round figures. It made it easier to understand. Of course,
    stocks don't move in round numbers."* Livermore, by contrast, traded the round numbers themselves.
    Direct disagreement.

---

## The Livermore Market Key (six-point / three-point / twelve-point rules)

- **origin / source_name**: Jesse Livermore, *How to Trade in Stocks* (1940), Ch. VIII "The Livermore
  Market Key" and Ch. IX "Explanatory Rules". **These are Livermore's own words.** I verified this two
  ways: directly in the 1940 original, and against Smitten's reprint, where Smitten states
  *"The Livermore Market Key section in this book is exactly as it was written in the 1940 version,
  originally published by Duell, Sloan and Pearce (New York)"* and *"There were no discrepancies —
  this is exactly as Livermore presented his Market Key Theory."* **This is the opposite of the usual
  assumption: the Market Key numbers are original, while the pivotal-point taxonomy is reconstructed.**
- **definition**: A six-column hand-kept price ledger — *"For each stock I use six columns... First
  column is headed Secondary Rally. Second is headed Natural Rally. Third is headed Upward Trend.
  Fourth is headed Downward Trend. Fifth is headed Natural Reaction. Sixth is headed Secondary
  Reaction."* Column transitions are driven purely by point distances from the last recorded extreme,
  and the underlined transition prices become Pivotal Points.
- **criteria**:
  - Natural rally / natural reaction threshold — approximately 6 points — *"I decided a stock selling around $30.00 or higher would have to rally or react from an extreme point to the extent of approximately six points before I could recognize that a Natural Rally or Natural Reaction was in the making."* — confidence: high
  - Price applicability floor — approximately $30 — *"this formula is designed for active stocks selling above an approximate price of 30. While the same basic principles are of course operative in anticipating the market action of all stocks, certain adjustments in the formula must be made in considering the very low-priced issues."* — confidence: high — note Livermore does NOT publish the adjustment for low-priced issues
  - Key Price (two stocks combined) threshold — 12 points — *"The same rules apply when recording the Key Price — except that you use twelve points as a basis instead of six points used in individual stocks."* — confidence: high
  - Key Price worked example — 5⅛ + 7 = 12 — *"at times I record a price in U.S. Steel if it only has had a move, let us say, of 5⅛ points because you will find a corresponding movement in Bethlehem Steel, say, of 7 points. Taken together the price movements of the two stocks constitute the Key Price. This Key Price, then, totals twelve points or better, the proper distance required."* — confidence: high
  - Promotion from Natural Rally to Upward Trend — 3 or more points — *"When recording in the Natural Rally column and a price is reached that is three or more points above the last price recorded in the Natural Rally column... then that price should be entered in black ink in the Upward Trend column."* — confidence: high
  - Trend-resumption confirmation past a Pivotal Point — 3 points individual, 6 points Key Price — *"it will carry through its previous Pivotal Point — in individual stocks by three points or, in the Key Price by six points."* — confidence: high
  - Uptrend-over signal — 3 or more points below the last Pivotal Point — *"If the stock fails to do this and in a reaction sells three points or more below the last Pivotal Point... it would indicate that the Upward Trend in the stock is over."* — confidence: high
  - Danger signal on a failed rally — 3 or more points — *"if the rally ends a short distance below the last Pivotal Point in the Upward Trend column... and the stock reacts three or more points from that price, it is a danger signal, which would indicate the Upward Trend in that stock is over."* — confidence: high — note *"a short distance below"* is **unquantified**
  - Single stock is never sufficient for a trend change — 2 stocks — *"I do not take the action of a single stock as an indication that the trend has been positively changed for that group. Instead I take the combined action of two stocks in any group before I recognize the trend has definitely changed, hence the Key Price."* — confidence: high
  - How the 6 was chosen — value: null — *"First I based my calculations on one point. That was no good. Then two points, and so on, until finally I arrived at a point that represented what I thought should constitute the beginning of a Natural Reaction or Natural Rally."* — missing: Livermore publishes no data from that search, and explicitly disclaims precision: *"It would be presumptuous for me to say I had arrived at the exact point from which my record of prices should start. It would also be misleading and insincere."* — confidence: high
- **measured_performance**: **None published.** Livermore publishes his reproduced worksheets, not a
  result. He also disclaims the system's applicability to anything but major moves: *"I repeat that the
  formula does not provide points whereby you can make additional trades, with assurance, on
  intermediate fluctuations which occur during a major move."* The single narrative "proof" offered is
  the Steel group's 1939–40 divergence — one episode, told after the fact, with no counterfactual.
- **invalidation**: A recorded price crossing back through a Pivotal Point by 3 or more points against
  the trend voids the trend (rules 10b/10d above). The system itself has no stop-loss; it is a state
  machine, not a trade plan.
- **detection_notes**: This is the purest **stateful** construct in the file — a literal six-state
  machine with per-state memory of the last recorded extreme, plus a set of latched "Pivotal Point"
  levels created at transition time. Primitives: six column registers; a last-extreme register per
  column; a transition table keyed on `abs(price - last_extreme) >= 6`; a latch that stamps the
  outgoing column's extreme as a Pivotal Point on every transition; and a second parallel machine over
  a **two-stock sum** with threshold 12. Notes and hazards:
  - Livermore records *"the extreme price made any day"*, i.e. the daily high or low — so daily OHLCV
    suffices, closes do not.
  - **The thresholds are absolute dollar points, not percentages, and were set for a $30+ 1940 market.**
    Applied unchanged to a $600 stock, 6 points is a 1% wiggle and the machine will chatter; applied to
    a $35 stock it is 17%. Livermore's own text anticipates this and refuses to supply the adjustment.
    Any modern percentage-ised version is the implementer's, not Livermore's, and must be labelled so.
  - *"approximately six points"* is deliberately fuzzy — Livermore records a 5⅛-point move when the
    paired stock covers the difference. A strict `>= 6` implementation is **stricter than Livermore**.
  - *"a short distance below"* in rules 10e/10f is unquantified and therefore not computable as written.
  - The Key Price requires a **pair-selection rule** (two leading stocks in a group) that is not
    derivable from OHLCV alone — it needs a sector/industry classification and a leadership ranking.
- **conflicts**: The Market Key's "Pivotal Points" (latched column extremes) and Chapter V's "Pivotal
  Points" (round numbers, new highs) are **two different definitions of the same term inside one book**,
  and Livermore does not reconcile them. Chapter V's own worked example (the 40 / 49½ pivots) is
  actually Market-Key-shaped, which suggests he saw them as one thing — but he never says so. Record
  both definitions; do not assume the round-number pivot and the ledger pivot are interchangeable.

---

## The Line of Least Resistance

- **origin / source_name**: **Edwin Lefèvre, *Reminiscences of a Stock Operator* (1923)** — spoken by
  the narrator "Larry Livingston", a fictionalised Livermore. **This phrase does not occur anywhere in
  Livermore's own *How to Trade in Stocks* (1940); the word "resistance" appears zero times in that
  book.** Smitten attributes the concept to Livermore throughout *Trade Like Jesse Livermore* — e.g.
  *"Livermore referred to this as the Line of Least Resistance"* — but the sourcing runs back to
  Lefèvre's novelised account, not to Livermore's own writing. Treat every "Livermore said" citation
  of this phrase as third-hand.
- **definition**: The direction in which price meets less opposition, to be determined from the tape
  rather than predicted. *"prices, like everything else, move along the line of least resistance. They
  will do whatever comes easiest, therefore they will go up if there is less resistance to an advance
  than to a decline; and vice versa."*
- **criteria**:
  - Wait for the line to define itself before acting — value: null — *"the thing to determine is the speculative line of least resistance at the moment of trading; and what he should wait for is the moment when that line defines itself, because that is his signal to get busy."* — missing: no definition of "defines itself"; the concept is explicitly qualitative. — confidence: high
  - It is defined by a break of a prior range boundary — value: n/a — *"The price will break through the old barrier or movement-limit and go on."* Worked example in wheat: *"I knew that when it crossed $1.20 it would be because the upward movement at last had gathered force to push it over the limit... by crossing $1.20 the line of least resistance of wheat prices was established."* — confidence: high
  - Price level is irrelevant to the determination — value: n/a — *"stocks are never too high to buy or too low to sell. The price, per se, has nothing to do with establishing my line of least resistance."* — confidence: high
  - Probe sizing on entry — one-fifth of the full line — *"He should accumulate his line on the way up. Let him buy one-fifth of his full line. If that does not show him a profit he must not increase his holdings because he has obviously begun wrong"* — confidence: high (as Lefèvre's text)
- **measured_performance**: none published — this is narrative, not a tested system. Note the source is
  a **work of financial journalism written as a novel**; the trades in it are not audited records.
- **invalidation**: Price failing to follow through past the broken limit; the probe showing a loss
  rather than a profit.
- **detection_notes**: As written, **not directly computable** — "less resistance" is not a measurable
  quantity. The one operationalisable fragment is the range-break (`close > prior_range_high`), which
  is just a breakout and adds nothing beyond what the Darvas and GLB entries already define. The
  one-fifth probe is a position-sizing rule, not a detector. Recommendation for a screener: **do not
  implement this as a pattern.** Its only legitimate use is as a market-regime filter, and even then
  the threshold is entirely the implementer's.
- **conflicts**: Against Smitten, who presents it as an operational first step in a checklist —
  *"First, check the line of least resistance to establish the overall current market direction...
  He checked to see if the current line of least resistance was positive, negative or neutral —
  sideways."* Lefèvre's original supplies no such trichotomy and no test for it. Smitten's version is
  a systematisation of a metaphor. Record both.

---

## The Reversal Pivotal Point (Smitten's reconstruction)

- **origin / source_name**: **Richard Smitten, *Trade Like Jesse Livermore* (Wiley, 2005), Chapter 4.
  This is a later author's reconstruction, not Livermore's own term.** The compound "Reversal Pivotal
  Point" appears **zero times** in Livermore's 1940 book. Smitten asserts the reverse — *"Livermore was
  the first person to use the term Pivotal Point and incorporate it as an important part of his trading
  system"* — which is true of "Pivotal Point" but not of "Reversal Pivotal Point". Smitten also
  concedes the term resists definition: *"The Reversal Pivotal Point is not easily defined."* Every
  number in this entry is Smitten's.
- **definition**: Smitten's gloss, presented as quoting Livermore's mind rather than his page:
  *"In Livermore's mind it was 'a change in basic market direction — the perfect psychological time at
  the beginning of a new move, representing a major change in the basic trend.'"* Note the quotation
  marks in Smitten's text enclose a phrase he does not source to a page.
- **criteria**:
  - Volume surge accompanying the reversal — 50% to 500% above average daily volume — *"These important confirming volume spurts often end the day with a 50 percent to 500 percent increase in the average daily volume."* — confidence: med — **Smitten's number, not Livermore's; a 10× range is so wide it is barely a filter**
  - Maximum chase above the pivot — 5% to 10% — *"please note that if you buy more than 5 percent to 10 percent above the initial Reversal Pivotal Point, you may be too late. You may have lost your trading edge because the move is already well underway."* — confidence: med — Smitten's number; no derivation given
  - Group confirmation — 2 leading stocks in the industry group — *"He employed his Top Down Trading Procedure and looked at the Industry Group, always looking at the two leading stocks in the group, to see if they had the same pattern as the stock he was interested in trading."* — confidence: high (that Smitten says it) — this one **does** trace to Livermore's own Key Price two-stock rule
  - Probe sizing — 20/20/20/40 — *"First establish 20 percent of your planned position on the first purchase, 20 percent on the second, 20 percent on the third. Wait for a confirmation of your judgment — then make your final purchase of 40 percent."* — confidence: med — Smitten's schedule; Lefèvre's original says one-fifth, and Livermore's 1940 book gives no schedule at all
  - Maximum loss — 10% — *"Never sustain a loss of more than 10 percent of your invested capital."* — confidence: high (Smitten), and traceable to Livermore's bucket-shop margin: *"all I ever want to lose in any one stock is ten percent."*
  - Precondition: comes after a long trend — value: null — *"Reversal Pivotal Points usually came after long-term trending moves."* — missing: no length for "long-term". — confidence: high
- **measured_performance**: **None published.** No win rate, no sample, no benchmark anywhere in
  Smitten's book. Evidence is chart annotations on named examples (Yahoo!, Merrill Lynch, Nasdaq, Best
  Buy) selected after the fact — the weakest evidential form in this file. Smitten also flags the
  concept as non-mechanical: *"Livermore never considered this theory as a foolproof, perfect method of
  picking winners."*
- **invalidation**: Failure to perform after the cross — *"if the stock does not perform as it should
  after crossing the Pivotal Point, this is an important danger signal that must be heeded
  immediately."* Also the One-Day Reversal, which Smitten defines mechanically (recorded here only as
  an exit trigger, since 1–2 bar candle patterns are out of scope for this file):
  *"A One-Day Reversal occurs when the high of the day is higher than the high of the previous day, but
  the close of the day is below the close of the previous day, and the volume of the current day is
  higher than the volume of the previous day."*
- **detection_notes**: The 5–10% chase band and the volume ratio are trivially computable
  (`close / pivot_price - 1`, `volume / SMA(volume, n)`) — but **`n` is never stated**, so "average
  daily volume" is undefined and the whole volume criterion is uncomputable as published without the
  implementer choosing a window. The reversal itself has **no mechanical definition at all** in Smitten;
  "a change in basic market direction" is not a predicate. The group-confirmation step needs an
  industry classification plus a leadership ranking — not derivable from OHLCV. **Recommendation: do
  not build a detector from this entry.** Build Livermore's own Chapter V pivot and Market Key instead,
  and keep this entry as documentation of what the popular literature means when it says "Livermore
  pivotal point."
- **conflicts**: Against Livermore's own Chapter V (see that entry) — different concept, different
  tolerance (3 points vs 5–10%), different generator (round numbers/new highs vs trend reversals).
  Against Lefèvre on probe sizing (20/20/20/40 vs one-fifth). Both must be recorded; the widespread
  practice of citing Smitten's numbers as "Livermore's rules" is the specific error this file exists
  to prevent.

---

## The Continuation Pivotal Point (Smitten's reconstruction)

- **origin / source_name**: **Richard Smitten, *Trade Like Jesse Livermore* (2005), Chapter 4. A later
  author's coinage — the term appears zero times in Livermore's 1940 book.** This is the entry in this
  file most directly comparable to an O'Neil base or a Darvas box, and it is the one with the least
  original authority behind it.
- **definition**: A consolidation inside an existing trend. *"Most importantly, Livermore defined a
  Continuation Pivotal Point as a consolidation in which the stock pauses and takes a breather in its
  ascent. It gives a stock a chance to consolidate, often allowing a stock's ratio of earnings and
  sales to catch up to its current price."* And on its role: *"while the Reversal Pivotal Point marks a
  definite change in direction, the Continuation Pivotal Point confirms that the move is proceeding in
  the proper direction."*
- **criteria**:
  - Must occur inside an established trend — value: n/a — *"Continuation Pivotal Points usually occur during a trending move as a natural reaction for a stock in a definite trend."* — confidence: high
  - Direction of exit must match the prior trend — value: n/a — *"the stock must emerge from the Continuation Pivotal Point headed in the same direction it was in before the correction. If not, this is a clear signal to close out your position."* — confidence: high
  - No anticipation; wait for the break — value: n/a — *"never anticipate the market move, simply wait for the move to be revealed to you by the action of the stock."* and *"He must sit on his hands and wait for the confirmation."* — confidence: high
  - Consolidation duration — value: null — missing: **Smitten publishes no minimum or maximum length for the pause.** This is the single largest gap in the entry; without it the concept cannot be distinguished from any two-bar pullback. — confidence: high (that it is absent)
  - Consolidation depth — value: null — missing: no maximum retracement is published either. — confidence: high (that it is absent)
  - Volume behaviour during the pause — value: null — missing: Smitten's volume discussion attaches only to Reversal Pivotal Points, never to Continuation ones. — confidence: high (that it is absent)
  - Chart examples given — Merrill Lynch Aug/Sep; Verisign Nov/Feb and Jun/Dec — *"Figure 4.14 shows Verisign with two Continuation Pivotal Points in November/February and June/December."* — confidence: high (as examples), low (as calibration: these are 2–4 month windows, but they are illustrations, not a stated rule)
- **measured_performance**: **None published.** Same evidential weakness as the Reversal entry:
  annotated hindsight charts, no sample, no benchmark, no failure count.
- **invalidation**: Emerging from the consolidation in the wrong direction — Smitten makes this an
  immediate exit, not merely a non-entry. Also the False Pivotal Point on the short side:
  *"If they formed a False Pivotal Point, that is, if they rallied from this new low and then dropped
  down through and formed another new low, they were most likely to continue down from there."*
- **detection_notes**: **Not computable as published** — with no length, depth, or volume criterion,
  every criterion that would make it a detectable pattern is `null`. To implement it you would have to
  supply all three numbers yourself, at which point you are detecting *your* pattern and calling it
  Livermore's. The only genuinely computable parts are the surrounding context (a prior uptrend, e.g.
  price above a rising moving average) and the exit direction test (`close > consolidation_high` with
  the prior trend up). Requires stateful memory of the pre-consolidation trend direction across the
  whole pause. If this concept is wanted in a screener, derive its numbers from the O'Neil base
  definitions, which publish them, and attribute them to O'Neil — not to Livermore.
- **conflicts**:
  - **Against O'Neil/IBD on what a valid consolidation is.** O'Neil's bases carry published minimum
    durations and maximum depths; Smitten's Continuation Pivotal Point carries neither. On the same
    chart, Smitten's version will accept shallow multi-day pauses that O'Neil classifies as not-a-base,
    and it has no equivalent of O'Neil's "faulty base" rejections. I could not fetch an O'Neil primary
    source in this session, so I record the conflict structurally and leave O'Neil's numbers to that
    file rather than restating them from memory.
  - **Against Darvas.** A Darvas box has a hard, published construction rule (three days, in both
    directions, in a strict order). The Continuation Pivotal Point has none. They are the same idea at
    two utterly different levels of specification, and the Darvas version is the only one of the two a
    screener can implement faithfully.
  - **Against Livermore himself.** Livermore's own 1940 text contains no pause-and-continue pattern.
    His analogous construct is the *Natural Reaction* column in the Market Key — which is defined by a
    hard six-point distance, not by a chart shape. Record both; the Market Key version is the sourced
    one.

---

## The Green Line Breakout (GLB)

- **origin / source_name**: **Dr. Eric Wish**, Wishing Wealth Blog (and the GMI market indicator);
  quoted here from his own post "Green line breakout (GLB) explained", 2018-05. **Attribution
  correction: this concept is Eric *Wish*, not "Eric Krull".** All three independent secondary sources
  fetched agree — the TradingView implementation states *"This is an implementation of Green Line
  Breakout (GLB) which is popularized by Eric Wish through his Wishing Wealth Blog"*, and Richard
  Moglen credits *"Dr. Wish"* as the source he learned it from. The criteria below are Wish's own
  words; where a criterion comes from a follower's write-up rather than Wish, it is marked.
- **definition**: A horizontal line drawn at an all-time high on the **monthly** chart that has stood
  unbroken for at least three months, and the breakout above it. Wish: *"I draw a green horizontal
  line at the highest price reached at any month, that has not been surpassed for at least 3 months."*
  And on the qualifying structure: a stock *"that reached an all-time high and has then rested for at
  least three months."*
- **criteria**:
  - Time the all-time high must stand unbroken — at least 3 months — *"that has not been surpassed for at least 3 months"* — confidence: high
  - Reference price is the monthly HIGH, not the monthly close — value: n/a — *"the highest price reached at any month"*; the TradingView implementation confirms it *"uses 'the highest price reached at any month' — this refers to monthly highs rather than closes"* — confidence: high
  - The high must be an ALL-TIME high, not a 52-week or N-year high — value: n/a — *"reached an all-time high"* — confidence: high
  - Entry trigger — cross of the green line — *"When a stock moves through the green line or is above its last green line I become interested. I only buy stocks that are trading above their last green line tops."* — confidence: high — note this is a *filter for interest*, phrased more loosely than a mechanical trigger
  - Volume expectation — value: null — *"It does help if the stock showed above average volume at the break-out."* — missing: no multiple, no averaging window, and the phrasing (*"It does help"*) makes it a preference, not a requirement. Moglen's follower write-up says only *"The higher the volume on the breakout the better"* — also with no number. — confidence: high (that the number is absent)
  - Sell rule — close back below the green line — *"I have a strict rule to sell a stock immediately if it comes back below its green line."* — confidence: high
  - Follower-added moving-average exits — 21 EMA / 50 SMA — Moglen (secondary, NOT Wish): *"sell rules relating to moving average such as the 21ema, 50 sma"* — confidence: med, and explicitly a follower's addition
- **measured_performance**: **None published.** Wish publishes no win rate, no sample, no benchmark —
  and states the limitation directly: *"Of course, not all GLBs work out. One can never know in advance
  if a GLB will lead to a significant advance."* Moglen's write-up likewise *"contains no sample size
  data or performance statistics"* — its TSLA/MSFT/ZS examples are selected winners, i.e. survivorship
  illustration, not measurement. **Any GLB win rate circulating in the momentum community is
  unsourced; do not attach one from another pattern's statistics.** There is also no base rate
  available for comparison: the natural benchmark would be the forward return of *all* stocks at
  all-time highs, and nobody in these sources computes it.
- **invalidation**: Price closing back below the green line (Wish's strict rule above). Note the
  asymmetry: the *entry* is loosely phrased ("moves through"), the *exit* is strict and immediate.
- **detection_notes**: The cleanest of the three systems to compute, and the only one that is
  essentially a per-bar predicate over a resampled series.
  - Primitives: monthly resample of daily OHLCV (`monthly_high = max(daily high)` within the calendar
    month); a **running all-time maximum of monthly highs** with unbounded lookback; a test that the
    candidate month's high has not been exceeded by any of the following ≥3 monthly highs; then a
    breakout test on the live bar.
  - **Stateful across bars**: the green line is a *latched* level that persists indefinitely until
    broken — Wish's *"last green line"* implies keeping the most recent qualifying line, and by
    implication a history of superseded ones.
  - **Requires true all-time data.** A 5- or 10-year window silently produces a different, laxer
    pattern. If the price history is short or the listing is recent, the "all-time high" is really a
    "since-IPO high" and must be labelled as such — this is a real and common defect in GLB screeners.
  - **Split/dividend adjustment matters more here than anywhere else in this file**, because the
    lookback is unbounded: an unadjusted series will produce false all-time highs and phantom green
    lines. Darvas makes the same point for his own method: *"All charts take into consideration stock
    splits, and when you look at the adjusted price, the history of the stock is reflected and
    translated."*
  - **The "3 months" is calendar-month based, not 63-trading-days based.** These are not the same
    filter; a 63-bar version will fire on structures the monthly version rejects and vice versa. Pick
    one and label it.
  - Ambiguity to flag: Wish's *"moves through the green line"* does not say whether the trigger is an
    intraday touch, a daily close, or a *monthly* close above the line. On a monthly-chart method the
    natural reading is a monthly close, but Wish does not say so; the three secondary sources do not
    resolve it either. **Mark this as an implementer's choice, not a published rule.**
  - The volume criterion is **not computable as published** (no multiple, no window).
- **conflicts**:
  - **GLB vs Darvas on lookback** — they agree, unusually: both demand a genuine all-time high
    (*"I strictly adhere to historical high"* / *"reached an all-time high"*). This is the strongest
    point of agreement across the whole file.
  - **GLB vs Darvas on consolidation length** — flat contradiction. GLB requires **at least 3 months**
    of rest. Darvas requires **three days** and says explicitly *"I did not care how long it stayed in
    its box."* On the same chart, a Darvas box fires roughly an order of magnitude more often than a
    GLB. Record both; do not reconcile them by picking a middle number.
  - **GLB vs Livermore on dormancy** — Livermore's new-high pivot wants *"two or three years"* of
    dormancy, GLB wants three months, Darvas wants three days. Three authorities, three answers,
    spanning a factor of ~250. There is no consensus value here and a screener should expose the
    lookback as a parameter rather than pretend one is canonical.
  - **GLB vs O'Neil on base shape** — GLB imposes **no shape constraint whatsoever** (no depth limit,
    no handle, no tightness, no volume dry-up); it is purely a time-plus-level test. O'Neil's bases are
    shape-specified. A GLB will therefore accept wide, loose, deep multi-month structures that O'Neil
    classifies as faulty. Record both.
  - **Wish vs his followers on exits** — Wish publishes exactly one exit (back below the green line).
    The moving-average exits (21 EMA, 50 SMA) are follower additions and should not be attributed to
    Wish.

---

## Cross-cutting notes for the screener

**Where the numbers actually come from.** Of the eleven concepts above, the ones with genuine
first-author numbers are: the Darvas Box (3 days), Darvas's order placement, the Livermore Pivotal
Point (3 points; 2–3 years dormancy), the Livermore Market Key (6 / 12 / 3 points; $30 floor), and
the GLB (3 months). The Reversal and Continuation Pivotal Points carry **only** Smitten's numbers,
and the Line of Least Resistance carries none at all.

**Point-based versus percentage-based.** Every Livermore threshold is in absolute dollar points, set
for a $30+ market in 1940. Every Darvas box-height figure is a percentage. GLB is level-based with no
distance threshold. Mixing them without conversion is a units error; converting them is an
extrapolation the original authors declined to make — Livermore said so in as many words.

**Measured performance across the whole file.** Exactly one entry carries an independently measured
statistic with a stated sample and a benchmark: Bulkowski's Darvas test (49% wins, 10.5% avg gain,
262 trades, 2001–2010, S&P −0.7% over the period) — and his implementation deviates from Darvas's own
rule on the trigger, so it does not validate Darvas as written. **Every other entry in this file has
zero published performance data.** Darvas's $2,000,000 and Livermore's Anaconda and Bethlehem trades
are single-trader anecdotes with no denominator; Smitten's and Wish's chart examples are selected
after the outcome was known. None of the three authorities publishes the base rate their claims would
have to beat: the forward return of an unfiltered stock making a new high.

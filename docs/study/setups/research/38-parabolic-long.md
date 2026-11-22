# Setup 38: Parabolic Long (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Where I could not
read a source, I say so and give no wording from it.

**What the owner has already ruled.** On 2026-11-09 he made the parabolic long the one exception to the hard 200-day
rule: "SHort I will only do if below the 200SMA. No longs below 200SMA (unless parabolic long) no shorts above 200SMA
unless parabolic short." (B26). He named the source: "parabolic ids a parabolic short you can read bracco's substack
post to determine a parabolic short and long." Asked whether the long is the mirror image of Bracco's parabolic short,
a burst down, he answered "1, yes." (all in `docs/study/audits/2026-10-24/owner_verdicts.jsonl`, 2026-11-09). This
dossier works from that ruling and tests it against everything else I could find.

**How the quotes were checked.** Every quote is 40 words or fewer, copied from the source named next to it.
- **Cold check (2026-11-09, a second reader).** Every source below was fetched again, independently of the writer's
  copies (the 24 cited UCT posts through the public post API, qullamaggie.com, both ChartSchool pages, Wyckoff
  Analytics, the two Internet Archive copies, the Motley Fool interview, the three RePEc abstracts and the EconPapers
  page, Chat With Traders, the Stonks Capital post; Bulkowski's two pages through the fetch tool, since curl still gets
  406), and all 311 quoted strings were matched word for word by script, wrapped quotes included. Each UCT quote was
  also traced to the section header it sits under (Bracco's or the owner's). The scanner replay (5.2), the worked
  examples (9.2) and the cluster and intraday numbers (4.7, 4.8) were recomputed from the same bars and the writer's
  saved rows. What changed is listed under "Removed in checking" at the end.
- **Checked word for word by a script against saved copies downloaded today:** Bracco's "The Parabolic Short" and all
  103 posts in UCT's Substack sitemap (read through the public post API), qullamaggie.com, StockCharts ChartSchool (the
  Wyckoff tutorial and the RSI(2) page), Wyckoff Analytics, the TraderLion "Reversal Extension" article (Internet
  Archive copy), Minervini's blog (Internet Archive copy), the Motley Fool interview with William O'Neil, the RePEc
  abstracts of three papers, the Chat With Traders episode page, and our own code and docs.
- **Bulkowski's thepatternsite.com** refused plain curl (HTTP 406, its firewall). I did not disguise the client. I read
  the two pages through the fetch tool, which returned the sentences quoted here as verbatim (the cold check re-read
  both pages the same way, when they read "As of 11/09/2026", and completed the sentences the first read had cut at
  120 characters). The site carries a notice: "This website, in whole or in part, shall not be used to train
  artificial intelligence (AI) systems,". I read it and cite it only, with links and short quotes.
- **Investopedia** could not be fetched today. I quote nothing from it (our `docs/study/research/definitions.json`
  quotes it from 2026-10-17).
- **Images I read myself:** Bracco's extension table in "The Parabolic Short" (section 4.4) and Kullamägi's GBTC charts
  (section 3.3). Numbers read off an image are marked.
- **The brain's knowledge-base extracts in this repo** (`docs/study/levels/brain_kb_*.json`) are summaries written by
  the brain, not the trader's words, except where a record says "In Bracco's words". I mark each one as a summary.
- **Spelling is the source's** ("signifigant", "do the downside"). I keep it and mark [sic] once.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** Kristjan Kullamägi, who
published the earliest "parabolic long" I found (2021); **[UCT]** Bracco's post (the house definition by ruling), UCT's
Sunday Scans, the owner's words; **[house rule]** the account rulebook, `docs/study/sizing_rule.md` section 9;
**[measured]** our own test in sections 4.7 and 4.8 (not a published statistic); **[my proposal]** my recommendation,
for the owner to accept or change.

Terms. **Burst**: the last 3 to 5 days of a move, when range and volume expand (Bracco's word). **Burst down**: the
same thing to the downside. **Climax day**: the day the burst ends; for the long, the day that gaps down and turns.
**Stretch** or **ATR multiple**: (close minus the 50-day SMA) divided by the 20-day average true range, the measure Bracco
credits to Jeff Sun; negative means below the 50-day. **V day**: a day that opens lower, flushes, and closes well up from
its open. **Day-2 gap up**: the mirror of Bracco's "day 2 gap down" variant: the climax day closes weak, and the next
day gaps up. **R**: the risk on the trade (entry minus stop). **RVOL**: volume divided by the average volume of the prior 50
sessions (the day itself excluded; that is how the figures in 9.2 were computed).

---

## 1. What it is

**In two plain sentences.** A parabolic long is a short, fast bounce trade bought after a stock, ETF or index has fallen
straight down for 3 to 5 days in an accelerating, panicky burst, and only once the climax day turns back up. It is
Bracco's parabolic short turned upside down: the same burst, a gap down instead of a gap up on the climax day, a stop
under the day's low instead of over the high, and a snap back toward the 9-day EMA as the target.

**Why it works (the psychology).**
- **Forced sellers, not willing ones.** A burst down is usually driven by people who have to sell: margin calls,
  leveraged ETFs and funds unwinding, stop orders cascading, and holders who panic. When forced selling is done, there
  is no one left who has to sell. Kullamägi's image: "Think of stocks as rubber bands, if they get really stretched
  short term, they can have powerful snapbacks." Bracco uses the same image for the short ("Picture a rubber band: the
  more you stretch it, the harder it snaps back.").
- **The climax hands the shares to stronger hands.** The Wyckoff school calls the low a selling climax: "the point at
  which widening spread and selling pressure usually climaxes and heavy or panicky selling by the public is being
  absorbed by larger professional interests at or near a bottom." ([StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial))
- **Who is trapped.** Late shorts who sold into the gap down, and holders who dumped at the low. When the turn comes,
  the shorts must buy back. Wyckoff's automatic rally: "A wave of buying easily pushes prices up; this is further fueled
  by short covering." Bracco's reflexivity argument for the short (rising prices feed optimism, which feeds buying) runs
  in reverse on the way down and then snaps.
- **Who is buying.** Short covering, dip buyers and bargain hunters, and (Wyckoff) professionals absorbing supply.
- **Why it often fails.** The trade goes against the trend. O'Neil's warning is the other side of the coin: stocks
  that fall hard "are almost always down for a reason" (section 3.10). Measured studies agree that a fall driven by real
  news tends to keep drifting, while a fall without news tends to reverse (Savor 2012, section 4.3). And the bounce is
  short: Bracco calls these trades "not meant to be held longer than 1-3 days."

---

## 2. Origin and naming

- **Kristjan Kullamägi (Qullamaggie), 2021.** In ["3 TIMELESS setups that have made me TENS OF MILLIONS!"](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/)
  (posted 2021-01-08, updated 2021-04-28), his third setup is headed "The Parabolic Short (or long)". He gives the long
  in one paragraph and one example ("$GBTC in 2017"). This is the earliest originator text using the setup's name that I
  found. I did not find a separate post of his on the long.
- **Bracco (UCT), 2025.** ["The Parabolic Short"](https://unchartedterritoryy.substack.com/p/the-parabolic-short)
  (2025-06-13) coins the "Parabolic Burst": "This is a term I created to help identify and time a Parabolic Short
  correctly." The post has no long version. In later Sunday Scans he calls the long side "parabolic/mean reversion
  longs" (2025-10-19), "Rubber band longs" (same post), "ATR mean-reversion long" (2026-01-18), "mean reversion long"
  (2026-06-07) and "parabolic long trade" (CAR, 2026-04-26). The brain's summary of a 2025-01-13 Discord post has him
  flagging "parabolic (rubber-band) long candidates on another gap down" (summary, not his words; KB id 10873).
- **The owner, 2026-11-09.** The parabolic long is the mirror of Bracco's parabolic short, a burst down (B26 ruling).
- **Older and related names.**
  - **Selling climax and automatic rally** (Richard Wyckoff's method, as taught by the Wyckoff school). Phase A of an
    accumulation range. Wyckoff treats it as the start of a range, not a trade by itself (section 3.4).
  - **Capitulation**, **washout**, **flush**: common words for the climax day. The owner: "washout upside trade"
    (2026-03-22). Our app's live setup tag is "Capitulation" (`uct_capitulation`).
  - **Reversal Extension** (Oliver Kell's cycle of price action): a capitulation low after a downtrend (section 3.5).
  - **Vertical run down** and **dead-cat bounce** (Thomas Bulkowski, thepatternsite.com): measured patterns of a straight
    drop and the bounce after it (sections 3.6 and 4.1-4.2).
  - **Rubber band long, oversold bounce, snap-back trade, mean reversion long**: UCT's everyday names.
  - **"Right Side of the V"** (Lance Breitstein): not a setup but the entry idea Bracco borrows: wait for the turn
    (section 3.7).
  - **"Gap Reversal Against Intermediate Trend"** (named after Brian Shannon by the owner and an unsigned UCT note): the
    day-2 gap-up entry UCT used on TQQQ in 2026 (section 3.8).
- **A name collision in our own app.** The Model Book card, `definitions.json` and a curriculum lesson use "Parabolic
  Long" for something else: riding a stock UP its vertical run (section 5.5). That meaning is now overruled.

---

## 3. Every definition, source by source

### 3.1 Bracco, "The Parabolic Short" (UCT Substack, 2025-06-13): the house definition, and its mirror

Source: <https://unchartedterritoryy.substack.com/p/the-parabolic-short>. This is the post the owner named. Every
criterion below is for the SHORT; the right column is the mirror the owner ruled in.

| Bracco's short, in his words | The long mirror (B26) |
|---|---|
| The burst: "This parabolic burst is a 3-5 day move that marks the final leg of a parabolic move." "It is typically the most irrational stage of the move, where range and volume expand significantly." | A 3-5 day burst DOWN, the final leg of a decline, with range and volume expanding. |
| "Three straight days of gains. The more consecutive up days, the better the setup." | Three straight down days; more is better. |
| "Two consecutive overnight gap ups. This can include the exhaustion gap on the climax day. Unfilled gaps left behind is a bonus." | Two consecutive gap downs, the climax-day gap may count; unfilled down gaps overhead are a bonus. |
| "Two out of three days of range expansion, where the percentage gain is larger than the previous day. Ideally consecutive range expansion days." | Two of three days where the % LOSS is larger than the day before. |
| "Two days of volume expansion, with each day’s volume higher than the last." | The same. |
| "A gap-up on the climax day." "You never know exactly when the climax day will hit, but I won’t short without that gap-up." "The climax gap up typically takes place on day 3 to 5 of the move." | A gap DOWN on the climax day, required; usually day 3 to 5 of the burst. |
| "While not every criteria needs to be fully satisfied, the more boxes checked, the stronger the setup." Two days can do: "a stock might only have two consecutive up days before the climax, but if the two day move shows significant short-term price and ATR expansion, it remains a viable candidate" | A checklist to grade, not a gate; two down days can qualify if range and ATR expand hard. |
| Shape: a parabolic (accelerating) curve, not a linear one. He shows AAPL late 2023 as the stair-step "linear progression" to avoid. | An accelerating decline, not a stair-step one. |
| Size and stretch: "a frequent mistake I notice among traders is relying solely on a stock’s percentage gain, overlooking its chart structure and formation." His extension table (section 4.4) uses ATR multiples above the 50-day. | Judge the structure first; measure the stretch below the 50-day in ATRs. |
| Opening volume: "the climax day almost invariably showing the highest opening volume of the entire run." | The climax day has the highest opening 5- or 15-minute volume of the burst. |
| Bollinger Bands: "A price breach above the upper Bollinger Band or below the lower band is typically short-lived, often foreshadowing a counter-trend snap back move" | A close below the lower band supports the long. |
| Entry: "For a parabolic short, I am always waiting until the intraday trend flips to the downside." "I will never take an entry until the stock at least breaks below the intraday VWAP (Volume Weighted Average Price)." | Buy only after the intraday trend flips up: at least a reclaim of VWAP. |
| Second entry: "If the trade moves in my favor and breaks below the day’s lows, I take my second entry." | A second entry above the day's high (conflicts with A5, one entry). |
| Stop: "setting my initial stop at the day’s high, as my thesis assumes the trend has reversed and the top is in." "If the price reclaims the day’s high, I deem my thesis or timing incorrect and exit the trade." | Stop under the day's low; a new low means the thesis or timing was wrong. |
| Trail: the prior 5-minute bar's high, then the 5-minute 20 EMA or VWAP (from Lance Breitstein). | Trail under prior 5-minute lows, then the 5-minute 20 EMA or VWAP. |
| Target: "My target for a Parabolic Short is consistently the 9-day exponential moving average (9EMA), which my studies show acts as a magnet for mean reversion" "Every parabolic short I’ve analyzed reaches the daily 9EMA before any counter-trend rally emerges" "Once the 9EMA is tested on the backside of the move, I consider the Parabolic Short complete" | Target: the daily 9 EMA from below; the trade is done when it gets there. |
| Variant he does not typically trade: no gap on the climax day; it sells off intraday but closes mid-range or high (hanging man or doji), "Then the stock gaps down the next day, and that is usually the nail in the coffin." "Usually any opening range breakdown and failure to fill the gap begins the backside of the move and can be traded back to the daily 9EMA." | Day-2 gap up: the climax day (gap or no gap) closes weak, near its low (an inverted hammer or a doji), the next day gaps up; an opening-range-high break that does not fill the gap, traded up to the 9 EMA. |
| Size of stock: "While this setup is more common in small caps, I prefer mid-to-large cap stocks." | The same. |
| Rarity: "You’re lucky to get a couple 5-star candidates a year." | The same. |
| Mistakes: "Being too early to a Parabolic Short is a recipe for disaster." "Shorting at the day’s highs can be a dangerous trap" | Buying too early; buying at the day's low before the turn. |

Things the post does NOT give: a minimum % move, a minimum distance from any average for a buy, a market filter, or
anything about holding overnight. It is a day trade on the short side for him (2025-12-28: "I personally like to day
trade a very concentrated position").

### 3.2 Bracco on the long side, in Sunday Scans and "The Rest of the Week" (UCT)

His long-side criteria, gathered from many posts (quotes and links in section 6.2):
- **Context A, the unwind of a blow-off.** Stocks that just set up as parabolic shorts can become "parabolic/mean
  reversion longs in just a couple of days" (2025-10-19). Examples: UAMY, USAR, ABAT "on their 4th down day after 40-50%
  drawdowns"; CAR "After falling -77% in 3 days"; AGQ in February 2026.
- **Context B, a capitulation out of a downtrend or a sharp pullback.** "First will be range and volume expansion"
  (2026-03-22). Stretch: the S&P "-3.55 ATR’s below the 50-ma" was "considered an extreme for me"; corrections bottom
  near -3 ATR, crashes -5 or lower. Examples: SOXL and KORU (June 2026), QQQ (August 2024, April 2025), IGV (February
  2026), ETH (October 2025).
- **The gap down.** "Ideal situation is a gap down or further weakness before the turn." (SOXL, 2026-06-07). For the
  index: "ideally 1 full ATR or more on the indexes." And Mondays: the "Monday Effect".
- **Not parabolic enough.** "We are not in any way, shape, or form “parabolic” do the downside." [sic] (2026-03-22), so
  no trade. And not on the first days of a breakdown: "Was only second day down in a row as well as first day breaking
  down below a 3-month support level." (2026-11-01).
- **Holding.** "These are short lived trades and not meant to be held longer than 1-3 days." (2025-10-19). In practice
  he kept most of his SOXL long after it worked (still holding on 2026-06-21), trimming 25% "for a 40% gain from $202
  entry on 6/11".
- **A second, intraday kind.** His "ATR mean-reversion long" on FIGR (2026-01-12) and SNDK (2026-01-08) is a one-day
  intraday flush inside a leader's uptrend (FIGR: a -16% late-day drop after an IPO-base breakout), not a multi-day
  burst. It belongs with Mean Reversion (setup 36). I note it so the two are not mixed up. The same words cover a
  third thing: on 2025-10-26 he called pullbacks in leaders to their 10-week averages "rubber band / mean reversion
  longs on some short term oversold momentum leaders such as IREN CIFR NBIS LEU BE HOOD etc" that "staged MAU&R’s
  (moving average undercut and rallies)" (section 6.2); that is a pullback setup, not a burst down.

### 3.3 Kristjan Kullamägi (originator of the name), qullamaggie.com, 2021

Source: <https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/> (posted 2021-01-08).
- **What it is (both sides):** "Think of stocks as rubber bands, if they get really stretched short term, they can have
  powerful snapbacks." "This is by far the riskiest setup if done wrong or if you have issues with not obeying your
  stops." "Most of these are short setups, but sometimes there are also good long setups but they don’t occur as often."
- **The long, in full:** "any time a successful parabolic short goes down 50-60%+ in a few days, that’s the premise for
  the long setup." "Entry is opening range highs or the first green 5-minute candle or any range break to the upside if
  the stock doesn’t rally out of the gate, which they usually do." "These things can bounce 50-100% in a few days."
- **What he does not say for the long:** a stop or a target. For the short they are: "The stop is highs of the day or if
  VWAP fail, a reclaim of the VWAP. The key is to get relatively tight and defined stops." "The target area is the 10-
  and 20-day moving averages, that’s where these stocks usually bounce." The mirror for the long: the day's low (or a
  lost VWAP) and the 10/20-day averages.
- **The short's run-up (the "successful parabolic short" the long comes after):** "A stock up 50-100%+ in a few days or
  weeks (if larger cap) or 300-1000%+ (if smaller cap)." "The stock should be up 3-5+ days in a row."
- **Patience and payoff:** "Don’t be too early. WAIT for the right setup. Let the amateur shorts get run over, that’s
  where your edge comes in." "This setup is more like 5-10x risk reward, but if you wait for the perfect setups your win
  rate is probably going to be higher."
- **His example: GBTC, December 2017.** His daily chart is dated 2017-12-21 at its right edge and his 5-minute chart
  shows the V bottom of the next session (I looked at both images). On our bars (section 9.2, example 1), it fits every
  box of the mirror.

### 3.4 The Wyckoff school: selling climax, automatic rally, secondary test

Sources: ["The Wyckoff Method: A Tutorial"](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial)
(StockCharts ChartSchool; the page says it "was written by Roman Bogomazov and Michael Lipsett, and the schematics were
created by Roman Bogomazov and edited by the late Dr. Henry O. (“Hank”) Pruden.") and
the same text on [Wyckoff Analytics](https://www.wyckoffanalytics.com/wyckoff-method/).
- **Climax:** see section 1. "Often price will close well off the low in a SC, reflecting the buying by these large
  interests." (that is the V day).
- **Automatic rally (the bounce):** "A wave of buying easily pushes prices up; this is further fueled by short
  covering." Its high defines the top of the coming range.
- **The test after:** a secondary test should show less selling; "If the ST goes lower than that of the SC, one can
  anticipate either new lows or prolonged consolidation."
- **Where it sits:** "Phase A marks the stopping of the prior downtrend." Wyckoff does not give a trade with a stop for
  the automatic rally; the trades come later (spring, sign of strength). So Wyckoff supports the structure (climax,
  heavy volume, close off the low, short covering) but not the timing of a buy at the climax.

### 3.5 Oliver Kell: the Reversal Extension (TraderLion, 2024)

Source: ["Reversal Extension: How Stocks Bottom"](https://web.archive.org/web/20250820211726/https://traderlion.com/technical-analysis/chart-patterns/reversal-extension-how-stocks-bottom/),
TraderLion, published 2024-06-11. It is written about Kell in the third person under his byline; I treat it as an
established educator presenting the originator's method.
- "A Reversal Extension is formed when the price pulls away from the moving averages, then snaps back up and is
  accompanied by heavy volume."
- "When the price is extended well below the 10-day moving average, and the moving averages are extended away from each
  other, begin to look that snap back." No number is given.
- "The Reversal Extension is not necessarily a playable setup but more of a change in mindset."
- If traded: "Stops are placed just below the low of the Reversal Extension bar. Be quick to take profits and raise
  stops with the first profit target at the retest of the 20 EMA."
- "Often, trading the daily Reversal Extension is best avoided." And: "Get aggressive trading individual stocks when you
  see a Reversal Extension on the index."
- The Kell cycle is covered in dossier 18; there the owner said he will "gladly try some Reversal Extensions" and
  Bracco (KB 15731, quoted in dossier 18) said you technically do not buy it.

### 3.6 Thomas Bulkowski: vertical run down and dead-cat bounce (thepatternsite.com)

Read through the fetch tool (see the note at the top); the site forbids AI training.
- **Vertical run down** ([VerticalRunDown.html](https://thepatternsite.com/VerticalRunDown.html), "As of 11/06/2026"
  when first read, "As of 11/09/2026" on the check): "That's when price plunges in a straight line drop, day after
  day, with little or no overlap between price bars." His identification guidelines: "Price moves down in a steep drop
  for at least four sessions." "There is minimal overlap from price bar to bar." "Price can pause along the vertical
  run, occasionally multiple times." No volume condition; gaps appear only in his trading tips ("Ignore any gap before
  and including the third bar since a valid vertical run down takes four bars."). Entry: "After bar 4, that is, once
  the vertical run down has been established, I would use a trailing buy stop." "I would place it a penny or two above
  the prior bar and lower it as each lower high occurred." "Trail it lower by placing the stop a penny or two above the
  high of the prior bar -- never raise the buy stop." Stop: "A stop loss should be a penny or two below B and raised as
  price climbs." (B is the bar at the end of the run in his example; the figure runs "from A to B" and he lowers the
  buy stop "to a penny or two above the high of bar B". I could not see the chart.) Target: "I set the exit target to
  be midway down the price run." Results in section 4.1.
- **Dead-cat bounce** ([dcb.html](https://www.thepatternsite.com/dcb.html), "As of 11/06/2026"): a one-day collapse,
  usually on news: "Price usually gaps downward, closing 15% to 70% lower than the prior day." On buying it: "Swing
  traders can buy near the event trend low and ride price upward until it peaks in the bounce phase." "Only try this if
  the event day decline is a large one, say over 30%." Results in section 4.2. Note this is a one-day news drop, not a
  multi-day burst.

### 3.7 Lance Breitstein: "The Right Side of the V" (the entry idea, through Bracco)

Bracco: "The execution is where the “Right Side of the V” comes into play, a concept I picked up from Lance
Breitstein." He defines it: "This strategy refers to entering a trade after a stock's price reverses from a sharp
incline or decline (forming a V-shape), aligning with the new intraday trend for higher-probability, lower-risk
entries." I could not read Breitstein's own definition: Chat With Traders [episode 236](https://chatwithtraders.com/236)
(2022-06-27) lists "The Right Side of the V" among the "core trading concepts" discussed, but the page has no
transcript, and I found no written text by him. So the wording above is Bracco's.

### 3.8 Brian Shannon's gap reversal against the intermediate trend (named by UCT)

The owner, on his TQQQ entry: "Tuesday’s gap up gave a very good opportunity on the intraday pullback and was a
textbook Brian Shannon Gap Up against intermediate trend." (Sunday Scans 2026-04-05). An unsigned UCT note
(2026-04-01): "it did the classic Gap Reversal Against Intermediate Trend from Brian Shannon. A setup we have used for
quite some time with great success." I searched for Shannon's own definition (alphatrends.net, his book) and did not
find a text I could read. I give no rule from him.

### 3.9 Larry Connors' RSI(2) (StockCharts ChartSchool): a mean-reversion long that forbids this setup's location

Source: [ChartSchool, "RSI(2)"](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/rsi-2).
Not a parabolic setup, but the best-known published rule for buying sharp short-term drops, and it disagrees with B26:
"Traders should look for buying opportunities when above the 200-day SMA and short-selling opportunities when below the
200-day SMA." It is "not designed to identify major tops or bottoms." Exit: "Connors advocates exiting long positions on
a move above the 5-day SMA". Stops: "Connors does not advocate using stops." (his tests, as ChartSchool reports them).

### 3.10 The case against (William O'Neil, Mark Minervini)

- **O'Neil** ([Motley Fool interview, 2002-06-20](https://www.fool.com/specials/2002/06/20/foolcom-tmf-interview-bill-oneil-special.aspx)),
  on buying a stock that fell from 80 to 50: "This is a deadly sin in the market and one of the worst habits an investor
  can have. Why try to catch a falling dagger?" "Stocks that decline more than normal are under heavy liquidation by
  institutional investors and are almost always down for a reason".
- **Minervini** ([blog, Internet Archive copy of 2019-04-26](https://web.archive.org/web/20190426232311/http://www.minervini.com:80/blog/index.php/blog/show/first_things_first_how_to_chart_stocks_correctly_and_increase_your_chances)):
  "I never go against the long-term trend." "If a stock’s price is in a long-term downtrend, don’t even consider buying
  it."
- These are position-trading rules about buying stocks to hold. They are the reason B26 is a hard rule for every other
  long. They do not address a 1-3 day bounce, but they explain why the course must teach this as a rare exception.

### 3.11 Comparison table

| Source | Prior trend / context | Shape | Length | Depth | Volume | Averages | Trigger and entry | Stop | Target | Hold |
|---|---|---|---|---|---|---|---|---|---|---|
| Bracco, short, mirrored (house by ruling) | after a large run (here: a decline) | accelerating burst; 3 down days, 2 gap downs, bigger % losses, rising volume | 3-5 days | none fixed; structure first; his short table 7.4-10.3 ATR from the 50-day | rising 2 days; highest opening volume on the climax | 9 EMA (target); Bollinger lower band | climax day must gap down; buy after the intraday flip, at least a VWAP reclaim | under the day's low | daily 9 EMA | intraday to days |
| Bracco, long side (Sunday Scans) | (A) blow-off unwind or (B) capitulation in a decline | range and volume expansion; "parabolic" to the downside | 2-4 down days in his examples | 40-50% drawdowns (small caps); -36% in 2 days (3x ETF); index -3 ATR (correction), -5 or lower (crash) | expansion; highest ever (IGV) | 50-day (ATR stretch), 200-day (undercut), 20 EMA | gap down or further weakness, then the turn; or the next day's gap up (SOXL) | the low (FIGR: "stop at 49" under a 49.10 low) | a snap back; 9 EMA by mirror | 1-3 days; longer if it works |
| Kullamägi (originator) | a successful parabolic short | crash | "a few days" | 50-60%+ | not given | not given (short target 10/20-day) | opening-range high, first green 5-min candle, or any range break up | not given (short: high of day) | not given (short: 10/20-day) | "a few days"; bounce 50-100% |
| Wyckoff school | prolonged down-move | climax, wide spread, close well off the low | not given | not given | heavy | none | none for the bounce itself | none | the automatic rally high | the start of a range |
| Kell (TraderLion) | downtrend | pulled away from the averages, snaps back | not given | "well below the 10-day" | heavy | 10-day, 20 EMA | the RE bar; often avoid; better on the index | under the RE bar's low | first: the 20 EMA retest | quick profits |
| Bulkowski, vertical run down | any | steep, little bar overlap | 4+ sessions | not given | not given | none | buy stop above the prior bar's high after bar 4 | below B | midway up the run | not given |
| Bulkowski, dead-cat bounce | any; news | one-day gap down | 1 day | 15-70%; trade only if over 30% | not given | none | near the event trend low | not given | the bounce peak (average 28%) | average 23 days to the bounce high |
| Connors RSI(2) | ABOVE the 200-day only | short pullback | days | RSI(2) under 10 (5 better) | none | 200-day, 5-day SMA | close or next open | none | above the 5-day SMA | days |
| O'Neil, Minervini | do not buy declines | | | | | above the 200-day (Minervini) | | | | |
| Our Model Book card (old) | a runaway UP move | vertical rise | | | | | ride it | a give-back rule | none | bar by bar |

### 3.12 Where the sources disagree

1. **How deep.** Kullamägi: 50-60%+ "in a few days". Bracco: 40-50% for small caps, -36% in 2 days for a 3x ETF, and
   for indexes an ATR stretch (-3 correction, -5 crash) rather than a %. Bulkowski's dead-cat bounce: a 15%+ one-day
   drop, trade only over 30%. Bracco's own warning: structure beats a raw %.
   **Recommend** two yardsticks by context: a % drop from the peak for blow-off unwinds, an ATR stretch below the 50-day
   for declines (section 8.1). Our test (4.7) shows both extremes matter more than the checklist.
2. **Whether a gap down is required.** Only Bracco's mirror requires it; Kullamägi, Kell and Bulkowski do not.
   **Recommend** keeping it: it is the owner's ruled definition, and the gap is what traps the late sellers. The day-2
   gap-up variant (3.1) covers the cases where the flush closes weak.
3. **The entry.** VWAP reclaim (Bracco mirror); opening-range high or first green 5-minute candle (Kullamägi); a buy stop
   over the prior day's high (Bulkowski); the next day's gap up (owner's TQQQ, Bracco's SOXL); the close (Connors, and our
   app's scanners). **Recommend** the VWAP reclaim as the course's default with the day-2 gap up as the named
   alternative; both are UCT's own.
4. **The target.** 9 EMA (Bracco), 10/20-day (Kullamägi), 20 EMA retest (Kell), midway up the run (Bulkowski), the
   5-day SMA (Connors), the bounce peak (dead-cat). **Recommend** the 9 EMA (the house's mirror), taught with the
   warning from 4.7: after a crash from far above, the 9 EMA can be out of reach (CAR, AGQ).
5. **Is it a trade at all?** Kullamägi and Bracco: yes, rarely, with tight stops. Kell: often avoid on the daily, buy the
   Wedge Pop instead. Bracco in chat (KB 12095, his words): most traders "woudl rather buy the wedge pop into a new
   uptrend versus the oversold bounce". O'Neil: a deadly sin. **Recommend** teaching it as an advanced, rare setup.
6. **The 200-day.** B26 allows it below; Connors and Minervini forbid buying below it. The owner himself wrote "Generally,
   below the 200SMA no participation is best." (2026-03-29) and then traded TQQQ below it as a mean reversion. The
   ruling settles it for us; the course should show why it is the exception.
7. **How long to hold.** Bracco 1-3 days; the owner "a 2-3 day outlook"; Kullamägi "a few days"; Bulkowski's dead-cat
   bounce averages 23 days to the bounce high. **Recommend** a 3-session time stop (8.4).
8. **Stops.** Day's low (Bracco mirror, Kell, Kullamägi by mirror); no stop (Connors). **Recommend** the day's low.

---

## 4. Measured evidence

No published study measures this exact setup (a multi-day burst down, a gap-down climax, a VWAP-reclaim buy). What
exists is adjacent. Every number below has its source and its limits.

### 4.1 Bulkowski, vertical run down (thepatternsite.com)

- Sample: "The figure on the right shows the results from a study of 2,036 vertical runs in 469 stocks in the three
  bull markets from July 1995 to January 2014." Bull markets only.
- "Most of the time (84%), the stock will retrace at least a portion of the move down."
- "After a vertical run ends (black price bars), price continues to climb 46% of the time, completely retracing the drop
  suffered in the vertical run."
- "The median (midway) retrace is 81%."
- His buy-stop entry (3.6) with a target midway up the run: "This should work 64% of the time."
- Limits: bull markets only; a run of 4+ days with little overlap, no gap or volume condition; his own measurements,
  method not fully shown; read through a tool, not a saved copy.

### 4.2 Bulkowski, dead-cat bounce (thepatternsite.com)

- "The average event decline from prior close to trend low is 31%." "From the event day to the trend low averages 7
  days." So the event day is often NOT the low.
- "The average bounce height from event low to bounce high is 28% and takes 23 days."
- "The larger the event day decline, the larger the bounce and the longer it takes for price to reach the bounce high."
- After the bounce: "Once the bounce completes, price resumes declining, averaging 30% from the bounce high to
  post-bounce low in 49 days."
- Basis: "The numbers cited in this article are based on hundreds of _perfect_ trades." (ideal entries and exits).
- Limits: a one-day news gap, not a multi-day burst; perfect-trade figures; sample size not stated in what I read.

### 4.3 Academic studies of big drops (abstracts only)

- **Bremer and Sweeney (1991)**, "The Reversal of Large Stock-Price Decreases", *Journal of Finance* 46(2), 747-754
  ([RePEc](https://ideas.repec.org/a/bla/jfinan/v46y1991i2p747-54.html)): "Extremely large negative ten-day rates of
  return are followed on average by larger-than-expected positive rates of return over following days." "This price
  adjustment lasts approximately two days". "While perhaps not representing abnormal profit opportunities, these
  reversals present a puzzle as to the length of the price adjustment period." (RePEc's abstract says "ten-day"; later
  papers describe the event as a large one-day drop. I could not read the paper to settle it.)
- **Cox and Peterson (1994)**, "Stock Returns Following Large One-Day Declines: Evidence on Short-Term Reversals and
  Longer-Term Performance", *Journal of Finance* 49(1), 255-267 ([RePEc](https://ideas.repec.org/a/bla/jfinan/v49y1994i1p255-67.html)):
  the authors "find that the bid-ask bounce and the degree of market liquidity explain short-term price reversals" and
  "securities with large one-day price declines perform poorly over an extended time horizon".
- **Savor (2012)**, "Stock returns after major price shocks: The impact of information", *Journal of Financial
  Economics* 106(3), 635-659 ([RePEc](https://ideas.repec.org/a/eee/jfinec/v106y2012i3p635-659.html)): "price events
  accompanied by information are followed by drift, while no-information ones result in reversals." This is the
  strongest outside reason to skip crashes caused by the company's own bad news.
- **Chan (2003)**, "Stock price reaction to news and no-news: drift and reversal after headlines", *Journal of Financial
  Economics* 70(2), 223-260: I could not read its abstract; I cite the title only.
- Limits: daily data, academic samples (mostly decades old), one-day or ten-day drops, no stops, and in Cox and Peterson
  the bounce is largely a measurement effect of the bid-ask spread. They say a short bounce after a big drop is real but
  small and brief, and that news-driven drops keep falling.

### 4.4 Bracco's own numbers (house observations, not published studies)

- **His short-side extension table** (image in "The Parabolic Short", read by me; "from the close before the climax
  day"): seven large caps (MSTR 2024-11-20, NVDA 2024-03-08, SMCI 2024-02-15, MRNA 2020-11-30, TSLA 2020-02-03, TASR
  2004-04-16, QCOM 1999-12-31). ATR multiples above the 50-day from 7.36 (MSTR) to 10.3 (TSLA), average 8.81; average
  21% above the 9 EMA, 37% above the 20 EMA, 77% above the 50-day, 172.5% above the 200-day (table re-read on the
  check: every figure matches). He uses a 20-day ATR ("I plot it as a histogram and use a 20-day ATR", Sunday Scans
  [2025-06-15](https://unchartedterritoryy.substack.com/p/sunday-scans-744), his section). For a long mirror, % figures cannot mirror (a stock
  cannot fall 77% below its 50-day as easily as it rises 77% above it); the ATR multiple can.
- **Index bottoms:** "intermediate corrections will typically find a tradable bottom around an average of -3 ATR’s below
  the 50-day. During major corrections or crashes such as Covid, 2022 bear market, or the Tariff Crash, this reading can
  hit -5 or lower." (2026-03-22). No sample or method given.
- **The 9 EMA claim** (short side): "Every parabolic short I’ve analyzed reaches the daily 9EMA before any
  counter-trend rally emerges" (his studies; count not given). Our test (4.7) shows the mirror is NOT true for longs.

### 4.5 A third-party backtest (short side only, low weight)

Niv Goren, ["Systemizing Kullamägi’s Parabolic Short Setup"](https://stonkscapital.substack.com/p/systemizing-kullamagis-parabolic)
(Substack, 2025-02-10): a system "since the end of 2007" with 1,869 trades, CAGR 27.7% and max drawdown -20.9%, after
"mixing a few variations". The exact rules are withheld ("if it doesn’t include me revealing the exact rules I used"),
and he used ChatGPT to simplify his data request. Short side only. Low reliability; not evidence for the long.

### 4.6 Numbers that are NOT evidence

- Kullamägi's "These things can bounce 50-100% in a few days." is his experience, not a measured rate.
- Our app's `parabolic_short.py` narrative says Kullamägi's "published track record on parabolic shorts" "shows a 55-65%
  win rate with average winners producing 30-60%" declines, and quotes him: "when you see vertical moves on huge volume
  with the day closing red after a gap up, that's the signal." (that string is split across two code lines in the file).
  I found neither on qullamaggie.com, and dossier 18 found
  invented quotes in the sibling `kell_cycle.py`. Treat both as unsourced; do not reuse them for the long.

### 4.7 Our own test on daily bars (new, for this dossier; not a published statistic) [measured]

**Method.** The app's sandbox daily bars (`bars.db`, read-only): 4,002 symbols with at least 260 bars, 1984-09 to
2026-11. A candidate is any day t that opens below the prior close after at least two down closes. I score Bracco's five
boxes mirrored: (1) down closes on t-3, t-2, t-1; (2) two consecutive gap downs among t-2, t-1, t; (3) two of the days
t-3..t-1 lose more % than the day before; (4) volume rising t-2 < t-1 < t; (5) the climax day gaps down at least 1%.
Stretch = (close t-1 minus the 50-day SMA) / ATR(20). Liquid = close at least $10 and 20-day average dollar volume at
least $20M (B23). Two daily-bar versions of the buy:
- **A, the V day:** the climax day closes above its open; buy that close; stop a cent under its low.
- **B, the day-2 gap up:** the climax day closes below its open; the next day opens above that close; buy that open;
  stop a cent under the climax day's low.

Outcomes over the next 10 sessions; on a day that touches both the stop and the target, the stop counts first. "9 EMA"
means reaching the 9 EMA's value on the entry day before the stop.

**Hit rates (version A unless named).**

| Group | Trades | Dates | 9 EMA before stop | 2R before stop | 3R before stop | Stopped in 10 days | Next day, mean |
|---|---|---|---|---|---|---|---|
| All candidates (A) | 834,790 | 7,883 | 35.6% | 31.3% | 21.3% | 69.2% | +0.06% |
| Control: 0-2 boxes, not stretched (above -1 ATR) | 293,909 | 7,794 | 27.6% | 31.2% | 21.5% | 71.6% | +0.05% |
| 0 boxes | 44,499 | 6,389 | 29.7% | 31.5% | 21.8% | 72.6% | +0.05% |
| All 5 boxes | 14,379 | 3,513 | 41.7% | 28.6% | 17.9% | 61.0% | +0.04% |
| 5 boxes, liquid | 6,100 | 1,625 | 41.6% | 28.1% | 17.3% | 61.9% | +0.04% |
| 5 boxes, stretch -5 ATR or more | 1,617 | 654 | 36.4% | 29.1% | 16.2% | 58.3% | +0.80% |
| 5 boxes, stretch -7 ATR or more, liquid | 151 | 83 | 41.1% | 33.1% | 19.2% | 55.0% | +2.48% |
| 5 boxes, stretch -9 ATR or more, liquid | 22 | 19 | 50.0% | 40.9% | 27.3% | 45.5% | +4.59% |
| 5 boxes, fell 40%+ in the 5 days before | 85 | 55 | 49.4% | 42.4% | 22.4% | 40.0% | +6.32% (median +0.90%) |
| 5 boxes, below the 200-day | 9,075 | 2,487 | 40.7% | 29.2% | 18.4% | 61.0% | +0.05% |
| 5 boxes, above the 200-day | 5,304 | 2,022 | 43.3% | 27.6% | 17.1% | 61.0% | +0.02% |
| Version B, 5 boxes | 8,255 | 2,302 | 27.0% | 27.4% | 19.5% | 75.9% | -0.27% |

**Average result per trade, in R (version A, no costs).** Three exits: all out at the 9 EMA; all out at 2R; and a
house-style exit (a third at 3R, a third at 5R, the rest on a close under the 10-day EMA, breakeven after 3R, 20
sessions at most). A stop gapped through fills at the open (worse than -1R). Otherwise out at the 10th close (20th for
the house exit).

| Group | Trades | 9 EMA exit | 2R exit | House exit |
|---|---|---|---|---|
| 5 boxes | 14,379 | +0.05R (49.0% win) | +0.06R | +0.05R |
| 5 boxes, stretch -5 or more, liquid | 664 | +0.20R | +0.15R | +0.15R |
| 5 boxes, stretch -7 or more, liquid | 151 | +0.62R (49.7% win) | +0.31R | +0.44R |
| 5 boxes, fell 40%+ in 5 days | 85 | +0.73R (61.2% win) | +0.55R | +0.36R |
| 5 boxes, liquid, fell 25%+ in 5 days | 171 | +0.28R | +0.22R | +0.30R |

**Clusters.** These trades bunch on a few panic days, so the market decides most of the result. For 5 boxes and a
stretch of -5 ATR or more: 2015-08-24 (119 trades, average +0.98R, 86% winners at the 9 EMA exit); 2020-02-28 (147
trades, -0.79R, 14% winners: the crash had weeks to run); 2015-08-21, the Friday before the 2015-08-24 crash open (15
trades, -2.55R, no winner: the Monday gap went through every stop); 2026-10-15 (18 trades, -0.48R). Counting each date
once (654 dates), the 9 EMA exit averages +0.16R.

**What it says.**
1. The five-box checklist on its own, bought at the close of a V day with a day-low stop, is close to break-even
   (+0.05R). It raises the chance of touching the 9 EMA (29.7% with no boxes, 41.7% with all five) but not of making
   2R or 3R.
2. **The size of the fall is what pays.** Results improve only at the extremes: a stretch of -7 ATR or more (liquid) or
   a 40%+ fall in five days. That matches Kullamägi (50-60%+), Bracco (40-50%) and Bulkowski ("say over 30%").
3. **The 9 EMA is not a magnet on the long side.** Bracco says every parabolic short reaches it; here only about 4 in 10
   longs reach it before the day's low breaks.
4. **The day-2 gap up, bought at the open with the prior low as the stop, is worse** than the V day in every slice. Our
   daily test cannot see an opening-range entry, which is what UCT actually did; this needs intraday data.
5. **Above or below the 200-day makes little difference** to these numbers. B26's exception is not harmful, but it is not
   a source of edge either; the market around the trade is.

**Limits.** Daily bars only: a close entry, not Bracco's intraday VWAP entry with its smaller risk. Survivorship: the bar
store holds today's symbols, so names that went to zero are mostly missing, which flatters bounces. Prices are
split-adjusted, so the $10 test mis-sorts old data. No commissions or slippage. Many trades share a date, so they are
not independent. Box definitions are my reading of Bracco's words. Scripts and outputs are in the scratch folder named
in section 11.

### 4.8 Our own test of the VWAP-reclaim entry on 5-minute bars (new; small and recent) [measured]

**Method.** 5-minute bars for the 1,000 most-traded names ($10+, $20M+ a day), 2026-08-17 to 2026-11-06 (the only
5-minute history we have). Candidates: climax days from 4.7 with at least 3 boxes. Entry: after 10:00, the first
5-minute bar that closes back above the session VWAP after trading below it. Stop: a cent under the day's low so far.
Exit: the daily 9 EMA (its value the day before), the stop, or the 10th session's close.

| Group | Trades | Dates | Average R | Winners | Stopped | Median risk |
|---|---|---|---|---|---|---|
| 4+ boxes | 759 | 53 | -0.05R | 26.4% | 73.3% | 1.50% |
| 5 boxes | 128 | 29 | -0.20R | 23.4% | 75.8% | 1.88% |
| stretch -5 ATR or more (3+ boxes) | 142 | 32 | +0.43R | 30.3% | 69.7% | n/a |
| fell 20%+ in 5 days, 4+ boxes | 38 | 11 | -0.87R | 7.9% | 92.1% | n/a |

On 2026-10-15, the "neoclouds" gap-down day Bracco watched, 23 entries in names that had fallen 20%+ in five days (NBIS,
CRWV, IONQ, RGTI, KORU, SOXL and others): 22 hit the stop. Bracco's own account of that day: "only got one day of glory
before pushing back towards lows." Limits: three months, one market phase (a correction that took the Nasdaq under its
200-day in November), a mechanical stand-in for judgement. It shows how the setup fails in a fresh breakdown; it does not
measure the setup in a true capitulation.

---

## 5. Our app

### 5.1 No Parabolic Long scanner

There is no `parabolic_long` detector in `api/services/pattern_engine/detectors/`. The name exists only as a Model Book
card, a journal tag, a label in the chart-vision prompt (`api/services/voice_chart_vision.py`, an undefined name in a
list), a taxonomy entry (`api/services/desk_session_insights.py`) and the course files (`docs/curriculum/
uct_method_scripts.json`, `uct_method_chapters.json`, `uct_method_course.json`, `curriculum_final_v2.json`; section
5.5). Three nearby pieces of code do exist.

### 5.2 `uct_capitulation.py`: the closest live scanner (member-visible as the "Capitulation" setup tag)

File: `api/services/pattern_engine/detectors/uct/uct_capitulation.py`. Its docstring: "A rubber-band long: a stock that
has been liquidated so hard and so fast that it is stretched far below its own volatility band". `setup_tags.py` shows
members "A wide-range flush that closes far below the lower Bollinger Band after a multi-day slide." (the setup-tag
feature was armed in production on 2026-10-24 per `docs/feature_flags.json`; members get bullish rows only, under the
further conditions that note lists).

What it tests, faithfully:
- **Setup day:** the close is more than 1 ATR below the lower Bollinger band (20, 2); the range is at least 2 ATR, or the
  drop from the prior close is at least 2 ATR; the 3 sessions before fell at least 1.5 ATR (a "cascade"); and at least one
  of: three down closes each bigger than the last, record volume (the highest of up to 252 prior sessions, needing at
  least 190), or volume 2x its 50-day average rising across three down days. Vetoed if volume has been falling, unless
  it is a record.
- **Gap below:** the next session opens below the setup day's low.
- **Labels only:** a 3-day 15% drop from above the 50-day (`three_day_drop_from_trend`, the constant is named
  `CAP_JERSACE_DROP`), a 0-5 star count, open down gaps, the ATR stretch from the 50-day.
- **Levels:** "Entry: the close. Stop: the session low." Targets 2R and 3R (`make_levels`). A liquidity floor applies.

**Where it disagrees with the house definition.**
1. It buys the close of the flush day. Bracco's mirror buys only after the turn and requires a gap down on the climax
   day; this scanner requires neither.
2. Its core test (a CLOSE more than 1 ATR under the lower band) rules out the V day itself: a climax day that turns up
   closes back inside or near the band.
3. It has no blow-off-unwind context: a stock crashing from far above its averages never gets under the lower band.
4. **I ran its own `evaluate()` on 13 model examples** (GBTC 2017-12, QQQ 2024-08, QQQ/TQQQ/SOXL 2025-04, TQQQ 2026-03,
   SOXL and KORU 2026-06, CAR 2026-04, AGQ 2026-02, IGV 2026-02, UAMY and USAR 2025-10, NFLX 2015-08). It fired on
   three, all in the April 2025 crash: QQQ and TQQQ (a `setup_day` on 2025-04-04, 5 stars, and a `gap_below` on 04-07)
   and SOXL (`gap_below` on 2025-04-04). (The first draft said two and left QQQ out; the cold check re-ran the script.)
   It missed Kullamägi's GBTC, Bracco's QQQ 2024-08-05, the owner's TQQQ 2026-03-30/31 and Bracco's SOXL/KORU June 2026.
5. Its docstring still says "INTERNAL (admin-only)"; `setup_tags.py` and the flag note in `docs/feature_flags.json`
   show it has been a member-visible tag since 2026-10-24. The docstring is stale.
So the live "Capitulation" tag is a different, narrower setup. It should not be presented as the Parabolic Long.

### 5.3 Chart IQ's `capitulation_long` label

File: `api/services/chart_iq/engine/v3.py` (the Chart IQ overlay: admins while `CHART_IQ_ENABLED` is on, paid members
while `CHART_IQ_MEMBERS_ENABLED` is on too, per `api/routers/auth.py`). A "reversal
candle" is a day (today or yesterday) whose low is at or under the prior 10 lows, that closes in the top 40% of its range
and above its open. If that close is also 25% or more under the highest close of the prior 20 days and volume is at least
2x its 50-day average, the label `capitulation_long` is added (the `EVENT_SETUP` table maps "Capitulation reversal" to
it). No gap, no multi-day burst, no volume expansion, no entry or stop. It is closer to the V day than `uct_capitulation`,
but it is a label, not a setup.

### 5.4 `parabolic_short.py`: the mirror the long would copy

File: `api/services/pattern_engine/detectors/uct/parabolic_short.py`. It tests a single climax bar: a 100%+ gain over 30
bars, range over 3x the average daily range, a close in the bottom 30%, volume 3x, a 3%+ gap up that closes red. Entry
just under the climax low, stop 1% over the climax high, target the lowest low of 50 bars. This is not Bracco's burst
(no three-day count, no two gaps, no range or volume expansion, no VWAP, no 9 EMA target), and its narrative carries the
unsourced quote and win rate noted in 4.6. A long scanner should not be built by flipping this file. The short's own
dossier (39) covers it.

### 5.5 The Model Book card, the journal and other house texts

- **Model Book card** (`app/src/pages/modelbook/setupCatalog.js`): "Parabolic Long", family "Reversals & Reclaims",
  essence "Riding the steepening curve of a runaway move" ... "managed bar by bar as the angle goes vertical." The glyph is
  ten rising, accelerating up candles. **This is the opposite of the ruling.** (Dossier 18 already flagged it.)
- **The Parabolic Short card** next to it is consistent with Bracco: "shorted as it cracks, targeting the snap back to
  the 9 EMA."
- **Journal tag** (`app/src/constants/setupGroups.js`): "Parabolic Long" is in the Swing list. **Journal plan**
  (`app/src/pages/journal-2-0/lib/setupTagMap.js`): `'Parabolic Long': null`, so a member who tags a trade gets no plan
  or checklist. The short has `parabolic-short-plan`.
- **`docs/study/research/definitions.json`** ("Parabolic Long"): "Riding a near-vertical run and leaving before the
  blow-off." Also the opposite of the ruling.
- **The UCT Method course** (`docs/curriculum/uct_method_scripts.json`, the module labelled "M10 · Setup Family IV:
  Reversals & Reclaims — and the Short-Side Mirror", its sixth lesson): "Parabolic Long: Riding the Vertical, Bar by
  Bar" (TSLA, January 2020). And `curriculum_final_v2.json` describes "a Parabolic Long as a topping tell
  on a position you already own". Both contradict the ruling.
- **The chart scan catalogue** (`app/src/components/chart/engine/ast/starterScans.json`) is the one house text that
  agrees: "Parabolic Long is the same stretch measurement as Parabolic Short taken from the other side". It adds that no
  threshold has been written down.
- **`docs/study/TRADE_PLANS.md`** has no row for either parabolic setup.

### 5.6 What looks wrong, in one list

1. The Model Book card and glyph, `definitions.json`, and the course lesson teach a different setup under this name.
2. No scanner tests the ruled definition; the live "Capitulation" tag misses most model examples (5.2).
3. The journal tag has no plan, so members' parabolic-long trades are unmeasured against any rule.
4. The short detector's narrative carries an unsourced quote and statistic (4.6).
5. If a scanner is built, it should test the burst (five boxes), the gap-down climax, and the stretch or the % fall, and
   flag the day; the buy is intraday and needs the 5-minute bars.

---

## 6. UCT's own words

### 6.1 The owner (TSDR)

Rulings (2026-11-09, `owner_verdicts.jsonl`):
- B26: "SHort I will only do if below the 200SMA. No longs below 200SMA (unless parabolic long) no shorts above 200SMA
  unless parabolic short." and "200SMA is hardened rule yes".
- What counts as parabolic: "parabolic ids a parabolic short you can read bracco's substack post to determine a parabolic
  short and long." The mirror: "1, yes."
- C31 (leaders with RS 80+): "31, yes unless parabolic or mean reversion."
- C34 (sell into a climax on your own long): "34, yes but depends."
- D47: "47, yes but that is parabolics. Shorts are the same just reversed for almost all our setupstuff."

Sunday Scans (his section, "TSDR’s Weekly Outlook & Watchlist"):
- 2026-03-22 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-cab)): "Like Bracco’s write up and waiting
  for that washout upside trade to come. That is deliberate and I look forward to participating in that."
- 2026-03-29 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-352)): "This week I will be dialed in on
  TQQQ oversold bounce/mean reversion." On TQQQ: "Two day burst lower but really a mini two wave burst if you factor in
  last week 3 day move then rest then this week’s move." "Extended below 5SMA, 9EMA, 20EMA, 50SMA. Outside completely
  lower Bollinger band. Not bottom calling, but stretched and a very viable reversion trade opportunity here." "Some of
  the biggest bursts occur in bear markets." "Think we really have to keep a 2-3 day outlook until proven otherwise." On
  META: "Probably stupid, but there is an edge in significant asymmetric mean reversions. Bracco is skilled at them.
  Everyone wants to ask about parabolic shorts. What about this big mean reversion long here!" And, the same day:
  "Generally, below the 200SMA no participation is best."
- 2026-04-05 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-356)): "Came into the week pretty adamant
  (Read Last Week’s SS) that we were likely to get a snapback rally. Was able to get positioned in TQQQ with this insane
  entry price." "Tuesday’s gap up gave a very good opportunity on the intraday pullback and was a textbook Brian Shannon
  Gap Up against intermediate trend." "Then Wednesday we drifted higher into the 20EMA and stalled a bit, not surprised
  that was quite the two day snapback."
- 2026-11-01 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-669)), on shorts: "With shorts, I am
  extremely picky and try to get 1-2 per cycle when they are presented. I want them below the 200SMA for sure".
- 2026-11-08 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-70f)): "When you lose the 200SMA you often
  see extreme volatility. Range in stocks and the indexes can expand 2-3X with very large sudden moves to the upside and
  downside." "Some of the best traders I know often suggest 0 activity below the 200SMA. Literally 0." "all that I am
  doing is looking for 1-3 day opportunities, if anything". "I will gladly try some Reversal Extensions, Upside Reversals,
  Relative Strength names as they pullback and give me a good spot." "I would honestly recommend neither but I like to
  keep myself in tune with the tape so I often try something here and there if it is an A+ setup in my playbook."

Checked on our bars: TQQQ fell 7.1% (2026-03-26) and 5.9% (03-27), then 2.3% more on Monday 03-30 (low 37.32), about
-4.5 ATR under its 50-day and 23% under its 200-day; Tuesday 03-31 gapped up 3.2% and closed +10.0%; it reached its 9 EMA
on 04-01 and traded 41% above the 03-30 close within 10 sessions. QQQ was under its 200-day throughout.

### 6.2 Bracco

**"The Parabolic Short"** (2025-06-13): all of section 3.1. Also: "There are various types of mean reversion trades,
but today I’m focusing on my 5-star Parabolic Short setup" (so the post is about one kind only).

**The long side, chronologically** (his section, "Bracco’s Breakdown & Top Ideas", unless named):
- 2025-10-12 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-296)), ETH after the October 10 crash:
  "With parabolic mean reversions being my specialty, this was a 5-star trade opportunity, specifically on ETH." And:
  "it is uncommon to see downside continuation immediately following a liquidation and panic of that magnitude."
- 2025-10-19 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-6cc)): "In some cases, stocks that set up
  for a parabolic short and blow off at the highs can actually turn into parabolic/mean reversion longs in just a couple
  of days." "USAR ABAT UAMY interest me after weak closes on Friday on their 4th down day after 40-50% drawdowns." "If
  these see a signifigant gap down Monday I think it can set the stage for a quick snap back rally of 30-50%." "These are
  short lived trades and not meant to be held longer than 1-3 days." Header: "UAMY USAR ABAT - Rubber band longs".
- 2025-11-05, "The Rest of the Week", his section "Bracco - ETHA ETHU" ([link](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9)):
  "Think potential rubber band / capitulation long setup here for a short term trade opportunity."
- 2025-10-26 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-13e)), the week after the UAMY/USAR/ABAT
  call, a different use of the words: "The big theme early-mid last week was some rubber band / mean reversion longs on
  some short term oversold momentum leaders such as IREN CIFR NBIS LEU BE HOOD etc. These all staged MAU&R’s (moving
  average undercut and rallies)". Pullbacks to the 10-week average in leaders, not a burst down (section 3.2).
- 2025-12-28 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-249)): "Think of stocks like rubber bands,
  the further you stretch one apart, the harder it will snap back, the same philosophy applies with stocks."
- 2026-01-25 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-7fb)), on the silver blow-off, writing as
  a short seller: "I just know through vigorous studying that parabolic advances often go further than anyone thinks.
  For that reason, I never add when I am down and always pyramid into weakness as the price validates my conviction."
  On his AGQ short (2026-01-18, [link](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1)): "I shorted AGQ
  shares as my vehicle which resulted in 3 failed attempts over 2 sessions."
- 2026-03-08 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf)), the VIX levels he uses: "I have two
  main levels that I really pay attention to on the VIX. The first one being 30. Anytime we get a fast move up into 30
  it is usually a good time to start paying attention for a mean reversion opportunity." "The second big level is 50."
- 2026-01-18 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1)), FIGR (the intraday kind, see 3.2):
  "This is the ATR mean-reversion long setup I use to get exposure to powerful, trending leaders". His checklist at the
  low: "A Cascading sell off (parabolic curve)", "Increasing volume on each leg lower", "Extreme 244% ATR move", "600%
  above avg 5-minute volume", "Retesting the prior all-time high", "$50 psychological level". "Entry around 49.81, stop at
  49." "SNDK was the lesson, FIGR was the exam." "My original plan was to trail the 20EMA and look for re-add spots."
- 2026-02-04, "The Rest of the Week", "Bracco - IGV" ([link](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-732)):
  "IGV (Software ETF) - Setting up a potential mean reversion long opportunity this week." "IGV traded it highest volume
  in its 26-year history today on its 6th consecutive down day and 4th consecutive down weak."
- 2026-03-22 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-cab)): the criteria in 3.2, plus the max
  pain undercut: markets "typically like to undercut big support areas before reclaiming (if they do). The max pain
  scenario." "We also have what I call the “Monday Effect” going for us, where through my studies notable capitulations
  and turns have occurred on a Monday".
- 2026-04-26 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-f2d)), CAR: "After falling -77% in 3 days
  this may be setting up for a parabolic long trade at some point in the next 1-2 weeks I would imagine." "$200 undercut
  area of interest. Huge volume capitulation on Thursday." "It is usually either a fast multi-day bounce like AGQ in
  February, or it builds out a super tight range for a few weeks like GME and BMNR."
- 2026-06-07 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-d16)): "SOXL down -36% in just 2 days and
  worth watching for a mean reversion long next week." "Ideal situation is a gap down or further weakness before the
  turn." "given the recent parabolic advance I would expect a very sharp rebound off the lows".
- 2026-06-14 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-e95)): "Currently only have SOXL long at
  around $202 average from Thursday morning." "I viewed Thursday’s broad gap up as a potential kicker candle with short
  term positioning and sentiment caught offsides." "Only regret was not being willing to try the SOXL idea on the
  intraday turn Tuesday as market got very extended down after an already -7% move in less than 3 sessions."
- 2026-06-21 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-bc0)): "From the recent June lows:" "SOXL
  +77%" "KORU +85%". "I trimmed 25% of my position for a 40% gain from $202 entry on 6/11." "I have moved my stop in
  profit to last weeks low".
- 2026-08-02 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-cd2)): "Given that I excel in trading the
  market turns, especially the upside reversals around fear and panic". "Turns out the thesis was on point, but the
  timing and execution was not."
- 2026-10-25 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-36e)): "Was very interested in mean
  reversion trade on neoclouds into the 10/15 gap down and only got one day of glory before pushing back towards lows."
  "These are pretty extended below 50sma but short term not really setup great."
- 2026-11-01 ([link](https://unchartedterritoryy.substack.com/p/sunday-scans-669)): "I personally did not view Friday as
  a good opportunity to try bounce/mean reversion long plays. Was only second day down in a row as well as first day
  breaking down below a 3-month support level."
- On the ATR metric (2026-05-10, [link](https://unchartedterritoryy.substack.com/p/sunday-scans-68a)): "ATR multiples
  above the 50MA from Jeff Sun beat simple percent gains because they adjust for the stock’s unique volatility."

**Discord, as summarised by the brain** (summaries, not his words, except where marked):
- KB 11186 (2025-03-15): his annotated QQQ study of the August 2024 bottom, labelling 2024-08-05 'Day 3 parabolic burst
  lower with two open gaps' (his chart label, as the record transcribes it), "NQ -6.5% overnight, gapping below the
  200ma". The record is cut off there in every copy in this repo, so nothing more from it is quoted. Checked on our
  bars in 9.2, example 2.
- KB 11061 (2025-02-25, summary): mean-reversion bounces work best when the indexes are also stretched down; he takes
  them at size only on a 5-star capitulation event.
- KB 12095 (2025-12-01, his words): "i think most traders are not as good at that and woudl rather buy the wedge pop into
  a new uptrend versus the oversold bounce."

### 6.3 Unsigned notes and contributors

- 2026-04-01, "The Rest of the Week", "Thoughts on the Market" (unsigned; [link](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-13b)):
  "Snap back expected, was trickier to trade than preferred given the overnight move but easy when you know what to look
  for and it did the classic Gap Reversal Against Intermediate Trend from Brian Shannon." "A setup we have used for quite
  some time with great success."
- 2026-11-08, "Index & ETFs" (unsigned): "Below the 200SMA is danger." "At this point we are waiting for capitulation,
  Follow Through Day, and Webby’s Checklist to signal active participation again."
- 2025-11-26, Manrav's idea ([link](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-22a)): "Bottom
  fishing/Snap back trade idea." (a contributor, not a house rule).

---

## 7. How it fits the owner's account rulebook (section 9)

| Rule | How it applies | Conflict? |
|---|---|---|
| **B26** (no longs under the 200-day, hard) | The parabolic long is the named exception. Many of the best examples are above the 200-day anyway (blow-off unwinds: GBTC, SOXL, KORU, CAR, AGQ). | No; but the course must say the exception is narrow (section 8.1 R8) or every falling stock becomes a "parabolic long". |
| **C31** (RS 80+ leaders) | Exempt by his words: "unless parabolic or mean reversion". | No. |
| **B23** ($10+, $20M+ a day) | Bracco's own examples include ABAT (about $5) and KORU ("Not the best liquidity there and spreads can be awful sometimes"). | **Yes.** Recommend B23 holds; it also removes the small caps where the setup is "more common" but which Bracco avoids. Question 7. |
| **A3, F62** (stop a few cents under the day's low) | Exactly the mirror of Bracco's stop over the day's high. | No. |
| **A13** (stops usually within about 3%) | On a VWAP-reclaim entry our 5-minute test found a median risk of 1.5-1.9%. A close entry on a V day is wider (median 3.5% for 5-box trades, 4-6% when very stretched). Bracco's SOXL entry at about $202 sat about 5% over that day's low (192.30). | Sometimes. Size from the stop (A5); skip if the honest stop does not fit (A3). |
| **A5** (one full position at one price, no adds) | Bracco's short takes a second entry at the day's low; the mirror would add over the day's high. | **Yes.** Recommend A5 wins: one entry. Question 3. |
| **E57** (market orders) | The trigger is intraday; a market order when it prints. | No. |
| **C28** (no chasing over 4% past the buy point) | The buy point is the VWAP reclaim (or the opening-range high). | No. |
| **C29** (skip longs over 10% above the 10-day) | Never applies; the stock is far below. | No. |
| **B19, E51, E52** (breakeven 2R-5R; thirds at 3R and 5R; trail the 10/21-day) | The setup has a near target (the 9 EMA) and a 1-3 day life. Our test: the house exit and a 9 EMA exit average about the same, but the 9 EMA is often under 3R away. | **Yes.** A setup-specific exit is needed. Question 4. |
| **C33** (time stop: under 1R after 10 days) | Bracco 1-3 days; the owner a 2-3 day outlook. | **Yes.** Recommend 3 sessions. Question 5. |
| **C34** (sell a big part into a climax on your own long) | The same instinct in reverse: take most of it into the snap back. | Fits. |
| **B20** (gap through the stop: first 30-minute low, out past 2R) | Overnight holds after a crash are exposed to more gap downs (2015-08-21 in 4.7). | Applies. |
| **B22** (no buys in the 3 days before earnings) | Applies; and a crash ON earnings is the news-driven kind to skip (Savor). | Applies. |
| **B18, F65, D46** (market reading: Orange only A+, Red mostly cash and shorts) | Index capitulations, the best parabolic longs, come in Red or Orange markets. The owner traded TQQQ in one. | **Yes.** Question 6. |
| **E54** (leveraged ETFs preferred) | Most of UCT's own parabolic longs were in 3x ETFs (TQQQ, SOXL, KORU, AGQ, ETHU, LABU). | Fits. |
| **E56** (at most 3 tries a week, 6 a month, on one name) | Bracco took "3 failed attempts over 2 sessions" on his AGQ parabolic short (2026-01-18, section 6.2); the same cap fits the long. | Fits. |
| **D47** (shorts are the long setups reversed; the parabolic short has its own stop and target) | This dossier is that rule run backwards. | No. |
| **E49, D38** (risk by grade) | Kullamägi calls it "by far the riskiest setup"; most should be B size. | Question 11. |

---

## 8. Proposed rules for our course

Each line is measurable. The owner's ruling (Bracco's burst, mirrored) is the frame; the rest fills in what the post
does not say.

### 8.1 What it is

- **R1 Instrument.** A stock or ETF (leveraged ETFs welcome) at $10 or more trading $20 million or more a day. [house rule
  B23, E54] Prefer mid and large caps and broad or sector ETFs. [UCT: "I prefer mid-to-large cap stocks."]
- **R2 Context, one of two.** [UCT; originator]
  - **(a) Blow-off unwind.** In the prior 20 sessions the stock was a parabolic-short candidate (up 50%+ in days or weeks;
    the house short table averages 8.8 ATR over the 50-day) and has now fallen at least 40% from its peak in 2 to 5
    sessions. A+ needs 50% or more. [UCT 40-50%; originator 50-60%+; measured: a 40%+ five-day fall was the best group]
  - **(b) Capitulation in a decline.** The close before the climax day is at least 3 ATR(20) under the 50-day SMA for an
    index ETF, or at least 5 ATR for a stock or sector or leveraged ETF; 7 ATR or more for A+. [UCT -3 index, -5 crash;
    measured: results improve from -7]
- **R3 The burst down: count Bracco's five boxes, mirrored.** (1) three straight lower closes before the climax day; (2)
  two consecutive gap-down opens (the climax day can be the second); (3) two of the three burst days lose a bigger % than
  the day before; (4) two days of rising volume, each higher than the last; (5) a gap down on the climax day. **Box 5 is
  required for the main version** (Bracco: "I won’t short without that gap-up"); the day-2 variant (B2 alternative 2)
  replaces it with a gap UP on the next day. Two down days can stand in for three if range and ATR expand sharply.
  [UCT by ruling] Note: both of UCT's own documented trades (the owner's TQQQ, Bracco's SOXL) were day-2 entries whose
  flush day opened UP, not down (section 9.2). Question 13.
- **R4 Length.** The burst is 3 to 5 sessions; the climax usually comes on day 3 to 5. [UCT]
- **R5 Shape.** The fall accelerates (each leg steeper, little bar overlap), not a stair-step decline. An orderly,
  overlapping decline is not this setup. [UCT: "We are not in any way, shape, or form “parabolic” do the downside."; Bulkowski's
  "steep drop" with little overlap]
- **R6 Volume.** Rising through the burst; the climax day's opening 5 or 15 minutes are the heaviest of the run; the day
  ends at 2x its 50-day average volume or more. [UCT mirror for the opening volume; my proposal for the 2x]
- **R7 Location.** Below the 9 and 20-day EMAs by construction. The 9 EMA must sit at least 2R above the planned entry,
  else there is no room to the target. A close under the lower Bollinger band on the day before is a plus. [my proposal;
  UCT for the band]
- **R8 The 200-day.** May be above or below it (B26's exception). Below it, only context (b) qualifies, and only when the
  index or the sector is capitulating too. [house rule; my proposal for the narrowing]
- **R9 Not a news break.** Skip when the fall is the company's own bad news (earnings, guidance, fraud, a failed trial).
  Market panics, leverage unwinds, sector liquidations and squeeze unwinds qualify. [my proposal from Savor 2012 and
  O'Neil]

### 8.2 The buy

- **B1 Day.** The climax day (the gap down). [UCT]
- **B2 Trigger, default.** After the low is in, the first 5-minute bar that closes back above the session VWAP. Never
  before the turn. [UCT, mirror of Bracco's VWAP rule and the "Right Side of the V"]
- **B2 Alternative 1.** Kullamägi's: a break of the opening-range high or the first green 5-minute candle. [originator]
- **B2 Alternative 2, the day-2 gap up.** If the climax day closes weak, near its low, buy the next day's
  opening-range-high break while the gap stays unfilled. [UCT: the owner's TQQQ 2026-03-31, Bracco's SOXL 2026-06-11;
  mirror of Bracco's "day 2 gap down"]
- **B3 Order and size.** A market order when the trigger prints; the full size at one price, no second entry. [house rule
  E57, A5]
- **B4 No chasing.** Skip it if price is already more than 4% over the trigger. [house rule C28]
- **B5 No front-running.** Do not buy the Friday before a possible Monday flush; Bracco's best turns come on Mondays.
  [UCT; measured: 2015-08-21]

### 8.3 The stop

- **S1** A few cents under the day's low (for the day-2 gap up: under that day's low, or the climax low if closer).
  [UCT mirror; house rule A3, F62]
- **S2** Size from the stop (A5). If the honest stop is more than about 8% away, skip; between 3% and 8%, size down by
  the formula. [house rule A3, A13; my proposal for the 8%]
- **S3** A gap through the stop: the first 30 minutes decide; out past 2R. [house rule B20]

### 8.4 Trims and trail

- **T1 Target.** The daily 9 EMA from below. [UCT mirror] Alternative: the 10/20-day averages. [originator]
- **T2 Recommended exit.** Sell two thirds at the first touch of the 9 EMA or at 3R, whichever comes first; trail the last
  third under each prior day's low. [my proposal; measured: the 9 EMA is reached before the stop only about 4 times in 10,
  so take it when offered]
- **T3 Breakeven.** At 2R. [house rule B19, lower end]
- **T4 Time stop.** Out at the close of the third session if the trade is under 1R. [UCT 1-3 days; my proposal for the
  number]
- **T5 Gap up past a trim level.** Take the trim at the open. [house rule F63]
- **T6 Holding longer.** Only if a new setup forms (a Wedge Pop, a tight range); then it is a new trade with its own stop
  and plan. [UCT: Bracco kept SOXL as a swing after it worked; my proposal for treating it as a new trade, per B21]

### 8.5 What invalidates it

- No gap down on the climax day: not the main version; only the day-2 variant (a gap up the next day) is left. [UCT by
  ruling]
- A trade under the climax low (the stop). A new low means the selling was not done. [UCT mirror; Wyckoff: a lower
  secondary test means "new lows or prolonged consolidation"]
- The entry bar fails back under VWAP and the day's low breaks. [UCT mirror]
- The decline is linear, or it is only the first or second day of a breakdown from a top. [UCT, 2026-11-01]
- A news-driven collapse of the company itself. [my proposal; Savor]

### 8.6 The short mirror

The Parabolic Short (setup 39), Bracco's post as written: allowed above the 200-day (B26), stop over the day's high,
target the 9-day average (D47). The parabolic long is its mirror; both share the five boxes.

### 8.7 Best market conditions

- **Best:** the index is capitulating too: an index ETF at -3 ATR or more under its 50-day, a gap down of 1 ATR or more,
  a Monday, a fast VIX move into 30 (Bracco, 2026-03-08: "Anytime we get a fast move up into 30 it is usually a good
  time to start paying attention for a mean reversion opportunity."), deeply oversold breadth. [UCT] A crowded group unwinding all at once (3x
  ETFs, crypto, a hot theme). [UCT] Measured: the 2015-08-24 cluster averaged +0.98R.
- **Worst:** the first days of a fresh breakdown from a top, a slow grind lower, the start of a crash (2020-02-28 averaged
  -0.79R), a lone stock collapsing on its own news. [UCT; measured; Savor]
- **The market reading.** The best cases come in Orange or Red readings, where F65 says "Orange, only A+ setups; Red,
  mostly cash and shorts". Question 6.

### 8.8 Common mistakes

1. **Buying the knife.** Buying the gap or the low before the intraday turn. ("Shorting at the day’s highs can be a
   dangerous trap", mirrored.) [UCT]
2. **Too early in the move.** Day 1 or 2 of a breakdown; the "Quick Opening Range" turn that Bracco says often comes too
   early. [UCT]
3. **Calling a stair-step decline parabolic,** or judging by % alone. [UCT]
4. **Averaging down.** O'Neil (Motley Fool, 2002): "I will never average down in price." Bracco (Sunday Scans
   2026-01-25, on his parabolic shorts): "I never add when I am down". [source consensus: two sources, one of them UCT]
5. **Overstaying.** It is a 1-3 day snap back; the dead-cat bounce studies show the drop often resumes. [UCT; Bulkowski]
6. **Expecting the 9 EMA every time.** After a crash from far above, it can be out of reach (CAR, AGQ). [measured]
7. **Illiquid small caps** with wide spreads. [house rule; UCT]
8. **Buying a company's own bad-news crash.** [Savor; O'Neil]
9. **Holding over a weekend into a panic** that is not done (2015-08-21). [measured]
10. **Using the parabolic exception to buy any stock under its 200-day.** [house rule]

---

## 9. Grading

The owner ruled that grading is discretionary (E50: "It is discretionary and hard to define."). This is guidance from
the sources and our tests, not a checklist.

### 9.1 A+ versus B-

| | A+ | B- (or skip) |
|---|---|---|
| Burst | All five boxes, 3-5 days, accelerating | 3 boxes; no gap down on the climax day (skip) |
| Depth | Blow-off unwind down 50%+ in days, or stretch 7+ ATR under the 50-day | Down 20-30%, or 3-4 ATR (stocks) |
| Climax day | Gap down on a Monday, the heaviest opening volume of the run, a V back over VWAP, close in the top third | Weak close, no V; or a Friday with the weekend ahead |
| Market | The index capitulating too (-3 ATR or more, VIX spike) | Index calm or only starting to break down |
| Cause | Forced selling: leverage unwind, panic, squeeze unwind | The company's own bad news |
| Instrument | Liquid large cap or ETF (3x ETFs welcome) | Small cap, wide spreads, under $10 |
| Support | A big level undercut and reclaimed (prior high, round number, the 200-day) | No level |
| Risk | Stop within 3% (VWAP-reclaim entry); 9 EMA 3R or more away | Stop over 5%; 9 EMA under 2R away |

### 9.2 Ten worked examples, checked on our bars

Numbers are from our daily bars (split-adjusted). "Boxes" counts the five mirrored criteria.

1. **GBTC, 2017-12-22 (Kullamägi's own example). A+.** Above its 200-day (a blow-off unwind). Burst: 12-19 -12.8%
   (gap -6.4%), 12-20 -21.1% (gap -5.1%), 12-21 -25.6% (gap -7.3%): each loss bigger; volume rose every day (23.1M,
   25.8M, 26.9M, 28.5M, then 33.5M). Climax 12-22: gap -23.9%, low 11.47, 67% under the 12-19 high of 34.97, close 19.75
   (+47.5% from the open, in the top 3% of the range). Next session high 24.70 (+25% on the close), through the 9 EMA.
   Five boxes.
2. **QQQ, 2024-08-05 (Bracco's "Day 3 parabolic burst lower"). A+ (index).** Down 08-01 -2.4%, 08-02 -2.4% (gap
   -1.9%), 08-05 -3.0% (gap -5.4%); volume 1.7x, 2.0x, 2.6x its average. Opened at 424.71 under the 200-day (429.90),
   closed 435.37 above it, +2.5% from the open; 3.49 ATR under the 50-day. Touched the 9 EMA in 4 sessions; +10.6% at
   most within 10.
3. **QQQ and TQQQ, 2025-04-07 (the tariff crash Monday; Bracco's "April low"). A+.** QQQ gapped down 4.1%, 2.8% and
   3.3% on 04-03, 04-04 and 04-07; volume 1.8x, 3.0x, 3.9x; 5.7 ATR under its 50-day and 14% under its 200-day at the
   04-07 close, which was +3.7% from the open (TQQQ +12.2% from its open). 9 EMA in 2 sessions; QQQ +10.4% and TQQQ
   +29.5% within 3. Only two down closes before the climax: Bracco's two-day exception.
4. **TQQQ, 2026-03-30/31 (the owner's trade). A, day-2 gap-up variant, under the 200-day.** Details in 6.1. The 03-30
   low day opened 2.5% UP (39.75 over a 38.78 close) and closed in the lower quarter of its range, so box 5 was not met;
   the entry was the next day's gap up.
5. **SOXL, 2026-06-05 to 06-11 (Bracco's trade). A, above the 200-day.** 06-04 gap -13.7%, 06-05 -30.5% (two days
   -35%); 06-09 opened 7.4% UP, then flushed to 157.56 (QQQ's largest intraday sell-off since September 2020, per
   Bracco) and closed at 201.68, so no gap-down climax; 06-10 an inside day with a weak close; 06-11 gap up 6.4%, his entry about $202 (that
   day's low 192.30). 06-22 close 300.77. He trimmed a quarter at +40% and kept the rest. A pullback-capitulation in a
   bull market rather than a below-200 case.
6. **KORU, 2026-06-05 (Bracco). B.** 06-03 close 59.84 to 06-05 close 30.50 (-49%); low 29.45 on 06-09; then 06-11
   +33.8% and 06-15 +21.1%. Liquidity was his own caveat.
7. **UAMY, USAR, ABAT, 2025-10-17 (Bracco's "Rubber band longs"). B-.** UAMY 43% under its 10-14 high after three down
   days; USAR 37% after four; ABAT 57%. Monday 10-20 gapped UP (no gap-down climax): closes +20.0%, +13.9%, +38.6%, then
   UAMY and USAR fell back under their Friday lows within six sessions; ABAT gave back much of its gain (5.01 by 10-29)
   but held above its Friday low of 4.76. ABAT was about $5 (fails B23).
8. **CAR, 2026-04-24 (Bracco: "may be setting up"). Failed.** From the 04-22 high of 847.70 to the 04-24 low of 202.31
   (-76%) after a squeeze. 04-27 undercut $200 (low 182.00); 04-29 gapped to 157.16 and closed 181.15; 04-30 high 205.00;
   then down to 140.44 by 05-14. The 9 EMA (above 260 at the end of April) was not reached until 05-21. A lesson: after a
   squeeze crash, the 9 EMA can be far out of reach.
9. **AGQ, 2026-02-02/03 (Bracco: "a fast multi-day bounce like AGQ in February"). B-.** 01-30 -59.9% (gap -30.5%), 02-02
   low 131.78, 02-03 gap up 17.8%, 02-04 high 190.69 (+45% from the low), then 02-05 gapped down 27.8%. The 9 EMA (about
   234 to 270 over those days) was never in reach.
10. **NBIS and CRWV, 2026-10-15 (Bracco: "only got one day of glory"). Failed.** NBIS had all five boxes: three down
    closes, three gap downs (-4.6%, -5.7%, -5.7%), two bigger daily losses, volume 0.9x, 1.8x, 2.5x; 10-15 closed at the top of its range, +7.4% from the open. Next day -12.2%, a new
    low (163.27 under 163.36), and 149.48 by 10-26. CRWV closed +13.4% from its open that day, then made new lows. A
    perfect-looking daily V in a fresh breakdown (the Nasdaq lost its 200-day in early November).

One more from our test (not a UCT example): **AAPL, 2015-08-24.** Five straight down closes (the climax day included), a 10.3% gap down, 4.85 ATR
under the 50-day, close +8.7% from the open, +11.1% within 5 sessions; part of the best cluster in 4.7.

---

## 10. Questions for the owner

1. **Which falls count.** Your ruling is Bracco's burst, mirrored. Do both contexts count: (a) the unwind of a blow-off
   (Kullamägi's "any time a successful parabolic short goes down 50-60%+ in a few days"; often above the 200-day) and
   (b) a capitulation in a decline (index
   and ETF flushes; often under it)? And is Bracco's one-day intraday flush in a leader (FIGR, SNDK) a separate setup
   (Mean Reversion, setup 36)? Recommend: (a) and (b) here; FIGR-type in 36.
2. **The entry.** (a) the first 5-minute close back over VWAP after the low (recommended default); (b) Kullamägi's
   opening-range high or first green 5-minute candle; (c) the day-2 gap up (your TQQQ, Bracco's SOXL) as the named
   alternative; (d) the daily close of a V day (what a scanner can see).
3. **One entry or two.** Bracco's short adds at the day's low; A5 says one full position at one price. Recommend A5.
4. **The exit.** (a) two thirds at the 9 EMA or 3R, whichever first, trail the rest under prior daily lows (recommended);
   (b) all out at the 9 EMA; (c) the house thirds at 3R and 5R with the 10-day trail; (d) Kullamägi's 10/20-day.
5. **Time stop.** (a) 3 sessions (recommended); (b) C33's 10 days.
6. **The market reading.** These come in Orange and Red readings. (a) allowed in any reading when the index itself is
   capitulating (recommended); (b) Orange only, A+ only (F65 as written); (c) never in Red.
7. **Liquidity.** (a) B23 strictly, no ABAT-type names (recommended); (b) an exception for 3x ETFs with thin volume (KORU).
8. **Depth.** For blow-off unwinds: (a) 40% minimum, 50% for A+ (recommended); (b) Kullamägi's 50-60%+. For declines:
   (a) 3 ATR index, 5 ATR stock, 7 for A+ (recommended); (b) one number for both.
9. **The 200-day narrowing.** Under the 200-day, only when the index or sector is capitulating too (recommended), or any
   stock that passes the burst?
10. **The app.** (a) rewrite the Model Book card and glyph, `definitions.json` and the course lesson to the ruled meaning;
    (b) add a journal plan for "Parabolic Long"; (c) build a scanner for the burst and the gap-down climax (an alert; the
    buy stays intraday); (d) keep the "Capitulation" tag as a separate, narrower setup. Recommend all four.
11. **Size.** Kullamägi calls it "by far the riskiest setup". (a) B size at most unless A+ (recommended); (b) normal
    grading (E49).
12. **News crashes.** Skip falls caused by the company's own news (recommended), or judge case by case?
13. **Is the gap-down climax required?** The mirror of Bracco's "I won’t short without that gap-up" makes it required,
    but your TQQQ trade and Bracco's SOXL trade both bought the day-2 gap up after a flush day that opened UP. (a) Keep
    the gap down required for the main version and teach the day-2 gap up as a separate, named entry (recommended; it
    is what UCT actually traded); (b) require the gap down for both; (c) drop the requirement and grade it instead.

---

## 11. Sources

All read on 2026-11-09 unless stated. Reliability notes are mine.

| Source | Publisher / author | URL | Reliability |
|---|---|---|---|
| "The Parabolic Short" (2025-06-13) | UCT Substack / Bracco | https://unchartedterritoryy.substack.com/p/the-parabolic-short | House source by ruling; quoted exactly; the extension table read off its image |
| UCT Substack, all 103 sitemap posts (2025-06 to 2026-11-08), quoted posts linked in section 6 | Uncharted Territory: the owner (TSDR), Bracco, Manrav, unsigned sections | https://unchartedterritoryy.substack.com/sitemap.xml (read through the public post API) | House source; quotes checked by script; sections attributed by their headers |
| Owner rulings, 2026-11-09 | the owner | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` (repo) | Highest for house rules |
| Account rulebook | the owner | `docs/study/sizing_rule.md` section 9 (repo) | Highest for house rules |
| Brain knowledge-base extracts (KB 10873, 11061, 11186, 12095) | UCT brain summaries of Discord | `docs/study/levels/brain_kb_*.json` (repo) | Summaries, not words, unless marked; medium |
| "3 TIMELESS setups that have made me TENS OF MILLIONS!" (2021-01-08) and its GBTC charts | Kristjan Kullamägi, qullamaggie.com | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Originator; high |
| "The Wyckoff Method: A Tutorial" | StockCharts ChartSchool / Roman Bogomazov and Michael Lipsett | https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial | Established school of an originator; high for definitions |
| "Wyckoff Method" | Wyckoff Analytics | https://www.wyckoffanalytics.com/wyckoff-method/ | The same school; high |
| "Reversal Extension: How Stocks Bottom" (2024-06-11) | TraderLion, byline Oliver Kell (written in the third person) | https://web.archive.org/web/20250820211726/https://traderlion.com/technical-analysis/chart-patterns/reversal-extension-how-stocks-bottom/ | Established educator presenting the originator; medium-high |
| "Vertical Run Down" ("As of 11/06/2026" when written; "As of 11/09/2026" on the check) | Thomas Bulkowski, thepatternsite.com | https://thepatternsite.com/VerticalRunDown.html | Measured statistics; read through the fetch tool (curl refused, HTTP 406, both days); the site forbids AI training; medium-high |
| Dead-cat bounce page (dcb.html, same dates) | Thomas Bulkowski, thepatternsite.com | https://www.thepatternsite.com/dcb.html | As above |
| Sunday Scans 2025-06-15 (the 20-day ATR), 2025-10-26 (MAU&R "rubber band" longs), 2026-01-25 ("I never add when I am down"), 2026-03-08 (VIX 30 and 50) | UCT Substack / Bracco's section | https://unchartedterritoryy.substack.com/p/sunday-scans-744 · /sunday-scans-13e · /sunday-scans-7fb · /sunday-scans-dcf | House source; added in checking; quoted exactly from the post API text |
| "RSI(2)" | StockCharts ChartSchool (describing Larry Connors) | https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/rsi-2 | Established educator; high for what it reports |
| TMF interview with Bill O'Neil (2002-06-20) | The Motley Fool | https://www.fool.com/specials/2002/06/20/foolcom-tmf-interview-bill-oneil-special.aspx | Originator interview; high |
| Blog post on charting stocks correctly (the trend template; Internet Archive copy, 2019-04-26) | Mark Minervini | https://web.archive.org/web/20190426232311/http://www.minervini.com:80/blog/index.php/blog/show/first_things_first_how_to_chart_stocks_correctly_and_increase_your_chances | Originator; high |
| Bremer and Sweeney (1991), abstract | Journal of Finance, via RePEc | https://ideas.repec.org/a/bla/jfinan/v46y1991i2p747-54.html | Peer-reviewed; abstract only |
| Cox and Peterson (1994), abstract | Journal of Finance, via RePEc | https://ideas.repec.org/a/bla/jfinan/v49y1994i1p255-67.html | Peer-reviewed; abstract only |
| Savor (2012), abstract | Journal of Financial Economics, via RePEc | https://ideas.repec.org/a/eee/jfinec/v106y2012i3p635-659.html | Peer-reviewed; abstract only |
| Chan (2003), title only | Journal of Financial Economics, via EconPapers | https://econpapers.repec.org/RePEc:eee:jfinec:v:70:y:2003:i:2:p:223-260 | Abstract not available to me; not used for any claim |
| Chat With Traders episode 236 page (2022-06-27) | Chat With Traders / Lance Breitstein | https://chatwithtraders.com/236 | Confirms the concept's name only; no transcript |
| "Systemizing Kullamägi’s Parabolic Short Setup" (2025-02-10) | Niv Goren, Stonks Capital Substack | https://stonkscapital.substack.com/p/systemizing-kullamagis-parabolic | Third-party backtest, rules withheld, AI-assisted; low |
| Dossier 18 (Qullamaggie and Kell) | this repo | `docs/study/setups/research/18-qullamaggie-kell.md` | Earlier house research; used for cross-references only |
| Our code: `uct_capitulation.py`, `parabolic_short.py`, `uct_setups_common.py`, `chart_iq/engine/v3.py`, `setup_tags.py`, `setupCatalog.js`, `setupGroups.js`, `setupTagMap.js`, `fingerprintChecklist.js`, `notebookTemplates.js`, `starterScans.json`, `definitions.json`, `uct_method_scripts.json`, `curriculum_final_v2.json`, `TRADE_PLANS.md`, `feature_flags.json` | this repo | (repo paths) | Read in full where cited |
| Our daily bars (`bars.db`, 4,002 symbols, 1984-2026) and 5-minute bars (1,000 names, 2026-08-17 to 2026-11-06) | the app's sandbox data | local, read-only | Our measurements (4.7, 4.8, 9.2); limits stated there |

**Not found or not readable:** Lance Breitstein's own written definition of the "Right Side of the V"; Brian Shannon's
written rule for a gap reversal against the intermediate trend; any Kullamägi text on the long beyond the 2021 post; any
published statistic for this exact setup; Investopedia (fetch refused today); the full text of the four papers.

**Scratch work (not in the repo):** downloads, scripts and outputs under the session scratchpad,
`setups/38-parabolic-long/` (`scripts/measure.py`, `measure2.py`, `intraday_test.py`, `feat.py`, `cap_check.py`;
`measure/summary*.txt`; `txt/` holds the Substack texts; `web/` the outside pages). The cold check's fresh downloads,
post texts and the quote-matching script are in `setups/38-parabolic-long/check/` (`qcheck.py`, `ptxt/`).

---

## Removed in checking

Cold check, 2026-11-09. Everything else in the dossier was confirmed against its source as described at the top:
all 311 quoted strings matched word for word (Bulkowski's through the fetch tool), every UCT quote sat under the
section header the dossier attributes it to, every post date matched the post API, the bibliographic details
(journals, volumes, pages, the 2021-01-08 / 2021-04-28 dates, the 2024-06-11 TraderLion date, the 2022-06-27 episode,
the 2002-06-20 interview, the Internet Archive timestamps, Niv Goren as the Stonks Capital author), the extension table
and the GBTC chart date read off the images, the scanner code summaries (5.2, 5.3, 5.4), the rulebook citations in
section 7, and the numbers in 4.7, 4.8, 6.1 and 9.2 (recomputed from the bars and the writer's saved rows).

1. **KB 11186 (section 6.2):** the clauses "3.5 ATR under the 50-day, and closing up from the open while reclaiming the
   200-day" and, in 9.2 example 2, "Bracco's chart says '+2.82% from open' per the KB summary". Every copy of the
   record in this repo stops at "3rd-lowest Nasdaq A/D in"; those details are not in it. Our own bars do show 3.49 ATR
   and a close above the 200-day, so the facts stand on the bars alone (9.2, example 2), not on the record.
2. **"Bracco watches 30" (section 8.7):** stated without a source. Replaced with his own words from Sunday Scans
   2026-03-08, which say the same thing and add his second level, 50.
3. **"It fired on two" (section 5.2):** the replay of `uct_capitulation.evaluate()` on the 13 examples also fires on
   QQQ in April 2025 (setup day 2025-04-04, gap below 04-07). Corrected to three.
4. **Course location (section 5.5):** "module 9 lesson 5" were zero-based list indexes; the file labels the module
   "M10" and the lesson is its sixth. Corrected.
5. **Wyckoff authorship (section 3.4):** "schematics edited by the late Hank Pruden" is a paraphrase; the page says
   "created by Roman Bogomazov and edited by the late Dr. Henry O. (“Hank”) Pruden." Replaced with the page's words.
6. **Bulkowski's point "B" (section 3.6):** "a point on his chart" became "the bar at the end of the run", which is what
   the page's text supports ("from A to B", "the high of bar B").
7. **Three truncated Bulkowski quotes** (3.6 entry, 4.1 sample, 4.1 the 46% line) completed from a fresh read; nothing
   in them changed meaning.
8. **Unsourced in the first draft, now sourced:** the 2025-06-15 "20-day ATR" line (link added), Bracco's "I never add
   when I am down" (2026-01-25, link and context added: he was writing about shorting silver), and "three attempts on
   AGQ" (his words: "3 failed attempts over 2 sessions", 2026-01-18).
9. **Added:** Bulkowski's identification guidelines for the vertical run down (the "minimal overlap" line that R5 leans
   on), Bracco's 2025-10-26 "rubber band / mean reversion longs" post (a pullback use of the name, flagged so it is not
   mixed in), the stale "admin-only" docstring on `uct_capitulation.py`, the course files in 5.1, and the RVOL
   definition (prior 50 sessions) that the 9.2 figures actually use.

Nothing from the proposed rules (section 8) had to be removed: each line is measurable as written, and the only
[source consensus] tag (8.8 #4) rests on two named sources.

## 12. Examples (from our data)

**The scan's rule (one paragraph).** Daily bars from the local sandbox, scanned over the 2,630 names that ever met the house
liquidity rule (every one of them was scanned; nothing was cut for time; first hit 1998, last 2026). The climax
day is a gap-down day (open at least 1% under the prior close, the required box 5) whose close is back above its open
and in the upper half of its range: the daily-bar stand-in for B2's VWAP reclaim, since the 5-minute history only
covers the last 60 trading days. At least 4 of the 5 mirrored boxes must be ticked (box 1 three lower closes before
the climax; box 2 two consecutive gap-down opens; box 3 two of the three burst days losing a bigger % than the day
before; box 4 rising volume two days running into the climax; box 5 the gap down). Context: (a) the climax low at
least 40% under the 20-session high with that high set inside the last 5 sessions, or (b) the prior close at least
5 ATR(20) under the 50-day SMA (3 ATR for a list of 35 broad index ETFs, scanned separately, which gave only DIA and
MDY). House rules: prior close $10 or more and 20-day average dollar volume $20 million or more (B23); climax volume at
least 2x its 50-day average (R6); the fill is the climax close (market order, E57); the fill may not be more than 4%
over the day's OHLC average, the chase check (C28); stop at the day's low less 3 cents or 0.1%, whichever is more
(S1), and the trade skipped if the stop is under 1.5% or over 8% away (S2); the 9-day EMA at least 2R above the fill
(R7); the 200-day is not a gate (B26's exception, R8), and every hit in the table below is under it. One hit per name
per 10 sessions. Not coded: R9 (the company's own news; the report dates were checked by hand on the examples), the
opening-minutes volume, the index reading, the Monday preference and the trims. Outcome: from the day after the
climax, 60 sessions forward, the first of stop / 3R / 5R; both the same day, the stop wins.

**Base rate.** 304 hits. **23.4% reached 3R and 10.9% reached 5R before the stop**; 87% were
eventually stopped at the original stop inside the 60-session window (winners included, since the stop never moves
here). This is a fixed stop with no trims, no breakeven move and no 9 EMA exit, so it understates the planned trade
(T2 takes two thirds at the 9 EMA or 3R) and overstates how often a real trade is stopped. The sample is lumpy:
83 of the 304 hits fired on one day, 2020-02-28, the first week of the Covid crash, and all 83 were stopped
(8 reached 3R first, none 5R). Without 2020 the rate is 32.5% to 3R and 17.0% to 5R on 194 hits,
which is the fairer read of a climax that is not the first week of a crash. Five boxes did not beat four
(22.9% vs 23.6% to 3R), and a deeper stretch (7 ATR or more) did not help on its own (24.3%
on 74); what separated winners from losers was the date: the clusters that worked were 2001-09-21 (4 of 4 to 5R),
2025-04-07 (3 of 5 to 5R) and 2024-08-05 (2 of 2 to 3R); the ones that failed were 2020-02-28, 2020-03-06 (10 hits,
none reached 1R) and the 2023-03-16 bank-panic day. Window: 60 sessions after the climax.

**The ten examples** (sheets: `final/sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png` under the scratch folder
`_study-resume/scratchpad/setups/38-parabolic-long/`; one chart per example, 75 sessions before, 30 after; buy, stop, 3R
and 5R drawn; the burst boxed from its peak to the climax low). One per ticker, ten different years, seven stocks and
three ETFs (AGQ, EPI, EWH; R1 allows them). Every example is a market, sector or group liquidation, not the company's
own news (NTCT 2016-02-09, which would have made 7R, was dropped because its fall began with its own report on
2016-01-28, R9). The stand-in entry is the climax close; a real B2 entry on the first 5-minute close back over VWAP
would usually be lower, with the same stop.

| # | Ticker | Climax day | Structure | Buy | Stop (dist.) | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|
| 1 | JCI | 2001-09-21 | -27.2% in 14 sessions; -6.7 ATR vs 50-day; 4/5 boxes; gap -4.3%; vol 2.2x; close +3.9% off the open | 84.95 | 81.62 (3.9%) | 12.06R (5R; 3R in 5 sessions) | The 2001-09-21 low, the Friday of the first week after the September 2001 closure; a market-wide panic (DIA, JPM and F fired the same day, all four reached 5R). Fourteen sessions of accelerating selling, a 4.3% gap down, a close near the high on rising volume; 3R in 5 sessions, the 9 EMA inside two weeks, never stopped. |
| 2 | BOH | 2008-07-15 | -28.5% in 16 sessions; -5.7 ATR vs 50-day; 4/5 boxes; gap -1.6%; vol 2.9x; close +0.8% off the open | 39.34 | 37.42 (4.9%) | 15.97R (5R; 3R in 2 sessions) | A bank in the July 2008 financials liquidation, not its own news (its report came 9 sessions later, 2008-07-28). The climax bar is a huge-range gap down that closes green on 2.9x volume; 3R in 2 sessions, 5R inside two weeks, 16R before the window closed. |
| 3 | AGQ | 2010-02-05 | -40.3% in 18 sessions; -5.2 ATR vs 50-day; 5/5 boxes; gap -2.6%; vol 2.8x; close +0.9% off the open | 89.56 | 83.01 (7.3%) | 6.67R (5R; 3R in 16 sessions) | A 2x silver fund (R1 welcomes leveraged ETFs) 40% under a high set 18 sessions earlier, all 5 boxes, a gap down closing green on 2.8x volume. A leveraged commodity unwind. The stop was 7.3% away, so S2 sizes it down; 3R in 16 sessions, 6.7R best. |
| 4 | EPI | 2013-08-28 | -17.8% in 19 sessions; -6.0 ATR vs 50-day; 4/5 boxes; gap -3.1%; vol 3.5x; close +2.2% off the open | 13.30 | 12.96 (2.6%) | 11.24R (5R; 3R in 5 sessions) | An India fund in the August 2013 rupee selloff, a country-level panic with nothing company-specific. A 19-session slide to 6 ATR under the 50-day, a 3.1% gap down, 3.5x volume, a close 2.2% off the open; 3R in 5 sessions, 11R best. |
| 5 | EWH | 2015-08-24 | -21.6% in 18 sessions; -7.4 ATR vs 50-day; 4/5 boxes; gap -8.3%; vol 5.3x; close +2.3% off the open | 18.26 | 17.54 (3.9%) | 4.17R (3R; 3R in 37 sessions) | The 2015-08-24 Monday flush (8 names fired that day): gap down 8.3%, 5.3x volume, 7.4 ATR under the 50-day, a close 2.3% off the open. Textbook bar, slow payoff: the stop never traded but 3R took 37 sessions, and the cluster as a whole averaged under 1R (3 of 8 reached 3R, none 5R). |
| 6 | HTHT | 2021-07-27 | -29.0% in 16 sessions; -6.9 ATR vs 50-day; 5/5 boxes; gap -4.5%; vol 7.2x; close +3.2% off the open | 40.75 | 38.97 (4.4%) | 6.48R (5R; 3R in 1 session) | The late-July 2021 China liquidation (6 names fired on 2021-07-27): 7.2x volume on the climax, a 4.5% gap down, a close 3.2% off the open, all 5 boxes; 3R the next session, 5R within six weeks. A crowded group unwinding at once, the 8.7 best context. |
| 7 | BABA | 2022-03-15 | -43.4% in 17 sessions; -6.7 ATR vs 50-day; 5/5 boxes; gap -3.4%; vol 3.6x; close +2.2% off the open | 76.76 | 73.20 (4.6%) | 13.3R (5R; 3R in 1 session) | The March 2022 China ADR washout: 43% off the high in 17 sessions, all 5 boxes, 3.6x volume, a close 2.2% off the open; 3R the very next session, 13R best. The clearest V in the set; MCHI, FXI and QFIN fired the same day and all reached 5R. |
| 8 | SLG | 2023-03-24 | -47.1% in 19 sessions; -8.6 ATR vs 50-day; 5/5 boxes; gap -1.1%; vol 3.7x; close +3.8% off the open | 20.50 | 19.03 (7.2%) | 4.9R (3R; 3R in 6 sessions) | An office REIT in the March 2023 regional-bank panic: 47% off the high in 19 sessions, 8.6 ATR under the 50-day, all 5 boxes, 3.7x volume, a close 3.8% off the open; 3R in 6 sessions. The stop was 7.2%, so S2 sizes it down. Eight names fired in March 2023 and only this one reached 3R: the 03-16 hits (BKU, BPOP) were a week too early. |
| 9 | DB | 2024-08-05 | -19.7% in 9 sessions; -5.1 ATR vs 50-day; 4/5 boxes; gap -4.2%; vol 2.3x; close +2.2% off the open | 14.08 | 13.67 (2.9%) | 9.15R (5R; 3R in 9 sessions) | The 2024-08-05 Monday (the yen carry unwind): a 9-session, 20% fall, a 4.2% gap down, a close 2.2% off the open on 2.3x volume; 3R in 9 sessions, 9R best. The short, sharp burst the rule prefers (R4), and a Monday (B5). |
| 10 | GE | 2025-04-07 | -25.6% in 8 sessions; -5.3 ATR vs 50-day; 5/5 boxes; gap -2.2%; vol 3.5x; close +2.8% off the open | 167.70 | 159.19 (5.1%) | 10.91R (5R; 3R in 11 sessions) | The April 2025 tariff crash Monday (5 names fired, 3 reached 5R; the index was 6.4 ATR under its 50-day the day before, the 8.7 best condition): 8 sessions, 26% off the high, all 5 boxes, 3.5x volume, a close 2.8% off the open. 3R came on 2025-04-23, the session after its 04-22 report gapped it up, so the hold carried earnings risk; 5R and 11R by mid-May. |

**Notable failures, in words.**

1. **2020-02-28, the start of a crash (83 names fired, 0 reached 5R, all stopped).** DIA, MDY, CVS, RF, BAC and dozens
   more printed a gap-down reversal day on heavy volume after a week of accelerating selling: every box ticked, every
   context met. It was the first week of a breakdown from an all-time high, the 8.7 "worst" case; the real low came
   16 sessions later and far lower. The 2020-03-06 repeat (10 hits, none reached even 1R; AAL made 0R) was the same
   lesson. The rule cannot see this from the bars; the owner's market reading (Orange or Red, section 8.7) has to.
2. **BKU 2023-03-16, a week too early.** A 44% fall to 8.2 ATR under the 50-day, 4 boxes, 4.4x volume, a green close:
   stopped at 0R the next session. The regional-bank panic had one more leg; SLG, six sessions later on 03-24, is
   example 8. Mistake 2 in 8.8: the first turn after a shock often comes too early.
3. **ALGN 2018-10-26, the company's own news.** A 45% fall and a reversal day on 4.6x volume, but the fall began with
   its own report (2018-10-24 after the close): 0R, stopped. R9 exists for this; the cost is that R9 also throws out
   the occasional winner (NTCT above).
4. **SQQQ 2020-08-27, an inverse fund is not a capitulation.** A 3x inverse Nasdaq ETF 35% off its high with all 5
   boxes made 0.01R. Its "selling climax" is simply the index making a high; mean reversion in an inverse fund is a
   bet on an index pullback, which is a different setup with different odds.

---

## 13. Failures and near-misses (from our data)

Built 2026-11-10 from the same `final/hits.json` as section 12 (`charts.py`, `near_scan.py` in the scratch folder
`_study-resume/scratchpad/setups/38-parabolic-long/`). The failures are hits that passed every gate of the criteria
card (4 or 5 boxes with the climax gap, the context, 2x volume, the 9 EMA at least 2R away, no report inside the burst)
and were stopped before 3R; four different years, one per ticker. The near-misses come from `near_scan.py`, which
re-runs the section 12 rule with one gate relaxed at a time (the box count, the climax gap, the volume, the context)
and keeps only the hits the strict rule rejects for that one criterion. Charts: `final/fail_1.png` to `fail_4.png`
(sheet `fail_1-4.png`), `final/near_1.png` to `near_4.png` (sheet `near_1-4.png`), and the confusable pair
`final/pair_39-parabolic-short.png` (BABA 2022-03-15 above GDS 2025-02-20 from the parabolic-short set). The buy is
the climax close (the daily stand-in for the VWAP reclaim), the stop a few cents under the climax low; 3R and 5R drawn
as on the winners. All numbers are read off the daily bars.

**Failures (every gate passed, stopped before 3R).**

| # | Ticker | Climax day | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | BAC | 2020-02-28 (Friday) | 28.50 | 27.67 (2.9%) | day 1, 2020-03-02, low 27.44 | -21.9% in 11 sessions, 6.2 ATR under the 50-day, 5/5 boxes, a 3.9% gap, 3.6x volume, a close 1.8% off the open: every box ticked. It was the first week of a crash from an all-time high; the stock traded 17.95 on 03-23, 37% under the buy. One of the 83 names that fired that day; none reached 5R. | pl.not_crash_start |
| 2 | WDC | 2022-09-23 (Friday) | 25.58 | 24.94 (2.5%) | day 1, 2022-09-26, low 24.45 | -31.6% in 20 sessions, 6.6 ATR under the 50-day, 4/5 boxes, 2.1x volume. Bought on a Friday; Monday closed 24.49 in its lower 3%, through the stop, and the low came on 09-29 at 23.85. The stock was at the 9 EMA on 09-30, so the buyer of the Monday low, not the Friday turn, got the trade. | pl.inv_new_low |
| 3 | BKU | 2023-03-16 | 23.10 | 21.70 (6.1%) | day 1, 2023-03-17, low 20.54 | -44.0% in 20 sessions, 8.2 ATR under the 50-day, 4/5 boxes, 4.4x volume, a green close. Day 1 closed 21.27, down 7.9%; the regional-bank panic had one more leg, 19.04 by 04-25. SLG (example 8) turned six sessions later on 03-24. | pl.inv_linear |
| 4 | KRE | 2025-04-04 (Friday) | 49.26 | 47.09 (4.4%) | day 1, 2025-04-07, low 47.06 | -20.3% in 7 sessions, 5.6 ATR under the 50-day, 4/5 boxes, a 4.1% gap, 3.1x volume. Bought on the Friday of the tariff crash; Monday gapped to 47.50, traded 47.06 and then printed the real climax (the day GE, example 10, fired). The ETF was at the 9 EMA on 04-09. | pl.no_frontrun |

**Near-misses (one gate fails, everything else passes).**

| # | Ticker | Climax day | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | SYK | 2026-09-09 | pl.burst_count | the gap plus 2 of the other 4 boxes (3 lower closes, an accelerating loss; no second gap, no rising volume); the rule needs 3 | -22.6% in 20 sessions to 5.1 ATR under the 50-day with a 1.7% gap on 2.2x volume: a stretched decline without the burst, under the 200-day. A mean-reversion candidate that B26 says to watch only. Stopped the next day. |
| 2 | CHTR | 2022-09-16 | pl.climax_gap | the climax day opened 0.1% under the prior close, no gap down; the rule needs 1% | -20.6% in 20 sessions, 5.4 ATR under the 50-day, 3 of the other 4 boxes, 2.0x volume, but no climax gap and no day-2 gap up either (09-19 opened 0.7% lower): a linear decline that went on to 297.66 by 10-13, 21% lower. Stopped the next day. |
| 3 | APD | 2025-04-07 | pl.volume_climax | climax-day volume 1.5x the 50-day average; the rule needs 2x | -21.3% in 20 sessions, 6.5 ATR under the 50-day, 4/5 boxes, a 1.7% gap on the tariff-crash Monday, but the volume climax was in the index (SPY 4.1x), not in this name. Stopped the next day at 243.69, then at the 9 EMA on 04-11. |
| 4 | BABA | 2021-07-27 | pl.context_decline | 3.4 ATR under the 50-day (the rule needs 5) and 22% off the high (the rule needs 40%) | the same China-liquidation day as HTHT (example 6) with 4/5 boxes, a 4.3% gap and 3.7x volume, but not stretched: a flush in a downtrend that bounced 5% and then made new lows (152.80 on 08-23). Stopped on day 15. |

**What the failures have in common.** All four were stopped on the very next session, and three of the four were
bought on a Friday (BAC 2020-02-28, WDC 2022-09-23, KRE 2025-04-04) with the real low printing on the Monday or
later: Bracco's Monday preference (8.6, pl.no_frontrun) is not a detail. In every case the boxes and the stretch were
in order; what the bars could not show was where in the decline the day sat: the first week of a crash (BAC), the first
leg of a bank panic (BKU), a Friday before a Monday washout (WDC, KRE). The rule reads the climax; the market reading
has to say whether the selling is done, and the stop under the climax low is what keeps the cost of being a week early
to one R.

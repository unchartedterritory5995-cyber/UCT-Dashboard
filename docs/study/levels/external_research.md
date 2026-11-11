# Outside research: published entry, stop and exit rules for the seven Study setups

Gathered 2026-11-06 for the owner's levels rulings (see `README.md` in this folder). Nothing here ships. Every line
is a candidate for him to accept, edit or reject, and his rulings outrank all of it.

**How to read the tags.**
- **[originator]**: the person who named or popularised the setup, in their own writing or interview.
- **[reputable educator]**: an established trading educator or platform writing about it.
- **[study/backtest]**: a published test with a stated sample (academic or practitioner).
- **[forum/secondary]**: someone else's summary, a script description, a blog.
- **(excerpt only)**: the page refused automated reading (TraderLion, IBD reposts, Stockopedia, SSRN all answered
  403). What is reported came from search-engine excerpts of that page, so the wording is approximate. Check the page
  before a rule built on it ships.

Source numbers like [S1] point to the list at the end. Quotes are kept to one short phrase per source; everything
else is paraphrase.

---

## At a glance

| setup | credible outside material | the best-supported rules found |
|---|---|---|
| Kicker | **thin** for the owner's exact pattern; good general rules from Kell and Qullamaggie | opening-range-high entry, low-of-day stop capped by the stock's ADR (Qullamaggie); 65-minute entries, day-low stop, 1-2% initial risk (Kell); trim 1/3-1/2 after 3-5 days, trail the 10/20-day |
| Oops Reversal | **moderate**: Williams' rules (through two backtests that cite his book), TraderLion's swing version, out-of-sample tests | buy stop at the prior day's low after an open below it; stop at the day's low; Williams' own exit (first profitable open) mostly explains his high win rate |
| Gap Support | **good**: Morales/Kacher's buyable gap-up rules, Bulkowski's gap statistics and his test of the Kacher-Morales rules, Grimes' gap study | gap-day intraday low is the line; Morales/Kacher allow a 1-2.5% undercut only in the first 5 days, after that a break is a sell |
| High Volume Edge | **moderate**: TraderLion's HVE/HVC curriculum (the apparent source of the name); one academic study of the volume effect | day-2 entry on reclaiming the high-volume close after holding volume support or a whole number; stop under day-1 volume support or the day-1 low; close below the HVC = exit |
| Slingshot | **thin but traceable**: the originator (Scot1and) and script write-ups; no statistics | 4-period EMA of the highs; needs prior upward momentum (often an earnings gap); stop at the low of the slingshot day, at most the bottom of the pullback |
| Launchpad | **thin, and definitions disagree**: TraderLion (Ross Haber), Deepvue, two script/blog versions; no statistics | averages bunched within ~1-3% under price; entry above the tight range or on a close above all of them; stop under the range or on a close back under the bunch |
| Bear gap off the highs | **thin for the exact setup**; good adjacent statistics (Bulkowski gaps and dead-cat bounce, post-earnings drift) | O'Neil's "largest one-day drop since the move began" as a sell signal; short mechanics from Qullamaggie's parabolic short (opening-range low entry, high-of-day stop) |

Several of the owner's setup names match TraderLion's curriculum: TraderLion says it teaches three main setups,
"The Gapper/High Volume Setup", "The Launch Pad Setup" and "Up The Right Side" [S21], and uses "High Volume Edge",
"HVE", "HVC" and "Oops Reversal" as named setups [S21, S5]. Where TraderLion pages exist they are probably the
closest outside match to what the owner means, but most could only be read as excerpts.

---

## Rules that recur across setups

These come up for several setups, so they are collected once here.

- **Stop at the low of the entry day.** Qullamaggie for breakouts and episodic pivots [S1, originator]; Stockbee for
  4% breakouts and EPs [S19, S18, originator]; Kell for breakout buys [S9, originator]; Morales/Kacher use the gap
  day's intraday low [S13]; Scot1and uses the slingshot day's low [S24].
- **Cap the stop by the stock's volatility, not a fixed %.** Qullamaggie says the stop should not be wider than the
  stock's ATR or ADR (stated for breakouts) [S1, originator]. Kell's initial risk is about 1-2% of the position
  [S9, originator]. O'Neil's outer limit is 7-8% below cost, no exceptions [S31, originator].
- **First trim after 3-5 days, then breakeven.** Qullamaggie, verbatim: "You should sell 1/3 to 1/2 of the position
  after 3-5 days", then move the stop to break even [S1, originator]. Stockbee moves the stop to breakeven once the
  stock is 4-5% above entry, and sells into strength after 3-10 days of gains [S19, originator].
- **Trail with the 10- or 20-day average.** Qullamaggie trails the rest with the 10- or 20-day MA; beginners should
  use the 10-day and wait for the first close below it [S1, originator]. Kell trails with whichever of the 10 or
  20 EMA the stock respects, and often exits on a break of the 20 EMA [S9, originator].
- **Sell into extension.** Kell sells into extensions from the daily 10 EMA and takes profits sooner when the stock
  is extended from the 10-week average [S9, originator].
- **Not verified, so not used:** Mark Minervini's stop rules. His books were not reachable; secondary summaries
  disagree (a 10% maximum loss; staggered stops of 6% and 10% per a Stockopedia interview excerpt). Nothing below
  rests on them.

---

## 1. Kicker

**Owner's definition:** already set up (uptrend or clean base); day 1 closes red and weak near its low with a real
body; day 2 gaps up and closes strong above day 1's high, usually on volume. **Owner's rulings:** entry over the red
day's high or the day-2 30-minute opening-range breakout; stop under the kicker candle's low, at most ~3.5%.

**How well outside material matches.** Poorly. The candlestick "kicking" pattern that has been tested is stricter
than the owner's: Bulkowski requires a tall black candle with no shadows, an upward gap, then a tall white candle
with no shadows [S11]. A candlestick-education site's version (attributing the pattern to Steve Nison) has the
second candle open above the first candle's open with no body overlap [S12]. Kell uses the word in his own
writing, but as a confirmation signal, not as a stand-alone setup with published rules [S7, S8].

**Entry**
- Kell (NFLX, March 2023) said the stock was on a buy signal after a wedge pop confirmed by a kicker candle:
  "Wedge Pop on volume via a Kicker Candle" [S7, originator].
- Kell (AMD, December 2023): a "Bear Kicker" made him cut the position; the "Bull Kicker" the next day was where he
  bought back in, at a higher cost [S8, reputable educator, excerpt only]. So in his use a kicker can be a
  re-entry trigger.
- Kell does not trade the first 10-15 minutes unless there is a catalyst such as earnings, and mostly uses
  65-minute bars for entries and adds [S9, originator].
- Qullamaggie buys the opening range high of the first 1-, 5- or 60-minute candle (breakouts and EPs) [S1,
  originator].
- A secondary candlestick site suggests buying the day-2 close, or more slowly a day-3 close above day 2's high
  [S12, forum/secondary].
- **Nothing found that names a 30-minute opening range.** The nearest published windows are Qullamaggie's
  1/5/60-minute and Kell's 65-minute.

**Initial stop**
- Qullamaggie: low of the day, and no wider than the stock's ADR/ATR [S1, originator].
- Kell: the day's low (or breakout pivot) on a breakout buy; under the 10 or 20 EMA, using that day's low, on a
  support buy; initial risk roughly 1-2% of the position [S9, originator]. In one trade review he staggered stops
  under the 10 and 20 EMAs below the day's low [S10, excerpt only].
- Secondary candlestick site: below the two-candle low, or tighter, just under the gap [S12, forum/secondary].

**Profit-taking and trailing:** no kicker-specific rule found. The cross-setup rules above (Qullamaggie's 3-5 day
trim and 10/20-day trail; Kell's sell-into-extension and 10/20 EMA trail) are the nearest.

**Invalidation**
- Kell on another name in the same newsletter: losing that day's low ended his interest [S7, originator].
- Secondary site: a later close back through the gap into or below day 1's range [S12, forum/secondary].

**Published statistics**
- Bulkowski, bullish kicking: acted as a bullish reversal 53% of the time, which he calls "near random"; overall
  performance rank 96 of 103 candle patterns; frequency rank 100 of 103 (rare); best average 10-day move 2.78% (bull
  market, upward breakout). The sample is described only as hundreds of trades; no date range on the page. His
  tips: taller candles do better; trades in the direction of the primary trend succeed more; his preferred setup is
  a pullback within an uptrend [S11, study/backtest].
- The secondary site says no reliable published win rate exists [S12].

**Conflicts and flags**
- Bulkowski's near-random result is for a stricter, rarer candle and says nothing about the owner's context
  requirement. It should not be attached to the owner's kicker. It does support his "already set up" condition:
  Bulkowski's own advice is to trade it with the trend.
- The 3.5% cap sits between Kell's typical 1-2% and O'Neil's 7-8% ceiling. Qullamaggie's cap is volatility-based
  (ADR), so a fixed 3.5% will be wider than ADR on quiet large caps and narrower than ADR on fast names.

---

## 2. Oops Reversal

**Owner's definition:** opens below the prior close, trades under the prior day's low, reverses and closes above the
prior close; a "Williams Oops" opens below the prior LOW and rallies back above it. Location matters: the end of an
orderly pullback, flag, wedge or double bottom.

**How well outside material matches.** The original is Larry Williams' Oops, from *Long-Term Secrets to Short-Term
Trading* (page 113, per the backtest that reproduces it) [S2]. I could not read the book; Williams' rules below come
through two backtests by Nick Radge that cite the book's pages [S2, S3], plus TraderLion's swing-trading version
[S5].

**Entry**
- Williams (via Radge): S&P 500 futures open below the prior day's low; if price rallies back through that low, go
  long [S2, study/backtest citing the originator]. Radge notes the book also skipped Wednesday and Thursday signals,
  which he treats as data mining.
- Richard Moglen (TraderLion) credits Williams, defines the Oops Reversal as a gap below the prior day's low that
  reverses, calls it a short-term pullback setup, and puts the textbook entry "as it pushes through the prior day's
  low" [S5, reputable educator, excerpt only].
- Related, documented equivalent: Connors and Raschke's Turtle Soup (from *Street Smarts*): a new 20-day low, the
  previous 20-day low at least four sessions earlier, buy stop slightly above that previous low, same day only [S6,
  reputable educator].

**Initial stop**
- Williams (via Radge, book page 157): always a dollar stop [S3].
- Moglen: the low of the day; he says these setups often keep risk under 2%; once the reversal works and pushes about
  3% above the pivot he raises the stop to just under the pivot. In his BE case study (Nov 2025) the stop was the
  day's low, about 4.3% of risk [S5, reputable educator, excerpt only].
- Turtle Soup: a stop just below the day's low, placed as soon as the entry fills [S6].

**Profit-taking and exit**
- Williams' "bailout" exit (via Radge, book page 157): exit on the first profitable open, even a 1c profit; reverse on
  an opposite signal [S3, study/backtest citing the originator].
- Turtle Soup: a trailing stop once in profit, method unspecified [S6].
- No swing-length trim or trail rule was found for the Oops specifically.

**Published statistics**
- Radge, S&P 500 futures, long side only. Williams' book period (Sep 1987 to Aug 1998, treated as in-sample): 88% win
  rate and $585 average trade per contract with Wed/Thu removed; 80% and $286 with all days. The 17 years after the
  book (out-of-sample, to 2015): 58.9% and $395 with Wed/Thu removed; all trades averaged $258, only about 10% below
  in-sample. Fewer than 200 trades since 1987, about 7 a year [S2, study/backtest].
- Radge, the same rules on one stock (Commonwealth Bank, from 1998, $10,000 per trade, $2,000 stop): 354 trades, 85.8%
  winners. Dropping the reverse rule: 284 trades, 98.6% winners but a win/loss ratio of 0.05, and losing trades
  lasted 59 days on average. Exiting at the same day's close instead: 437 trades, 50.5% winners ("basically
  random"), win/loss 1.36, small net profit. His point: the high win rate comes from the bailout exit, not the
  pattern [S3, study/backtest].
- Unger Academy, DAX futures, 2010 on, EUR 2,000 stop, first-profitable-open exit: profitable until about October 2022,
  then a drawdown with losses in 2023-2025. The presenter links the decay to extended trading sessions moving
  activity overnight. Trade count and win rate not given [S4, study/backtest].

**Conflicts and flags**
- **The owner's Oops is not Williams' Oops.** Williams needs the open itself below the prior LOW and triggers
  intraday at that low, with no close condition. The owner's version opens below the prior CLOSE, undercuts the
  prior low, and must CLOSE above the prior close: a daily-close confirmation that triggers later and higher.
  (The owner's own "Williams Oops" sub-variant matches the original.)
- Williams' published edge is index futures with a next-open exit. Nothing found tests a multi-day swing hold after
  an Oops in stocks, and the one single-stock test found the reversal day itself near random.
- None of the backtests filter for location; the owner's "end of an orderly pullback" condition is untested
  outside. Moglen's use (pullback setup, e.g. at the 50-day) matches the owner's intent.

---

## 3. Gap Support

**Owner's definition:** a stock not in a downtrend gaps up 4%+ on 2x volume and holds; days or weeks later it pulls
back to the gap-up day's low and buyers defend it.

**How well outside material matches.** Well, for the gap-day low as the line. The closest published rule set is
Kacher and Morales' "buyable gap-up" [S13, S14].

**Gap qualification**
- Kacher/Morales: gap at least 0.75x the 40-day ATR; gap-day volume at least 1.5x the 50-day average; quality leading
  stocks with constructive action before the gap; no gaps within overall downtrends [S13, reputable educator; byline
  not shown, image files suggest Kacher].
- Stockbee's EP scan: close at least 4% above the prior close, volume over 3x the 50-day average, at least 300,000
  shares [S18, originator].
- Qullamaggie's EP: a gap of 10% or more on unexpected news, with very large volume early [S1, originator].
- Deron Wagner (Morpheus): up more than 5% by the close, volume at least 3x the 50-day average, after a base of at
  least four to five weeks [S17, reputable educator].

**Entry**
- On the gap day: Qullamaggie buys the opening range high [S1]; Stockbee buys pre- or post-market when he finds a good
  EP [S18]; Wagner buys half after the first minute or two [S17].
- On the later pullback (closest to the owner's setup): Wagner lists a buy stop over a tight, light-volume inside day
  within a few days of the gap; over a two-day high when price stalls; over the high of the day that tests and holds
  the 10-day; a bullish reversal at the 20-day EMA; or near the 50-day "as long as the gap was not filled" [S17,
  reputable educator].
- IBD (as reposted): buy a breakaway gap as close to the open as possible; a 5% buy-zone limit still applies [S33,
  reputable educator, excerpt only].

**Initial stop**
- Kacher/Morales: the gap day's intraday low. Within five trading days after the gap the stock may undercut that low
  by 1% to 2.5%, depending on volatility; from the sixth day on, a break of the low is a sell [S13, reputable
  educator].
- Qullamaggie and Stockbee: low of the gap day [S1, S18 (Stockbee in his comment replies)].
- Bulkowski: a few cents below the gap for upward breakouts [S15, study/backtest].
- Wagner: 5-10% below an aggressive gap-day entry [S17]. IBD: 7% below cost [S33, excerpt only].

**Trims and trailing**
- In Bulkowski's reading of the Kacher-Morales rules: sell on a violation of the 10-day average after seven weeks, or
  of the 50-day otherwise (the 50-day for large caps and some industries) [S14].
- Qullamaggie: for EPs, trail with the 10- or 20-day once clear of the initial stop; he gives no fixed trim for EPs
  and tells readers to make their own sell rules [S1].

**Invalidation**
- Kacher/Morales: a break of the gap-day low from day 6 on [S13].
- Wagner: avoid stocks that fill the opening gap [S17].

**Published statistics**
- Bulkowski's test of the Kacher-Morales rules (557 stocks, March 2001 to October 2010, stop on a close below the
  gap-day low, exits as above): average gain 1.2% to 3.1% across 16 test variants, about 28-32% of trades won (he notes
  losing two of every three), average drawdown 5.5-8.9%, holds of 29-43 days. His verdict: "I don't recommend this
  setup, but test it for yourself" [S14, study/backtest]. He also notes the authors published no results to compare
  against.
- Bulkowski on gaps (bull market, over 1,100 samples, no date range given): only 1% of upward breakaway gaps close
  within a week, against 85% of area gaps and 60% of exhaustion gaps; median time for an upward breakaway gap to close
  is 89 days. He calls gaps "places of weak support or resistance" [S15, study/backtest].
- Adam Grimes, S&P 500 stocks, two years to Oct 2010 (125,811 stock-days): gaps closed (traded back to the prior
  close) 76% of the time overall, but gaps over 5% closed only 9.6% of the time (N = 279). As I read it this is
  within the gap day itself [S16, study/backtest].
- Post-earnings drift (relevant when the gap is an earnings gap): stocks keep drifting in the direction of the
  earnings surprise; Bernard and Thomas (1989) found the top-minus-bottom surprise spread positive in 41 of 48
  quarters, 1974-1985 [S37, study, via a secondary summary]. The effect has weakened: the spread fell from about 5% in
  the 1980s-90s to 3% or less by the late 2010s per Kettell, McInnis and Zhao (2022) [S37, secondary summary].

**Conflicts and flags**
- **Timing of the retest.** The owner's setup buys a pullback to the gap-day low "days or weeks later". Kacher/Morales
  tolerate an undercut only in the first five days; after that, a break of the low is a sell. An owner-style retest
  that dips under the low weeks later is a sell under their rule.
- **Bulkowski does not support the gap low as strong support**, and his test of a close-below-gap-low stop rule had
  a low win rate. That test bought on the gap, not on a later retest, so it does not directly test the owner's
  entry.
- **Thresholds.** The owner's 4% / 2x is looser than Qullamaggie (10%), Wagner (5%, 3x) and Stockbee's EP scan (3x
  volume), and in the same range as Kacher/Morales (0.75 ATR, 1.5x volume).

---

## 4. High Volume Edge

**Owner's definition:** an up day on volume that dwarfs everything before it (record volume, roughly 10x normal);
that day's close is a level to mark.

**How well outside material matches.** The name and the close-as-level idea match TraderLion's "High Volume Edge"
and "High Volume Close (HVC)" teaching [S21]. TraderLion's material is mostly in lessons and social posts, so the
rules below are pieced together.

**Definition, as TraderLion uses it**
- Four versions: HVE (highest volume ever), HV1 (highest in one year), HVIPO (highest since the IPO week), HVLE
  (highest since the last earnings) [S21, reputable educator, excerpt only].
- TraderLion's own volume indicator notes that its "HVE" label is really the highest in about 10 years, because of
  TradingView's lookback limit [S21, excerpt only].
- The HVC is the closing price of day 1, the gap day [S21, excerpt only].

**Entry (day 2)**
- TraderLion's PLTR example (early 2024): watch a whole-number level (e.g. $20) and "volume support" (the price zone
  where most of the gap day's volume traded); the final entry comes when price moves back above the prior day's
  close (the HVC) after holding both [S21, reputable educator; the full post text appeared in search results].

**Initial stop**
- Below the day-1 volume support or the day-1 low, if that risk fits the trader's limits; one article also suggests
  exiting on a close below the HVC [S21, "3 Early Entry Techniques", excerpt only].
- Elsewhere: just below the entry zone, or the low of day / an intraday support level [S21, excerpt only].

**Trims and trailing:** none HVE-specific found; see the cross-setup rules.

**Published statistics**
- Gervais, Kaniel and Mingelgrin, *Journal of Finance* (2001): stocks with unusually high trading volume over a day or
  a week tended to rise over the following month (and unusually low volume to fall); not explained by return
  autocorrelation, firm announcements, market risk or liquidity. They attribute it to a jump in the stock's
  visibility [S22, study]. Design, as described by a later paper (not read in the original): NYSE stocks, 1963-1996,
  50-day windows, a day counts as high-volume if it ranks in the top 10% of its window [S22, details secondary].
- No published statistic was found for an HVC acting as support, or for day-2 HVC reclaims.

**Conflicts and flags**
- The owner's "~10x normal, record volume" is far more extreme than the academic threshold (top decile of 50 days)
  and is not a multiple TraderLion uses (it uses records over set lookbacks). No study of a 10x day was found.
- TraderLion's HV edge is mostly a gap-up or earnings event; the owner's definition is any up day.
- The academic result concerns returns over the following month, not whether the HVC level holds.

---

## 5. Slingshot

**Owner's definition:** a drive (often a power earnings gap), then a tight 3-7 session pullback with closes under the
4-day EMA of the highs; trigger = first close back above that average. His note: mostly a way into power earnings
gaps.

**How well outside material matches.** Closely. The pattern traces to a trader who posts as Scot1and (or
Scot1andT); script authors credit him [S24, S25].

**Entry**
- Scot1and (quoted in a TradingView script): "My Slingshot indicator is simply a 4EMA of the highs." Using the highs
  is meant to find stocks strong enough to break short-term downward pressure [S24, secondary quoting the originator].
- Prerequisites: there must first be upward momentum (a pullback in a downtrend is a chance to sell, not buy); ideally
  a recent strong move, often after an earnings gap; tight ranges before the trigger preferred [S24].
- His own blog (Oct 2016): the trigger is a break of the 4-period EMA of the highs after a pullback in a strong stock;
  "power" can come from any favourite scan (52-week highs, RSI, OBV, relative strength) [S23, originator]. He does not
  say whether the break is intraday or a close.
- A script version (BigGuavaTrading): a close above the 4-period EMA of highs after the close has been below it for
  the prior 3 bars (3 is the default) [S25, forum/secondary].
- An older blog post credits a friend's 4-period EMA (the author used an 8-period SMA) for buying pullbacks to a
  fast-rising average in stocks with catalysts such as earnings [S26, forum/secondary].

**Initial stop**
- Scot1and: usually the low of the slingshot day, or at most the bottom of the consolidation [S24].

**Profit-taking and trailing**
- Scot1and, in a reply on his blog: sells a portion early in the advance and holds the rest using trendlines, as long
  as the market isn't showing distribution days [S23, originator, comment reply rather than post].

**Published statistics:** none found.

**Conflicts and flags**
- The originator's trigger is a "break" (ambiguous); the owner's is the first close above. The 3-bar condition comes
  from a script, not the originator; the owner's 3-7 sessions is his own range.
- Context matches the owner: the originator ties it to strong stocks, often after an earnings gap.

---

## 6. Launchpad

**Owner's definition:** after a correction the 8, 21 and 50-day averages bunch together near the 200-day while price
chops through them in a flat base; the launch is the first close above all of them as they stack 8 > 21 > 50.

**How well outside material matches.** The name is TraderLion's [S21, S27], but the published versions disagree
on which averages, and none is quite the owner's.

**Definitions found**
- Ross Haber (TraderLion): the moving averages converge in a tight bunch under price; he frames it as an early entry
  as a stock moves from a Stage 1 base into Stage 2, with the 30-week average flattening or turning up; a shorter
  version uses the 10-day SMA, 21-day SMA and 23 EMA [S27, reputable educator, excerpt only].
- TraderLion's key averages are listed variously as 10 SMA, 21 EMA, 50 SMA, 65 EMA and 200 SMA [S21, excerpt only].
- Deepvue: the close within 1-3% of the 21-day SMA, 50-day SMA and 65-day EMA, with the averages rising and aligned
  (21 > 50 > 65); typically late in a base after higher lows, before a breakout above the prior high [S28, reputable
  educator]. (Its FAQ calls the 21-day an EMA, contradicting the body.)
- The StratLab (credits TraderLion): 10, 21 and 50 within 1-3% of each other; trigger is a close above all three
  while they are clustered [S29, forum/secondary].
- BigGuavaTrading script: 8, 21, 50 and 200 EMAs by default; trigger when the averages go from not stacked to
  stacked, price crosses above the highest one, and the shortest is rising [S25, forum/secondary].
- Nearest Kell equivalent, the Wedge Pop: the first time a stock trades back up through its moving averages
  (10/20 EMA) after a downside extension; often a gap-up that reclaims them [S30, reputable educator, excerpt only].

**Entry**
- Deepvue: buy above the tight range; add on the later breakout from the base [S28].
- TraderLion: buy on multi-day support at a rising average, or on a break above a consolidation high [S21, excerpt
  only].
- StratLab: a close above all three averages while clustered; if they are more than 3% apart, not yet [S29].

**Initial stop**
- Haber: a close below the converged averages that does not recover, or an undercut of the pivot low; elsewhere the
  low of the launchpad or consolidation pivot [S27, excerpt only].
- Deepvue: the opposite end of the range [S28].
- Kell's wedge pops: under the day's low, sometimes staggered under the 10 and 20 EMAs [S10, S30, excerpt only].

**Profit-taking and trailing**
- Deepvue: sell partial profits into strength as price reaches previous highs [S28].
- Haber's model-book rule: on a second consecutive close below the 21-day SMA, sell at least a third to half [S27,
  excerpt only].

**Published statistics:** none found.

**Conflicts and flags**
- **The owner's version is a bottoming setup** (after a correction, averages near the 200-day). Deepvue's and
  TraderLion's are mostly late-base continuation setups with rising, already-aligned averages. Haber's Stage 1-to-2
  framing is the closest match; BigGuavaTrading's 8/21/50/200 stack transition is the closest mechanically.
- No two sources use the same averages (8/21/50, 10/21/50, 10/21/23, 21/50/65). The owner's set needs his ruling
  either way.

---

## 7. Bear gap off the highs (short)

**Owner's definition:** the first true gap down from a recent top on heavy volume.

**How well outside material matches.** No published short-entry rule set for exactly this was found. There are sell
signals for longs that describe the same event, short mechanics from adjacent setups, and solid statistics on what
large gap-downs do next.

**Entry**
- O'Neil (via IBD): if a stock that has made an extended advance suddenly makes its "greatest one-day price drop since
  the beginning of the move", consider selling if other signals confirm. IBD's example: Netflix gapped down more than
  8% in July 2023, its biggest one-day drop since the run began in October 2022; a later low-volume rebound to new
  highs is a further sign of weakness [S32, reputable educator citing the originator, excerpt only]. This is a rule
  for exiting longs, not for shorting.
- Qullamaggie's parabolic short (a different trigger: a stock up 50-100%+ in days or weeks and up 3-5+ days in a row):
  short the opening range low (1- or 5-minute), the first red 5-minute candle, or a failed VWAP retest; he warns not to
  be too early [S1, originator].
- Kell's Wedge Drop: the first time a stock trades down through its moving averages after an upside extension; the
  write-up says to sit in cash or go short [S30, reputable educator, excerpt only].
- Bulkowski, for 15%+ gap-downs: experienced short sellers should short near the top of the later bounce, not on the
  gap day [S35, study/backtest].

**Initial stop**
- Qullamaggie (parabolic short): the high of the day, or a VWAP reclaim if entered on a VWAP failure; stops tight and
  defined [S1, originator].
- Bulkowski: a few cents above the gap for downward breakouts [S15].

**Covering**
- Qullamaggie: the 10- and 20-day averages are the targets, where these stocks usually bounce [S1, originator].
- Bulkowski: expect at least a return to the event's trend low after shorting the bounce [S35].

**Published statistics**
- Bulkowski on gaps (bull market): only 1% of downward breakaway gaps close within a week, median 84 days to close;
  66% of downward exhaustion gaps close within a week [S15, study/backtest].
- Bulkowski, dead-cat bounce (one-day drops, usually gaps, of 15-70%; hundreds of samples, no date range): the
  trend low averages 31% below the prior close and comes about 7 days after the event; the bounce averages 28% over
  about 23 days; 22% close the gap during the bounce (38% within 3 months, 58% within 6); then a further 30% average
  decline over about 49 days [S35, study/backtest].
- Skinner and Sloan (2002): growth stocks are at least as likely to report negative surprises as positive ones, but
  their prices fall disproportionately on negative surprises; the asymmetry is weaker if only announcement-day returns
  are counted, because bad news is often pre-announced [S36, study; abstract via excerpts]. A later paper disputes how
  strong this "torpedo effect" is [S36].
- Post-earnings drift applies in the negative direction too [S37, study, secondary summary].

**Conflicts and flags**
- The documented short entries mostly wait for a bounce or a failed retest (Bulkowski, Kell, and Qullamaggie's warning
  against shorting too early), not the gap day itself.
- Stockbee's short-side "negative EP": no rule in his own words was found, and secondary sources disagree (a mirror
  short with a stop over the high vs. fading the gap because negative-catalyst gaps tend to reverse intraday).
- Morales and Kacher wrote a short-selling book (*Short-Selling with the O'Neil Disciples*, Wiley, 2015) but its rules
  were not reachable. Morales' free article on its "Punchbowl of Death" pattern describes a failed-breakout short,
  not a gap-down [S34].

---

## How this was gathered, and what it could not reach

- Read directly: Qullamaggie's setups article, Kell's newsletter and one interview, Stockbee's blog posts, Bulkowski's
  pages, Radge's two backtests, Unger Academy, the TraderPlanet buyable gap-up and Morales articles, Grimes' gap study,
  Wagner's breakaway-gap article, Deepvue, StockCharts (Turtle Soup), Scot1and's blog, the TradingView script pages,
  and the abstract pages for the academic papers.
- Excerpts only (pages blocked automated reading): every TraderLion page (Moglen's Oops, Haber's Launchpad, the HVE
  lessons, Kell's trade reviews and Wedge Pop/Drop), the IBD reposts, Stockopedia, SSRN.
- Not read at all: the books themselves (Williams, O'Neil, Minervini, Kell's e-book, Morales/Kacher, *Street Smarts*)
  and the full text of the academic papers. Where a rule is attributed to a book, it comes through the cited source,
  not the book.

---

## Sources

- **[S1]** Kristjan Kullamägi (Qullamaggie), "3 TIMELESS setups that have made me TENS OF MILLIONS!", qullamaggie.com,
  8 Jan 2021 (updated 28 Apr 2021). https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/
  [originator]
- **[S2]** Nick Radge, "The Oops! Pattern - In Sample / Out of Sample", The Chartist, 2 Apr 2015.
  https://www.thechartist.com.au/the-oops-pattern-in-sample-out-of-sample/ [study/backtest]
- **[S3]** Nick Radge, "How To Create A High Winning Percentage Strategy", The Chartist, 9 Apr 2015.
  https://www.thechartist.com.au/how-to-create-a-high-winning-percentage-strategy/ [study/backtest]
- **[S4]** Unger Academy, "We Tested Larry Williams' Oops Pattern - The Results Might Surprise You", undated.
  https://ungeracademy.com/?p=7737 [study/backtest]
- **[S5]** Richard Moglen, TraderLion, "The Oops Reversal Entry Setup/Tactic",
  https://traderlion.com/profile/richard-moglen/the-oops-reversal-entry-setup-tactic/ and "Trade Opportunity Case
  Study of the Week: BE Oops Reversal, 50 SMA Pullback" (Nov 2025),
  https://traderlion.com/profile/richard-moglen/trade-opportunity-case-study-of-the-week-be-oops-reversal-50-sma-pullback-nov-2025/
  [reputable educator, excerpt only]
- **[S6]** Julius de Kempenaer, StockCharts, "Combining Relative Rotation Graphs and the 'Turtle Soup' setup", 2 Jun
  2018 (credits Connors and Raschke, *Street Smarts*).
  https://articles.stockcharts.com/article/articles-rrg-2018-06-combining-relative-rotation-graphs-and-the-turtle-soup-setup/
  [reputable educator]
- **[S7]** Oliver Kell, "Push Pull Continues", The Weeklies Watch, 23 Mar 2023.
  https://weeklieswatch.substack.com/p/push-pull-continues [originator]
- **[S8]** TraderLion, "Anatomy Of A Trade: AMD +50% Wedge Pop" (Oliver Kell's trade, Nov 2023 to early 2024).
  https://traderlion.com/profile/oliver-kell/amd-wedge-pop/ [reputable educator, excerpt only]
- **[S9]** Stockbsessed, "Oliver Kell Interview: The Mind & System Behind a +941.10% Year", 1 Apr 2023.
  https://stockbsessed.substack.com/p/oliver-kell-interview-the-mind-and [originator]
- **[S10]** TraderLion, "Anatomy Of A Trade: MU +20% Wedge Pop" (Oliver Kell).
  https://traderlion.com/profile/oliver-kell/mu-wedge-pop/ [reputable educator, excerpt only]
- **[S11]** Thomas Bulkowski, "Kicking, Bullish", ThePatternSite (page data as of 5 Nov 2026).
  https://www.thepatternsite.com/KickingBull.html [study/backtest]
- **[S12]** The Right Trader, "Bullish kicker". https://therighttrader.com/learn/candlestick-patterns/bullish-kicker
  [forum/secondary]
- **[S13]** TraderPlanet, buyable gap-up article, 11 Mar 2013 (byline not shown; Kacher/Morales material).
  https://www.traderplanet.com/?p=19625 [reputable educator]
- **[S14]** Thomas Bulkowski, "Kacher-Morales Setup", ThePatternSite (tests the rules from Kacher and Morales, "Trading
  gaps with the most potential", *Active Trader*, Dec 2010). https://www.thepatternsite.com/KacherMorales.html
  [study/backtest]
- **[S15]** Thomas Bulkowski, "Bulkowski on Price Gaps", ThePatternSite (updated 8 Aug 2025).
  https://www.thepatternsite.com/gaps.html [study/backtest]
- **[S16]** Adam Grimes, "Gap Study (3/3)", SMB Training blog, 2 Oct 2010. https://www.smbtraining.com/blog/?p=7421
  [study/backtest]
- **[S17]** Deron Wagner, Morpheus Trading, "How To Trade Breakaway Gaps For Huge Stock Gains", 6 Sep 2018.
  https://morpheustrading.com/blog/breakaways-gaps/ [reputable educator]
- **[S18]** Pradeep Bonde (Stockbee), "My process flow for Episodic Pivots (EP)", 30 Jul 2014.
  https://stockbee.blogspot.com/2014/07/my-process-flow-for-episodic-pivots-ep.html [originator]
- **[S19]** Pradeep Bonde (Stockbee), "How to use the 4% breakout scan to make money", 18 Nov 2015.
  https://stockbee.blogspot.com/2015/11/how-to-use-4-breakout-scan-to-make-money.html [originator]
- **[S20]** Pradeep Bonde (Stockbee), "How do stock move on 3 to 5 day time frame", 21 May 2015 (momentum bursts of
  3-5 days, typically 8-40%; filters: not up 3 days in a row, narrow-range or negative day before the breakout, a young
  trend). https://stockbee.blogspot.com/2015/05/how-do-stock-move-on-3-to-5-day-time.html [originator]
- **[S21]** TraderLion on the High Volume Edge and its setups: X post (PLTR HVE, early 2024)
  https://twitter.com/TraderLion/status/1754980182694277617 ; lesson "Entering The High Volume Edge Setup"
  https://traderlion.com/lesson/entering-the-high-volume-edge-setup/ ; "3 Early Entry Techniques To Improve Win Rate"
  https://traderlion.com/trading-strategies/3-early-entry-techniques-to-improve-win-rate/ ; TikTok
  https://www.tiktok.com/@traderlion/video/7207115812484943150 ; TradingView "TraderLion's Enhanced Volume"
  https://www.tradingview.com/script/yzjhAo0E-TraderLion-s-Enhanced-Volume [reputable educator, mostly excerpt only]
- **[S22]** Simon Gervais, Ron Kaniel, Dan Mingelgrin, "The High-Volume Return Premium", *Journal of Finance* 56(3):
  877-919, 2001, doi:10.1111/0022-1082.00349. https://ideas.repec.org/a/bla/jfinan/v56y2001i3p877-919.html and
  https://sites.duke.edu/sgervais/?p=64 [study]
- **[S23]** Scot1and, "Slingshot Refresher", Education of a Speculator blog, 11 Oct 2016.
  http://educsos.blogspot.com/2016/10/slingshot-refresher.html [originator]
- **[S24]** TaPlot, "TAPLOT SlingShot", TradingView, 29 Nov 2021 (updated 9 Jan 2022), quoting Scot1andT's original
  description. https://www.tradingview.com/script/JJtDhJFF-TAPLOT-SlingShot/ [forum/secondary quoting the originator]
- **[S25]** BigGuavaTrading, "Launchpad & Slingshot", TradingView, 2 Nov 2025.
  https://www.tradingview.com/script/fXVC2e6a-Launchpad-Slingshot/ [forum/secondary]
- **[S26]** Trade The System, "Slingshot Setup", 3 Jun 2016. https://tradethesystem.wordpress.com/2016/06/03/slingshot-setup/
  [forum/secondary]
- **[S27]** Ross Haber, TraderLion, "Launchpad Setup: How I Find Early Entries" (and his model-book and consolidation
  pivot posts). https://traderlion.com/profile/ross-haber/launchpad-setup/ [reputable educator, excerpt only]
- **[S28]** Deepvue, "The Launch Pad Setup: Your Guide to Early Stock Entry", 21 Sep 2024. https://deepvue.com/?p=7374
  [reputable educator]
- **[S29]** Nigel (The StratLab), "Understanding the Key Moving Averages Widget", 3 Feb 2026.
  https://thestratlab.substack.com/p/understanding-the-key-moving-averages [forum/secondary]
- **[S30]** TraderLion on Oliver Kell's patterns: "The Wedge Pop" https://traderlion.com/?p=418317 ; "Oliver Kell Wedge
  Drop" https://traderlion.com/?p=388345 [reputable educator, excerpt only]
- **[S31]** "Fool.com TMF Interview: Bill O'Neil Special", The Motley Fool, 20 Jun 2002. Quote: "I will always without
  exception, sell to cut short my loss."
  https://www.fool.com/specials/2002/06/20/foolcom-tmf-interview-bill-oneil-special.aspx [originator]
- **[S32]** Investor's Business Daily, "This trading rule helped investors avoid big declines in Netflix, Super Micro,
  Tesla" (repost). https://www.inkl.com/news/this-trading-rule-helped-investors-avoid-big-declines-in-netflix-super-micro-tesla
  [reputable educator citing O'Neil, excerpt only]
- **[S33]** Investor's Business Daily, "How to buy stocks: breakaway gaps signal strength, not that you're too late to
  buy" (repost). https://www.inkl.com/news/how-to-buy-stocks-breakaway-gaps-signal-strength-not-that-you-re-too-late-to-buy
  [reputable educator, excerpt only]
- **[S34]** Gil Morales, TraderPlanet, article on the "Punchbowl of Death" short-sale pattern, 6 Oct 2015.
  https://www.traderplanet.com/?p=14332 [originator]
- **[S35]** Thomas Bulkowski, "Dead-Cat Bounce", ThePatternSite (updated 29 Jul 2025).
  https://www.thepatternsite.com/dcb.html [study/backtest]
- **[S36]** Douglas Skinner and Richard Sloan, "Earnings Surprises, Growth Expectations, and Stock Returns or Don't Let
  an Earnings Torpedo Sink Your Portfolio", *Review of Accounting Studies* 7: 289-312, 2002, doi:10.2139/ssrn.172060
  [study; abstract via excerpts]
- **[S37]** Victor Bernard and Jacob Thomas, "Post-Earnings-Announcement Drift: Delayed Price Response or Risk
  Premium?", *Journal of Accounting Research* 27: 1-36, 1989, doi:10.2307/2491062 (findings and the later Kettell,
  McInnis and Zhao 2022 result as summarised at
  https://en.wikipedia.org/wiki/Post%E2%80%93earnings-announcement_drift) [study, via secondary summary]
- **[S38]** Brandt, Kishore, Santa-Clara and Venkatachalam, "Earnings Announcements are Full of Surprises", working
  paper, 2008; summarised by Quantpedia as about 12.5% a year of abnormal returns from earnings-reaction and surprise
  strategies. https://quantpedia.com/strategy-tags/earnings-announcement/ [study, via secondary summary; not used for
  any rule above]

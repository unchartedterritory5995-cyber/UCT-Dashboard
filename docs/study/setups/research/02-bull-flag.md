# Setup 02: Bull Flag (Classic Flag / Pullback), long

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Every quote is
copied from the source named next to it and is 40 words or fewer. Where I could not read a source, I say so and give no
wording from it.

How the quotes were checked:
- UCT's Substack, qullamaggie.com, stockbee.blogspot.com, chartpattern.com and the two academic papers were saved with
  plain curl and every quote was matched as an exact string (whitespace normalised).
- Edwards and Magee and Murphy were checked against OCR text of the editions named. OCR splits some words at line
  ends ("com¬ pleted"); I joined those and say so where it matters. Page numbers are the page headers printed in
  those scans.
- thepatternsite.com (Bulkowski), StockCharts ChartSchool, the Brooks Trading Course glossary and the IBD column on
  Yahoo Finance refused plain curl, so their quotes came through a fetch tool that returns page text. Treat those
  quotes as very likely exact, not proven exact.
- Cold check (2026-11-09, a second reader): every quote in this file was re-opened at its source. ChartSchool and the
  Brooks glossary answered plain curl this time and matched as exact strings; Bulkowski's pages (HTTP 406) and the
  Yahoo copy of the IBD column (HTTP 429) again refused curl and were re-read through the fetch tool. All 60 UCT
  Substack passages were re-fetched from Substack's post API and matched word for word, with their dates and the
  section each sits in. Edwards and Magee and Murphy were re-checked against the same OCR copies (no second copy was
  available), and every page number was re-derived from the printed page headers. Section 5 was re-read against the
  code. What changed is listed under "Corrected in checking" and "Removed in checking" at the end.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the named trader's own
words; **[UCT]** UCT's own writers or the owner's verdict log; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

---

## 1. What it is

A bull flag is a short, orderly pause right after a fast, steep advance: price drifts sideways or slightly down in a
tight band, usually on shrinking volume, and gives back only a small part of the gain. The trade is the restart of the
advance, bought either as buyers show up at support inside the pause or as price breaks out of the pause, with a stop
just under a nearby low.

**Why it works (the psychology).** These points are reasoning, not measured facts. Section 4 shows how weak the
measured edge of a plain flag is.
- The pole is fresh demand, often a catalyst, an earnings gap or a breakout from a base. Edwards and Magee say the
  heavy volume at the top of the pole means holders are cashing in: "This volume (since every transaction signifies a
  sale as well as a purchase) is a warning that many holders of the stock are taking profits." (11th ed., pp. 151 to
  152)
- The pause is that profit taking being absorbed. If the drift is quiet and shallow, the sellers are few and the
  holders are not leaving. Murphy: "They represent situations where a steep advance or decline has gotten ahead of
  itself" (1999, p. 142), and the market pauses to catch its breath before going on.
- Who is buying in the flag: traders who missed the pole and want a lower-risk entry, and early sellers who want back
  in. Who is trapped: anyone who sold or shorted the pause expecting a top; when the high breaks they must buy back.
- If the pause comes on heavy or irregular volume, the story is different: it is distribution, not a rest. Edwards and
  Magee: "such high or irregular activity formations are characteristically Minor Reversal Areas rather than true
  Consolidations." (p. 157)
- The owner frames the same idea as buying where the risk is small and letting other traders exhaust themselves:
  "It allows you to trade from a position of strength and let the stock exhaust participants and the only thing that
  matters is the TRUE invalidation of the idea." (Sunday Scans, 2026-01-18,
  https://unchartedterritoryy.substack.com/p/sunday-scans-2a1)

---

## 2. Origin and naming

- **Richard W. Schabacker** organised chart patterns before Edwards and Magee. Edwards and Magee say so: "Part One is
  based, in large part, on the pioneer researches and writings of the late Richard W. Schabacker." (the original
  Foreword, reprinted in the 11th ed.; the same Foreword names his *Technical Analysis and Stock Market Profits*, whose
  latest revision was "made in 1937 by the present writer and Albert L. Kimball"). I could not read Schabacker's own
  books, so I cannot confirm that he named the flag or give the dates of his work. Our app's `bull_flag.py` narrative
  says flag studies "trace back to Schabacker (1932)"; that is unverified.
- **Robert D. Edwards and John Magee, *Technical Analysis of Stock Trends*, first published 1948** (the Preface to the
  seventh edition, reprinted in the 11th: "in 1948, these findings were published"). Chapter "Consolidation
  Formations" (Chapter 11 in the 11th ed.) has the sections "Flags and Pennants", "The measuring formula" and
  "Reliability of Flags and Pennants". The phrase "Bull Flag" appears in their figure caption: "A Bull Flag in February
  and a Bear Flag in April 1936, in Briggs." (p. 156). They also describe the flag as flying "at half-mast": it sits
  about halfway up the move (Chapter 32, p. 392).
- **John J. Murphy, *Technical Analysis of the Financial Markets* (1999; revised from his 1986 futures book)**,
  Chapter 6, pp. 141 to 145, carried the same definition into modern teaching.
- **Thomas Bulkowski, thepatternsite.com and *Encyclopedia of Chart Patterns***, measured flags statistically and
  describes an "earnings flag" event pattern (his page points to the *Encyclopedia*, 2nd ed., pp. 893 to 907). Whether
  he coined that name I could not confirm; Bonde's 2007 post calls it "Bulkowski's Earnings Flag".
- **Modern momentum traders:** Kristjan Kullamägi's "Breakouts" setup (qullamaggie.com, 2021) is a flag-like orderly
  consolidation after a big move. Pradeep Bonde names "bull flags" among the most common continuation patterns in
  momentum leaders (Stockbee, 2013) and trades very tight pauses as his "Anticipation setup" ("Ants", 2019); he calls
  his worked example "also called High Tight Flag", so that post sits on the border with setup 03.
- **Al Brooks (Brooks Trading Course)** uses "bull flag" much more widely: any minor pullback in a bull trend.
- **IBD / William O'Neil** do not list an ordinary flag among their seven bases. Their only flag is the "high, tight
  flag" (our setup 03).

**Other names:** flag, bull flag, flag and pole, half-mast pattern, pennant (the converging version), earnings flag
(Bulkowski), "flagging out", "hourly flag", "weekly flag", "first flag", "check back" (UCT), orderly pullback and
consolidation (Kullamägi), anticipation setup or "Ants" (Bonde).

**In our app the same idea has five names:** the Model Book card "Bull Flag", the journal tag "Classic Flag/Pullback",
the setup tag "Flag" (detector `uct_flag_htf`, "UCT Flag / High Tight Flag"), the classical detector `bull_flag`, and
the Pattern Vision rubric "Bull Flag". Section 5 lists what each one actually tests.

---

## 3. Every definition I could find, source by source

### 3.1 Edwards and Magee (originators of the written rule)
Source: Edwards, Magee and Bassetti, *Technical Analysis of Stock Trends*, 11th ed. (Taylor & Francis: the scan's
copyright page reads "© 2019 by Taylor & Francis Group", Productivity Press imprint, Routledge, ISBN 978-1-138-06941-1;
library catalogues list it as CRC Press, 2018; first ed. 1948). Chapter 11 "Consolidation Formations", pp. 151 to
157; Chapter 32 "Measuring implications in technical chart patterns", p. 392; Chapter 33 "Tactical review of chart
action", pp. 410 to 411. Read in an OCR copy; the cold check re-derived every page number below from the printed page
headers of that copy.
- Shape: "a small, compact parallelogram of price fluctuations, or a tilted Rectangle that slopes back moderately
  against the prevailing trend." (p. 151)
- Prior move: "It usually forms after a rapid and fairly extensive advance that produces a nearly vertical, or at
  least quite steep price track on the charts." (p. 151)
- Volume in the flag: "with volume shrinking markedly and constantly as the pattern develops." (p. 152)
- Rhythm inside the flag: "Sometimes each rally and setback within the Flag takes three or four days, rarely more."
  (p. 152)
- Length: "This process of Minor Fluctuations may continue for only five days to a week if the Flag is narrow, or it
  can go on for as long as three weeks." (p. 153)
- Slope: down-slanting is normal, but "the very short and “solid” ones will frequently develop horizontally and look
  like small squares." (p. 153) And, in the same paragraph: "(On rare occasions, a pattern of the Flag type in an
  uptrend will even slope up a trifle.)" (p. 153)
- The breakout: "Then, suddenly, prices will erupt with a new burst of activity from the end of the Flag and push
  straight up again in another advance that practically duplicates the original “mast” atop which the Flag was
  constructed." (p. 153)
- Their three tests (p. 156): "1. The Consolidation (Flag or Pennant) should occur after a “straight-line” move."
  "2. Activity should diminish appreciably and constantly during the pattern's construction and continue to decline
  until prices break away from it." "3. Prices should break away (in the expected direction) in not more than four
  weeks. A pattern of this type that extends beyond three weeks should be watched with suspicion."
- High or irregular volume during the flag means reversal, not rest (p. 157, quoted in section 1).
- Where flags appear: "they show up most frequently in the later, dynamic phase of Bull Markets, after the first
  accumulation and the more orderly early markup stages have passed." And: "Hence, the appearance of these patterns
  may be taken as a warning that an advance is approaching its final weeks." (p. 157)
- Target: "go back to the beginning of that immediately preceding move, to the point at which it broke away from a
  previous Consolidation or Reversal Formation" (p. 154) ... "and measure from there to the Minor Reversal level at
  which the Flag or Pennant started to form." "Then measure the same distance from the point at which prices break out
  of the Flag or Pennant, and in the same direction." "The level thus arrived at is the minimum expectation of this
  type of Consolidation Pattern." (p. 155) And: "the formula is best applied on a semilogarithmic chart by measuring
  actual chart distance rather than by counting points." (p. 156)
- Entry inside the flag (tactics): "the decline may carry down to the Basic (Red) Trendline, to the Blue Parallel, or
  make a 40% to 50% correction of the rising “mast” preceding the Flag." (p. 410) The Red trendline and Blue parallel
  are the two lines of their own trend channel; the 40% to 50% is the deepest of the three buy points, not a required
  depth.
- When to buy early: "If the “mast” move is the first such move out of a level or only moderately rising trend, and if
  the Major Trend of the market is Bullish, we would be justified in buying at the first opportunity" (p. 410), which
  the sentence goes on to say "would be on the Blue Parallel".
- Volume as a stop rule: "Volume must decrease and remain slight; any increase of volume during the formation of the
  Flag should be reviewed as casting suspicion on the entire pattern", "except the increasing volume that
  characteristically attends the start of the breakout drive", and "we would be safe in placing a tight (1/8 point)
  stop under the close of any day during formation of a Flag or Pennant that showed notably increased volume."
  (p. 410)
- Flat flags: when the flag has horizontal top and bottom, "you would be justified in making a commitment on the sixth
  Reversal point, or for that matter, at almost any point in the pattern" (p. 411).
- Time limit: "Flags and Pennants continuing too long (more than three weeks) are open to question." "it is necessary
  to set the three-week time limit to prevent the stock from drifting all the way back to previously established stop
  levels." (p. 411)
- How far into a run: "After two surges of this sort, it is best to stand back and let someone else carry the ball."
  (p. 392) On the same page, the patience rule and a second time stop: "It would be best to wait until the example is
  clear—a nearly vertical, almost unbelievable rise, followed by several days of congestion with practically no
  volume." "If the congestion continues or sags off for more than about three weeks, sell the stock; it is probably not
  the real thing." (p. 392; the OCR prints "Ifthe")
- Reliability (asserted, never counted): "These pretty little patterns of Consolidation are justly regarded as among
  the most dependable of chart formations, both as to directional and measuring indications." (p. 156)

### 3.2 John J. Murphy (established educator)
Source: *Technical Analysis of the Financial Markets* (New York Institute of Finance, 1999), Chapter 6, pp. 141 to 145.
Read in an OCR copy.
- Prior move: "one of the requirements for both the flag and the pennant is that they be preceded by a sharp and almost
  straight line move." (pp. 141 to 142)
- Shape: "The flag resembles a parallelogram or rectangle marked by two parallel trendlines that tend to slope against
  the prevailing trend." (p. 142)
- Volume: "An important requirement is that volume should dry up noticeably while each of the patterns is forming."
  (p. 143)
- Length: "Both patterns are relatively short term and should be completed within one to three weeks." (p. 143; OCR
  splits "completed".) Down-trend flags: "often last no longer than one or two weeks."
- Trigger: "Both patterns are completed on the penetration of the upper trendline in an uptrend." "The breaking of
  those trendlines should take place on heavier volume." (p. 143)
- Where: "these minor continuation patterns tend to appear at about the halfway point of the move." (pp. 143 to 144)
- Target: "measure the distance of the preceding move from the original breakout point." (p. 144)
- Reliability (asserted): "Flags and pennants are among the most reliable of continuation patterns and only rarely
  produce a trend reversal." (p. 142; the OCR garbles "continuation".)
- His own summary (p. 145): "They are both preceded by an almost straight line move (called a flagpole) on heavy
  volume." "Prices then pause for about one to three weeks on very light volume." "Both patterns occur at about the
  midpoint of the market move."
- Not stated: a minimum pole size, a maximum depth, a stop.

### 3.3 StockCharts ChartSchool, "Flag, Pennant" (established educator)
Source: https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns/flag-pennant (no author or
date on the page).
- Shape: "A flag is a small rectangle pattern that slopes against the previous trend."
- Prior move: "Flags and pennants require evidence of a sharp advance or decline in heavy volume."
- The pole: "The flagpole is the distance from the first resistance or support break to the high or low of the
  flag/pennant."
- Length: "Flags and pennants are short-term patterns lasting from one to 12 weeks." "There is some debate on the
  timeframe, and some consider eight weeks to be pushing the limits for a reliable pattern." "Ideally, these patterns
  will form between one and four weeks." "Once a flag is over 12 weeks old, it would be classified as a rectangle."
- Breakout volume: "An expansion of volume on the resistance (support) break lends credence to the validity of the
  formation"
- Volume in the flag: no rule; its worked HPQ example sums up that volume "contracted during the flag's formation".
- Where: "This move usually represents the first leg of a significant advance or decline, and the flag/pennant is
  merely a pause." Its opening paragraph also says these patterns "mark a midpoint of the move".
- The page says "Last updated 2 years ago".
- Not stated: depth, stop.

### 3.4 Thomas Bulkowski, "Flags" (measured statistics)
Source: https://thepatternsite.com/flags.html ("Statistics updated on 8/27/2020"). **The site states an AI notice:
"This website, in whole or in part, shall not be used to train artificial intelligence (AI) systems," (it goes on to
name language models). It is cited here with a link and short quotes only.**
- Pole: "The flagpole which leads to the flag should be unusually steep and last several days." "The best performing
  flags have a long, near vertical flagpole." And: "If you don't have a straight-line (or a quick move) price run (the
  flagpole), then you don't have a flag."
- Shape: "Looks like a small rectangle often tilted against the prevailing price trend." "Price moves between two
  parallel, or near parallel, trendlines."
- Length: "Flags are short, less than 3 weeks long. Patterns longer than that are rectangles or channels."
- Volume: "Downward trend 74% (up breakouts) to 77% (down breakouts) of the time." (a frequency, not a filter)
- Tilt: "The best performance comes when the inbound trend is upward leading to a flag which tilts downward."
- Tightness: "A tight flag performs better than a loose one." "A loose flag is one in which price meanders, pokes
  outside the trendline boundary, contains white space, or looks jagged."
- Context: "If the flag appears above (upward breakouts) or below (downward breakouts) a flat base" "then expect the
  move to be a large one." And: "The best performers occur when the breakout is within a third of the yearly low."
- Breakout (his glossary, https://thepatternsite.com/glossary.html): "When price pierces a chart pattern trendline or
  above the top or below the bottom of a chart pattern."
- Target: "Compute the height from the start of the price swing (point A in the measure rule figure to the right)" "to
  the end of the price swing (B) and then multiply it by the above “percentage meeting price target.”" (46%), then
  "Add it (upward breakouts) to the bottom of the flag (C)". He notes "There are 4 combinations of the measure rule
  computation."
- Stop: not on the page.

### 3.5 Bulkowski, "Earnings flag" (an event pattern on his site; whether he coined the name is not confirmed)
Source: https://thepatternsite.com/earnflag.html (same AI notice). Book reference given on the page: *Encyclopedia of
Chart Patterns*, 2nd ed., pp. 893 to 907 (not read).
- "Look for a near vertical price run, preferably lasting several days."
- "Near the top of the flagpole, price consolidates and usually trends downward."
- Buy: "Buy when price pierces a flag or pennant trendline (D in the figure to the right) or rises above the event
  pattern's high (A), but not before."
- Relevance: many UCT flags are post-earnings flags (section 6).

### 3.6 Kristjan Kullamägi (originator, primary)
Source: "3 TIMELESS setups that have made me TENS OF MILLIONS!", https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/
(published 2021-01-08, modified 2021-04-28). He does not call it a flag; it is his "Breakouts" setup.
- Big picture: "they tend to move in stair steps. Meaning they will make a 20-50%+ move, pull back and go sideways for
  a while, then make another move."
- Universe: "Scan for the 1 or 2% of stocks that are up the most over these 3 timeframes" (1, 3 and 6 months).
- Step 1: "A big move higher sometime in the past 1-3 months. This move can be anywhere from 30-100%+ and usually lasts
  a few days to a few weeks."
- Step 2: "An orderly pullback and consolidation with higher lows and tightening range in the consolidation phase."
- Step 3 and length: "A range expansion (breakout) out of that consolidation. The consolidation phase is usually 2
  weeks to 2 months."
- Averages: "During the consolidation the stock price “surfs” the rising 10- and 20-day. and sometimes toe 50-day
  moving average." (his typo)
- Shapes: "It’s pretty much flat channels, symmertrical and descending triangles." And: "On the intraday timeframe
  this setup is called Holy Grail by some on the daily it can be called a hight tight flags sometimes."
- Entry: "Enter on the opening range highs." Anticipating the break is allowed but "I don’t find it as effective and
  more skill and experience is needed."
- Stop: "Stop is always lows of the day and stop should not be wider than the ATR or ADR of the stock", with his own
  example: "So if the ADR of the stock is 5%, your stop shouldn’t be wider than 5%."
- Exits: "You should sell 1/3 to 1/2 of the position after 3-5 days, and then move the stop to break even." "The rest
  of the position should be trailed with the 10- or the 20-day moving average." "If a beginner stick to the 10-day.
  You wait for the first CLOSE below the 10- day."
- Stop orders (FAQ, https://qullamaggie.com/faq/, 2021-04-27): "I always use market stops, never limit stops."
- Not stated: volume rules, a maximum depth.

### 3.7 Pradeep Bonde, Stockbee (originator, primary)
- "Top 50 stocks for swing traders", 2013-09-03, https://stockbee.blogspot.com/2013/09/top-50-stocks-for-swing-traders.html:
  "High tight flags and bull flags are the most common continuation patterns on highly ranked stock by 65 day
  momentum." "Many of these powerful momentum movers have very shallow corrections before they continue onward."
- "How to identify the A quality setup", 2014-01-14, https://stockbee.blogspot.com/2014/01/how-to-identify-a-quality-setup.html
  (his momentum-burst breakout out of a consolidation; the list is his): "correction or consolidation should be
  orderly", "volume during consolidation should be preferably orderly", "day before breakout should be narrow range
  day or negative day", "volume on breakout day should be higher", "stock should close near high on breakout day".
- "How to make money using anticipation setup : KOD", 2019-12-17, https://stockbee.blogspot.com/2019/12/how-to-make-money-using-anticipation.html:
  "A stock with established momentum often pause and consolidate." His example "consolidated near its high for 7 days"
  and "The consolidation was very tight and orderly. It is also called High Tight Flag." He entered at the open with a
  market-on-open order: "Entry was 64 which was the opening price. Stop was 40 cents. Which indicated a risk of .62%."
- On waiting for flags after earnings, "Earnings and Bulkowski", 2007-04-04,
  https://stockbee.blogspot.com/2007/04/earnings-and-bulkowski.html: "Many times the stock will form bull flag so late
  in the move that you would miss bulk of the possible returns by waiting for the bull flag."

### 3.8 Brooks Trading Course glossary (a different, much wider meaning)
Source: https://www.brookstradingcourse.com/price-action-trading-terms-glossary/ (no author named on the page).
- "A minor reversal down in a bull trend. Traders expect the bull trend to resume."
- "It can be as brief as one sideways bar or it can retrace most of the most recent leg up."
- Use: in Brooks's language every pullback in an uptrend is a "bull flag". No pole, no length or depth limit. Worth
  teaching only so members are not confused when they meet the term.

### 3.9 Dan Zanger (well-known breakout trader; his own site)
Source: https://www.chartpattern.com/flags-pennants.cfm (no date).
- "They are typically seen right after a big, quick move."
- "Bullish flags are characterized by lower tops and lower bottoms, with the pattern slanting against the trend. But
  unlike wedges, their trend lines run parallel."
- In his pennant paragraph: "Volume generally contracts during the pause with an increase on the breakout."
- He also writes "Research has shown that these patterns are some of the most reliable continuation patterns." without
  naming the research.

### 3.10 IBD / William O'Neil (no ordinary flag)
Source: IBD column "Base Your Stock Buys On Bases, And Things Will Work Better", 2014-11-04, syndicated at
https://finance.yahoo.com/news/stock-buys-bases-things-better-221700195.html.
- "'How to Make Money in Stocks' and IBD University at Investors.com discuss characteristics of seven bases." The list
  that follows is the cup with handle, saucer with handle, double bottom, base on base, flat base, ascending base and
  high, tight flag. No ordinary flag.
- "Most truly sound patterns consolidate a minimum of seven to eight weeks." A one-to-three-week flag is not a sound
  base in IBD's terms (the high, tight flag is the exception; see setup 03).

### 3.11 Linda Raschke's Holy Grail (often linked to flags; it is not one)
Source: AIQ *Opening Bell* interview, August 1997, https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf.
- "1. The 14-period ADX must initially be greater than 30 and rising." "2. Look for a retracement in price to the 20
  period exponential moving average."
- No pole, no flag shape, no volume rule. Our app's `bull_flag.py` narrative says "Linda Raschke teaches this same
  setup as her 'Holy Grail'". That overstates it: the Holy Grail is a trend-filtered pullback to the 20 EMA, which is
  setup 12's territory.

### 3.12 Not read (so nothing quoted)
Schabacker's books; Bulkowski's *Encyclopedia of Chart Patterns* (only his site); O'Neil's book; Minervini's books
(his "power play" belongs to setup 03); Oliver Kell's book; Stan Weinstein's book; Brian Shannon's book; the
Investopedia flag page (it blocked plain curl today; an older quote sits in `docs/study/research/definitions.json`,
read 2026-10-17); the papers by Leigh and others (2002) and Wang and Chan (2007, 2009), known only from a later paper's
reference list.

Note on the 11th edition: its editor, W.H.C. Bassetti, added notes marked "EN". None of the Edwards and Magee
passages quoted in this dossier carry that marker in the scan.

### 3.13 Comparison table

| Source | Prior move (pole) | Shape | Length | Depth | Volume in flag | Trigger | Stop | Target | Where in the trend |
|---|---|---|---|---|---|---|---|---|---|
| Edwards and Magee | steep, "straight-line" | parallelogram sloping back; short ones flat; rarely up "a trifle" | 5 days to 3 weeks; 4 weeks max | a decline may reach a 40% to 50% correction of the mast (their deepest buy point) | must shrink "constantly"; a high-volume day is a warning | burst out of the flag; may buy inside it | tight stop under a high-volume day; time stop at 3 weeks | pole length from the breakout point (semilog) | "half-mast" (halfway up the move); later, dynamic phase of a bull market; stand back after two surges |
| Murphy | sharp, almost straight line, heavy volume | parallel lines sloping against trend | 1 to 3 weeks | not stated | must dry up | upper trendline break on heavier volume | not stated | pole from the original breakout point, added at the flag break | about halfway |
| ChartSchool | sharp move on heavy volume | small rectangle sloping against trend | 1 to 12 weeks, ideally 1 to 4 | not stated | (recap: contracts) | break above resistance; volume adds credence | not stated | pole length applied at the flag's resistance break | "first leg"; also "a midpoint of the move" |
| Bulkowski, flags | unusually steep, several days; no straight-line run, no flag | small rectangle, tilted against trend | under 3 weeks | not stated | falls 74% of the time (frequency) | price pierces a trendline or the pattern's top (glossary) | not stated | 46% of the swing, added to the flag bottom | best when the breakout is within a third of the yearly low, or above a flat base |
| Bulkowski, earnings flag | near-vertical run on earnings | flag or pennant, drifts down | not stated | not stated | not stated | trendline pierce or above the pattern high | not stated | (his measure rule) | after earnings |
| Kullamägi | 30% to 100%+, lasting days to weeks, sometime in the past 1 to 3 months | orderly, higher lows, tightening; flat channels, triangles | 2 weeks to 2 months | not stated | not stated | opening-range high on the breakout day | low of the day, no wider than ATR or ADR | none; 1/3 to 1/2 off after 3 to 5 days, trail 10 or 20-day | top 1% to 2% movers |
| Bonde | 65-day momentum leaders | very shallow, orderly, narrow-range days | (example: 7 days) | "very shallow" | "preferably orderly" | breakout day: range expansion, higher volume, close near high; or at the open in anticipation | 40 cents (0.62%) in his example | not stated | warns post-earnings flags can come late |
| Zanger | big, quick move | lower highs and lows, parallel lines | not stated | not stated | contracts (pennant paragraph) | breakout with rising volume | not on the page | not stated | right after the move |
| Brooks glossary | any bull trend | any minor pullback | one bar or more | up to most of the last leg | not stated | not stated here | not stated | not stated | anywhere in a trend |
| IBD / O'Neil | (no ordinary flag) | | sound bases 7 to 8 weeks minimum | | | | | | |
| UCT (owner, Bracco) | strong push, often a catalyst, HVE or earnings gap | tight, higher lows, at highs or into the 9/20 EMA | 2 to 4 days to about 2 weeks; not a "forever flag" | shallow; "short and shallow" | lower than the push | support hold, PDH break, 20 EMA shakeout and reclaim, hourly higher low; flag-top break too | low of day or prior day's low | not stated; trail the 20 EMA or weekly 9 EMA | the first flag after a breakout or a correction |

### 3.14 Where the sources disagree
1. **Length.** Bulkowski under 3 weeks; Murphy 1 to 3 weeks; Edwards and Magee 5 days to 3 weeks, 4 weeks at most;
   ChartSchool up to 12 weeks (ideally 1 to 4); Kullamägi 2 weeks to 2 months. The owner's examples run from 2 to 4
   days ("2-3-4 day flag") to about 2 weeks. **Recommendation:** 3 to 15 sessions is the flag; 16 to 20 is a weak
   flag; past 20 it is a base and belongs to the flat base or VCP lessons. Reason: three of four classic sources cap
   it near 3 weeks, and the owner's own examples fit inside it.
2. **How big the pole must be.** No classic source gives a number ("steep", "straight-line"). Kullamägi: 30% to 100%+,
   usually lasting "a few days to a few weeks", sometime in the past 1 to 3 months. Our detectors: 8% (`bull_flag`),
   20% (the Flag tag's textbook check), 40% (`uct_flag_htf`). **Recommendation:** at least 20% in 20 sessions or
   fewer, with 30% or more as an A+ cue. Reason: 20% is the rule whose recognition passed our blind judging (section
   5; judged as "is this a flag", not as a trade) and 30% is Kullamägi's floor.
3. **How deep.** Edwards and Magee's tactics let the decline run as deep as a 40% to 50% correction of the mast (the
   deepest of their three buy points); the Model Book playbook (not the owner's words, 5.5) says one third to one half;
   Brooks allows most of the leg; `uct_flag_htf` allows 62%; the Flag tag's textbook check allows 12% from the high and
   half the pole. Murphy, ChartSchool and Bulkowski give no depth. **Recommendation:** at most half the pole and at
   most 15% below the pole high.
4. **Slope.** Against the trend (Edwards and Magee, Murphy, ChartSchool, Bulkowski's best tilt, Zanger) versus flat
   channels and triangles (Kullamägi; Edwards and Magee's "small squares"). Edwards and Magee even allow that on "rare
   occasions" an up flag will "slope up a trifle". **Recommendation:** accept flat or down drifts; reject up-sloping
   ("wedging up", which the owner warns about), knowing this is stricter than Edwards and Magee.
5. **Volume.** A requirement (Edwards and Magee, Murphy) versus a tendency (Zanger: "generally contracts", in his
   pennant paragraph; Bonde: volume "preferably orderly"; ChartSchool: shown in its example, no rule) versus a
   frequency only (Bulkowski: 74%) versus silence (Kullamägi). `uct_flag_htf` has no volume test at all.
6. **The trigger.** A trendline pierce (Murphy, Bulkowski's flag breakout) versus a move above the pattern's high
   (Bulkowski's earnings flag; for his high and tight flag, "Only buy when price closes above the highest peak in the
   chart pattern (including the flagpole).") versus the opening-range high (Kullamägi) versus buying inside the flag on
   a pullback (Edwards and Magee's tactics, the owner) versus buying the open in anticipation (Bonde).
7. **The target.** Edwards and Magee and Murphy add the pole at the breakout point; Bulkowski scales it to 46% and adds
   it to the flag bottom; Kullamägi has no target; the house trims in R. Our `bull_flag.py` adds the full pole to the
   pole-top close, which is usually higher than adding it at the breakout of a down-sloping flag.
8. **Where in the trend.** Two different questions. Within the move: about halfway (Edwards and Magee's "half-mast",
   Murphy's "midpoint", ChartSchool's "midpoint"). Within the bull market: late, a warning sign (Edwards and Magee)
   versus the first leg (ChartSchool) versus the first flag after a breakout or a correction (UCT; Bonde warns that a
   post-earnings flag can come late).
9. **How reliable.** Edwards and Magee, Murphy and Zanger call flags among the most dependable patterns without a
   count. Bulkowski's counts are weak: 44% of up breakouts fail to rise 5% and the pattern is "Not ranked" (section
   4).
10. **What the word means.** Brooks calls any pullback a bull flag; the classic flag needs a pole.

---

## 4. Measured evidence

### 4.1 Bulkowski, flags (the only large published count I found)
Source: https://thepatternsite.com/flags.html, "Flags: Important Bull Market Results", statistics updated 8/27/2020.
- Upward breakouts: "Upward 60% of the time."
- Break-even failure rate (fails to move 5% after the breakout): 44% for up breakouts, 45% for down.
- Average rise: 9% (up); average decline: 8% (down).
- Percentage meeting the measure-rule target: 46% up, 46% down.
- Volume trends down during the flag 74% (up) to 77% (down) of the time.
- Overall performance rank: "Not ranked".
- How: "I automated cataloging of flags to make identification of the trend start and end repeatable," then used
  linear regression for the tilt and "(then reviewed trend start, end, tilt, and changed them as necessary)."
- Limits, from the page itself: "The above numbers are based on hundreds of perfect trades." No exact count, universe
  or date range is given. Neither the flags page nor his glossary defines "perfect trades"; read it as idealised
  trades, not real fills (I could not find his own definition). Flags are measured on the short-term swing: "Performance
  results for flags are based on the short-term price swing, not the change from the breakout to the ultimate high or
  low as in most other chart patterns." His glossary defines the ultimate high as "The highest peak before price
  declines by at least 20%, measured from the high to the close." So a flag's 9% is not comparable with most of his
  other patterns' averages. Bull market, per his glossary: "Everything outside of the March 24, 2000 to October 10,
  2002 and October 12, 2007 to March 6, 2009 bear market." Break-even failure, per his glossary: patterns "that fail to
  rise (upward breakout) or decline (downward breakout) by at least 5%."

### 4.2 Bulkowski, related patterns (for contrast)
- Earnings flag (https://thepatternsite.com/earnflag.html): rank "1 out of 6" event patterns for upward breakouts;
  break-even failure 10%; average rise 34%; throwbacks 63%; 86% meet the target; "hundreds of perfect trades".
  Caution: the earnings flag page does not say how its rise is measured. The flags page says only flags use the short
  swing while "most other chart patterns" use the ultimate high, so the two averages are probably not directly
  comparable; I could not confirm which measure the earnings flag uses.
- High and tight flag (https://thepatternsite.com/htf.html): "Overall performance rank (1 is best): 30 out of 39";
  "Break even failure rate: 15%"; "Average rise: 39%"; "The above numbers are based on 1,028 of perfect trades."
  "Statistics updated on 8/26/2020." That is setup 03.

### 4.3 Academic template studies (indexes, not single stocks)
- Arévalo, García, Guijarro and Peris, "A dynamic trading rule based on filtered flag pattern recognition for stock
  market price forecasting", *Expert Systems with Applications* (2017), doi 10.1016/j.eswa.2017.03.028; author copy
  https://riunet.upv.es/bitstream/handle/10251/102317/ESWA%20Author.pdf. 15-minute bars, 22 May 2000 to 29 November
  2013: "The proposed methodology was applied to 91,309 intraday observations of the DJIA index" (the abstract; the
  data section says the candles are "for the future of Dow Jones Industrial Average index (DJIA)", downloaded from
  TradeStation). They report beating buy and hold after costs, with an EMA trend filter and quarterly re-fitted stops
  and targets. Their literature review warns that overfitting arises "when we combine a low number of trades and a
  complex trading rule". Their "flag" is a 10 by 10 grid template, not a trader's pole and flag; they follow the flag
  definition of their own earlier paper, Cervelló-Royo, Guijarro and Michniuk (2015). They list earlier flag-template
  work: Leigh, Modani, Purvis and Roberts (2002), Leigh, Paz and Purvis (2002), Leigh, Purvis and Ragusa (2002), Wang
  and Chan (2007, 2009). I did not read those papers.
- Lobão, Pacheco and Fernandes, "Trading rule discovery using technical analysis and a template matching technique for
  pattern recognition: Evidence from the Chinese stock market", *International Studies of Economics* 19(2), 2024,
  pp. 168 to 185, doi 10.1002/ise3.62 (abstract at https://econpapers.repec.org/RePEc:wly:intsec:v:19:y:2024:i:2:p:168-185).
  Shanghai Composite index, 1991 to 2021: "Our results indicate that bull flag trading rules can correctly predict the
  price movement direction of the index most of the time, achieving significantly positive excess profits." I read
  only the abstract.
- Limits: indexes, not stocks; template shapes, not our rules; parameters chosen on the same history. These say little
  about buying a single leader's flag.

### 4.4 The classic books
Edwards and Magee and Murphy give no counts at all. Their "most dependable" and "most reliable" are opinions.

### 4.5 Our own app's evidence (house measurements, not published)
- `uct_flag_htf` recognition: two blind packets of 25 fires each, "19 yes / 4 no and 16 yes / 5 no, pooled precision
  of decided 79.5% (Wilson 95% CI 65-89)" (docstring of `uct_flag_htf.py`). This measures whether traders agree it is
  a flag, not whether it pays.
- The Flag tag's textbook check passed blind judging with a pooled mean of 2.58 (`tag_textbook.py` header).
- Outcome: the Flag tag is withheld from members since 2026-10-24 because "its outcome verdict is NEGATIVE (outcome
  replay 2026-10-24, against a matched plain breakout)" (`registry.py`). The test file adds "against a matched plain
  20-day-high breakout in the same stock" (`tests/test_negative_outcome_withheld.py`). The numbers are not in the repo.
- The classical `bull_flag` drawing passed two blind packets as drawn (2.43 and 2.40; `registry.py`). That judged the
  drawing, not the outcome.

### 4.6 My own check for this dossier (reproducible, not evidence of an edge)
I ran the app's own `uct_flag_htf.evaluate()` (rule plus guard, unchanged) over 800 randomly chosen stocks (seed
20261109) from the local test database (2,934 stocks with 1,500 or more daily bars), sessions from 2005-01-01 to
2026-11-06, counting only the first day of each run of fires: 26,590 fires in 733 stocks (1,945 "breakout", 24,645
"forming"). The script lives in the research scratch folder; it is not committed.

Cold check of this table: the saved fire file was re-summarised and every row from "Distance from the detector's
entry" through "Same, day-low stop" came back to the decimal. The test database has grown since the run (it now holds
3,226 stocks with 1,500 or more daily bars, not 2,934), so the seeded sample cannot be redrawn exactly. Re-running the
prior-day-high check on today's database (same seed, a different sample) gave 16,087 cases: median stop 4.8%, within
3% 18.6%, within 5% 53.0%, 3R first 25.3% (stop first 73.2%); the house-rule subset (5,724) median 4.0%, within 3%
27.2%, within 5% 67.9%. The prior-day-high rows below are the writer's run; the re-run agrees within about one point.

| What | Result |
|---|---|
| Distance from the detector's entry to its stop (the flag low), all fires | median 9.7% (middle half 6.7% to 13.5%); within 3%: 1.9%; within 5%: 11.7% |
| Same, "breakout" fires | median 13.0%; within 3%: 0.2% |
| Pole gain, depth, length (medians) | +56.5% pole; flag retraces 28.5% of it; 6 sessions |
| Fires passing B23 (price $10+, $20M+ a day) | 35.9% |
| Fires above the 200-day SMA (B26) | 98.5% |
| Fires not more than 10% above the 10-day average (C29) | 89.4% |
| Breakout fires, a stop 5 cents under the breakout day's low | median 6.8%; within 3%: 10.1% |
| Next-day break of the prior day's high after a "forming" fire, stop 5 cents under the prior day's low (15,326 cases) | median 4.8%; within 3%: 18.9%; within 5%: 53.4% |
| Same, only stocks passing B23, B26 and C29 (5,405) | median 4.1%; within 3%: 26.4%; within 5%: 66.2% |
| Reached +3R before the stop within 60 sessions: breakout at the close, flag-low stop | 18.9% (stop first 57.2%, neither 24.0%) |
| Same, day-low stop | 25.4% (stop first 70.7%) |
| Same, prior-day-high entries with prior-day-low stop | 24.6% (stop first 74.0%) |
| Breakout fires that pass B23, B26 and C29 (472): flag-low stop / day-low stop | 21.4% / 27.1% (stop first 58.1% / 72.2%) |
| Prior-day-high entries whose stop was within 3% (cold-check re-run, 2,996) | 22.2% (stop first 77.7%) |

How to read it:
- **The flag low is almost never a 3% stop.** The house stop (A3, A13) must come from a nearer low: the day's low or
  the prior day's low at a trigger inside or at the top of the flag.
- **No crude edge.** A random price path with no drift reaches +3R before -1R 25% of the time (1 in 4). Every entry
  above lands near that mark or under it: 18.9% to 25.4%, and 24.8% of the flag-low trades that resolved either way.
  This matches Bulkowski's weak flag numbers and the app's negative outcome replay. Whatever edge flags have must come
  from selection (leaders, catalysts, the market) and from management (trims and the trail let winners run past 3R),
  not from the shape alone.
- Caveats: survivorship. The cold check looked: every stock in that database with 1,500 or more daily bars has bars
  into 2026, so the sample holds no delisted stocks and the results lean too high. No costs or slippage; trades
  overlap; daily bars cannot tell whether the stop or the target came first on the same day, and the walk counts the
  stop first, which leans low; in the prior-day-high check, when the entry day itself fell below the stop it counted a
  stop, which also leans low; "3R first" ignores the house's trail and trims. A tighter stop did not help: the
  prior-day-high entries whose stop sat within 3% reached 3R first slightly less often (22.2%) than all of them.

---

## 5. Our app: what the scanners and pages actually say

### 5.1 `uct_flag_htf` ("UCT Flag / High Tight Flag"; setup tag "Flag")
File: `api/services/pattern_engine/detectors/uct/uct_flag_htf.py`. Internal (admin only). As the setup tag "Flag" it
is in the team set but withheld from members (section 4.5). The rule at session i:
- Warm-up: i is at least 65, ATR(14) above 0, the 50-day SMA exists; the detector refuses fewer than 220 bars
  (`_MIN_BARS`, so the 200-day guard can be read) and declares 222 to the scan (`MIN_BARS`, so the two earlier
  trigger sessions can be evaluated too).
- Pole high: the highest high of the last 26 sessions (k-25 to k, the latest on a tie), followed by at least 2 flag
  sessions. So the flag is 2 to 25 sessions long.
- Pole low: the lowest low from 40 sessions before the pole high through the pole-high session (41 bars; the docstring
  says "the 40 sessions before the pole high (inclusive of it)"). Gain = pole high / pole low - 1, **at least 40%**.
  At 90% or more it is labelled the high-tight-flag variant (label only).
- Depth: (pole high - lowest low since) / (pole high - pole low), **at most 62%**.
- The close is at or above the 21-day EMA and the 21 EMA is higher than 5 sessions ago (checked on the flag's last
  session only, not every session).
- "Breakout": today's close is above the highest high of the prior 10 sessions, by no more than 2 ATR.
- "Forming": today's close is within 1 ATR of the highest high of the last 10 sessions; tried only when the breakout
  case does not pass, with the flag measured at today.
- Guard, suppress if either: G1, close under a 200-day SMA that is lower than 20 sessions ago; G2, a 10% or bigger
  opening gap in the last 60 sessions and the last 10 sessions pinned inside 3% (a deal stock).
- **No volume test, no slope or channel test, no tightness test.** (Relative volume feeds the confidence score, but the
  arithmetic floors make every rule fire clear the confidence floor of 50: geometry at least 70, volume and context
  at least 40, history 50, so the lowest possible score is 53.5.)
- Levels: trigger = the 10-day high; entry = that line (forming) or the close (breakout); **stop = the flag's low**;
  targets at 2R and 3R (`uct_setups_common.make_levels`). Narrative: "A close under the 21-day EMA ... is the first
  warning".
- Wrapper: liquidity floor of $2 price and $10,000 average daily dollar volume (`primitives/liquidity.py`); newest of
  the last 3 sessions; a prior-session fire only while its stop holds.

### 5.2 The Flag tag's textbook check (`api/services/pattern_engine/tag_textbook.py`, `flag()`)
Applied on top of `uct_flag_htf` before any Flag tag is shown (recertification C, 2026-10-24; `setup_tags.py`):
- Uptrend: close above the 50-day SMA, the 50 above the 200, the 50 higher than 10 sessions ago.
- Pole top 5 to 20 bars before the marked session (the code comment says "4-20"; the loop runs from i-5 to i-20, so
  the pause is 4 to 19 bars), at least as high as the 3 bars before it and the highest high since; pole base = the
  lowest low of the 20 bars before the top; **pole at least 20%**.
- **Pause depth at most 12% below the top and at most half the pole.**
- **No close under the 21-day EMA during the pause**; the 21 EMA rising over 5 sessions.
- **Pause volume below the pole's volume** (average of the 11 bars up to the top).
- The marked session closes at or above the pause's high and closes green.
- In my reading this is the strictest and most textbook-faithful flag rule in the app (a judgment, not a measurement).

### 5.3 The classical `bull_flag` detector (not internal; its drawing reaches members only behind a flag)
File: `api/services/pattern_engine/detectors/classical/bull_flag.py`. Its drawing is in the member display set
(`registry.DISPLAY_MEMBER_SET`), served while `AUTO_STRUCTURES_MEMBERS_ENABLED` is on and only for rows drawn by the
confirmed round-9 drawing code (`registry.py`).
- Pole at least 8% from a swing low within 20 bars; flag 3 to 20 bars after the pole top; retrace 15% to 50% of the
  pole; upper and lower lines roughly parallel (score at least 0.55); hard gate: flag volume below pole volume;
  liquidity floor.
- Levels: entry = flag high + 0.1%; stop = flag low - 1%; target = pole-top close + pole height.
- Narrative problems (claims I could not support): Raschke "teaches this same setup as her 'Holy Grail'" (section
  3.11 says otherwise); Kullamägi "operates almost exclusively on this pattern ... hunting daily flags forming inside
  weekly breakouts" (his page lists three setups and says no such thing); "refined across decades by Stan Weinstein,
  William O'Neil, and modern practitioners like Brian Shannon" (O'Neil's bases do not include a plain flag; the rest
  unverified); "trace back to Schabacker (1932)" (unverified); "His own site frames this bluntly" (I found no such
  sentence on Bulkowski's page; it is a paraphrase presented as his framing); a 1.5x volume breakout called
  "non-negotiable" (no source I read gives 1.5x, and the code does not test it); "consider scaling out partial size at
  1R" (conflicts with B19); stop 1% under the flag low (house: a few cents, F62).
- The Bulkowski numbers in that narrative (44% to 45%, 9% and 8%, 74% to 77%, "Not ranked", under 3 weeks) match his
  page.

### 5.4 Other related code
- `bear_flag.py`: the mirror (pole down at least 8%, flag rallies 15% to 50%); hidden from display as part of the
  "round-1 noise set" (`registry.py`).
- `pennant.py` (converging lines), `high_tight_flag.py` (90% pole; setup 03).
- Pattern Vision rubric (`api/services/pattern_vision/rubrics.py`), "Bull Flag": must-haves "A clear, steep pole
  (sharp advance)", "A short, orderly pullback drifting down or sideways", "Retraces only part of the pole (not most of
  it)", "Volume contracting during the flag"; disqualifiers "No identifiable pole", "Pullback gives back most/all of
  the pole", "Wide, choppy, high-volume pullback".
- The journal's "Classic Flag/Pullback" tag is suggested by `pullback_to_10ema` and `pullback_to_50sma`
  (`setupTagMap.js` PATTERN_TO_TAG). Those are setup 12's scanners.

### 5.5 Model Book card and playbook
- Card (`app/src/pages/modelbook/setupCatalog.js`): "Bull Flag", family "Bases & Breakouts": "A sharp advance (the
  flagpole) followed by a brief, orderly pullback on lighter volume, then a breakout that resumes the trend." The glyph
  is four up candles, five small red candles under a falling line, then a gap-up breakout candle, with the 9 and 20
  EMAs.
- Playbook (`setupPlaybooks.js`): calls it "one of the most reliable continuation patterns"; depth "typically retracing
  only one-third to one-half of the pole"; entry "Breakout above the upper boundary (downtrend line) of the flag,
  ideally on a pickup in volume"; aggressive entry "a U&R or a 30-minute pivot near the base of the range"; stop
  "Below the low of the flag"; target "project the height of the flagpole up from the breakout point".
- Provenance: git shows the Bull Flag text replaced the High Tight Flag text on 2026-06-17 (commit 79c72b23cd, a
  Claude-assisted commit). The text it replaced was marked "verbatim from the firm's playbook doc" (commit
  464bd40203); the new text is not. Only the aggressive U&R / 30-minute pivot line carries over from that doc. **So
  the playbook is not the owner's words.**
- What the replaced High Tight Flag text said (464bd40203, marked as the firm's doc, itself written in a
  Claude-assisted commit; the doc is not in the repo, so I cannot confirm the wording is the owner's): entry "Breakout
  above the high of the flag + $0.10 (O’Neil pivot). Intraday variant: break of the prior day’s high while price sits
  on the 10-day SMA."; stop "Below the flag low; on the Qullamaggie variant, below the 10-SMA, and only if that stop is
  within 3% of entry." It is about the high tight flag (setup 03), but its prior-day-high trigger and 3% stop cap match
  T2 and A13 below.

### 5.6 Journal tags and course plans
- `app/src/constants/setupGroups.js` (lifted from the old Model Book trade-log form) has "Classic Flag/Pullback". The
  Model Book card is "Bull Flag". `setupTagMap.js` does not alias them, puts them in different families (Momentum &
  Trend versus Bases & Breakouts), and gives both the "Pullback / Flag Plan" template (`notebookTemplates.js`), whose
  invalidation is "It closes decisively through the average on heavy volume, or undercuts the pullback low."
- The vocabulary file (`docs/wisdom/vocabulary/setup-vocabulary-v1.json`) says "Classic Flag/Pullback" and "Bull Flag"
  are the same setup ("same setup; the authors say 'flag'").
- `docs/study/TRADE_PLANS.md` has no flag row. Only the Kicker's plan is the owner's own words.
- `docs/study/UNITS-method.md` SET.08 plans to teach members to "refuse the flag that lost the 20 EMA".

### 5.7 Where the app disagrees with the sources or looks wrong
1. `uct_flag_htf` has **no volume test**. Edwards and Magee and Murphy make drying volume a requirement, ChartSchool's
   example shows it, Bulkowski finds it in 74% of flags, and Bonde asks for "orderly" volume.
2. `uct_flag_htf` allows a **62% retrace**. That is deeper than Edwards and Magee's deepest buy point (a 40% to 50%
   correction), the Model Book playbook's one third to one half, and the textbook check's 12% / half-pole.
3. **Most of its fires are "forming"** (93% of first-day fires in my sample): a stock near its 10-day high, not a
   trigger.
4. **Its stop is wide**: median 9.7% (section 4.6), against A13's "the stop usually sits within about 3% of the buy".
5. Its 200-day guard (G1) only blocks a close under a **falling** 200-day; B26 blocks any long under the 200-day. In
   practice 98.5% of its fires were above it.
6. Its liquidity floor ($2, $10,000 a day) is far below B23 ($10, $20 million); only 35.9% of fires pass B23.
7. Targets at 2R and 3R; the house trims a third at 3R and a third at 5R (B19, E51).
8. The classical `bull_flag` pole floor of 8% is far below "unusually steep" and Kullamägi's 30%.
9. The `bull_flag` narrative's unsupported claims (5.3) and the playbook's "one of the most reliable" (Bulkowski's
   counts are weak: 44% break-even failures, "Not ranked").
10. Two journal tags for one setup, not aliased.
11. SET.08's "lost the 20 EMA" disqualifier needs a definition: the owner buys 20-EMA undercuts that close back above
    (section 6). A close under the 21 EMA that is not reclaimed is the real disqualifier.

---

## 6. UCT's own words

All from UCT's public Substack (https://unchartedterritoryy.substack.com). Dates are Substack's publish dates (UTC).
Authorship is by section: "TSDR's Weekly Outlook & Watchlist" and "TSDR TRADING" are the owner, Patrick (TSDR; the
About page: "co-founders Patrick (TSDR) and Bracco"); "Bracco's Breakdown & Top Ideas" is Bracco; "Index & ETF" and
"INTRO" sections are unsigned; "The Rest of the Week" carries named contributor sections. I scanned all 102 public
posts; "flag" appears 272 times in 81 of them. These are the passages that state a rule or a preference.

### 6.1 The owner (Patrick, TSDR) on what a good flag is
- "I want tight tight tight with defined risk, buying pullbacks, and higher lows." (2026-04-19, sunday-scans-33a)
- "Classic flag and 20EMA pullback." (PENG, 2026-06-21, sunday-scans-bc0)
- "This is where some clean and clear higher low flags can really work smoothly." (GLXY, 2025-09-21, sunday-scans-88a)
- "Higher low in this flag worthy of paying attention to for sure. Exactly what we want to see." (CRWV, 2026-01-25,
  sunday-scans-7fb)
- "The tighter it gets and the more drift it gets the better." and "Don’t want this to become an AMZN where it just
  grinds in a forever flag." (2026-10-11, sunday-scans-31b)
- Length, in his examples: "Would expect move to $170-$172 and then form another tight 2-3-4 day flag." (2025-06-29,
  sunday-scans-d70); "If this builds a min of 3-4 days HTF I will get in" (DAVE, 2025-10-29,
  the-rest-of-the-week-757); "Barely any pullback, immediately to highs, 3 day flag is all it could do to rest.
  Impressive." (HUT, 2026-04-19, sunday-scans-33a); "Now flagging out for 6 sessions." (INOD, 2026-01-14,
  the-rest-of-the-week-305); "HOOD flagged out at $50 for about 2 weeks and then ultimately took off." (2026-04-26,
  sunday-scans-f2d)
- Shallow: "given how ARM and DELL advanced out of short and shallow flags" (2026-05-24, sunday-scans-ffb)
- Volume: "I really like the heavy green volume as it pushed out and so far flagging on lower volume." (2025-10-15,
  the-rest-of-the-week-39d); "Flagging out under the 3rd tap of this flat top resistance. Volume is drying up" (FUTU,
  2025-07-06, sunday-scans-df6)
- The pole: "Made a 65% in 7 sessions." and "If we get a tight flag this is a priority." (AAOI, 2025-06-29,
  sunday-scans-d70); "Pretty straight forward flag following the HVE (highest volume ever)." (PUMP, 2025-11-09,
  sunday-scans-720)

### 6.2 The owner on where to buy
- Support over confirmation: "I want to also use this as an example of why it is important to focus less on upside
  confirmation triggers and more on reasonable support levels." and "buying support holds and quick remounts of MAs
  allow that chop under $16 to not matter." (JOBY, 2026-01-18, sunday-scans-2a1)
- Prior-day high with the averages: "As soon as this triggers a break of previous day’s high, preferably lining up with
  a remount of the 9/20EMAs then we can smash it." (NTRA, 2026-01-04, sunday-scans-153)
- 9 EMA tap: "Long on a tap and hold of the 9EMA and through the HVE at $11.08." (PUMP, 2025-11-09, sunday-scans-720)
- Prior-day-low reclaim: "build a flag that held the 20EMA today. I bought with $117.60 average when we reclaimed the
  previous day’s low." and "Stay sharp and on my game by hitting a playbook pattern such as this." (XOM, 2025-11-19,
  the-rest-of-the-week-72c)
- Undercut and reclaim: "Highlighted this really awesome flag and pullback into the $190 spot and the 9EMA on
  Thursday. Gave a really nice opportunity on the undercut of the previous day and reclaim." (TWLO, 2026-05-17,
  sunday-scans-679)
- 20 EMA shakeout preferred: "Would prefer 20 ema shakeout but cant deny this tight flag, $122.40 trigger." (CLS,
  2025-06-08, sunday-scans); "Ideally get a shakeout to undercut the 20EMA and give a clearer and more confident area
  to risk against." (POWL, 2026-02-25, the-rest-of-the-week-b24)
- Hourly entries: "trying to develop a classic higher low and flag. I want it to hold $25 and give an entry on the
  hourly chart." (XPEV, 2025-11-16, sunday-scans-d6a); "Next hourly signal will be actionable." (INOD, 2026-01-14,
  the-rest-of-the-week-305); "That gap up kicker candle on Thursday was just so prime. Then the hourly flagging and
  breakout" (RIVN, 2025-12-21, sunday-scans-34b)
- Fast averages: "Looking now for daily consolidation and a flag to form out against the 5SMA." (RNG, 2026-03-08,
  sunday-scans-dcf)
- The first one: "Willing and ready to buy first flag and higher low. Will try as soon as Monday but prefer that it
  gets tighter." (NBIS, 2026-04-19, sunday-scans-33a); "setting up the first flag after pushing out of the $180 base
  that it was in for over a year. Triple inside days during the holiday week." and "If any weakness comes and this
  holds $230 that is a buy. On strength over $237 as well." (NTRA, 2025-12-28, sunday-scans-249)
- Inside days to tighten the risk: "Tight inside day on Friday following a 40% move off $10 support and now forming a
  very nice flag with a higher low hammer candle at the 20EMA." (WULF, 2025-12-07, sunday-scans-088); "Ideally we see
  a couple inside days around here to give some tighter risk area" (TER, a weekly base and flag, 2026-04-05,
  sunday-scans-356)

### 6.3 The owner on what to avoid
- Extended: "If this can give a nice tight flag that let’s the MAs catch up I will be very excited. Extended for now"
  and "Need perfect risk area to get involved imo." (LXU, 2026-03-22, sunday-scans-cab)
- Chasing: "OUST here would be a total chase." (2026-05-31, sunday-scans-6d8)
- Too many flags: "FCEL is on its 3rd daily flag in the past 4 weeks. Likely shakes a bit and forms a proper base or
  doesn’t. Wait for that to occur!" (2026-05-31, sunday-scans-6d8)
- Wedging up is not a flag: "Would love one more little shakeout to confirm it is not wedging up." (2025-08-17,
  sunday-scans-644)
- Day 1 beats the flag when you can get it: "Most people will wait for a flag or consolidation. If you get day 1 you
  have a massive cost advantage for sizing big and holding longer." (2026-01-27, the-rest-of-the-week-aaa)

### 6.4 The owner on holding
- "Nothing to do but let 20EMA guide the position." (WULF, after "Held the HVC (High Volume Close) for multiple
  sessions and build a perfect high tight flag.", 2025-09-14, sunday-scans-461)
- "Trail weekly 9EMA if in." (INTC, 2026-05-24, sunday-scans-ffb)
- "track weekly and daily pullbacks into rising moving averages. Ya know, what we always do." (2026-07-12,
  sunday-scans-898)

### 6.5 Bracco
- "The first “flag” or “consolidation” after the initial thrust off of the market lows last year was the best spot to
  get involved in the best stocks with size." (2026-04-12, sunday-scans-a43)
- "Never underestimate the first flag in the hottest theme after a multi-month breakout and market correction."
  (MU, 2026-05-24, sunday-scans-ffb)
- "would love an inside day or one more higher low to trade against." (CIFR, 2026-05-24, sunday-scans-ffb)
- "Usually will see some pretty intense back and forth volatility on the first pullback after an extension" (2026-05-17,
  sunday-scans-679)

### 6.6 Unsigned Index and ETF sections and intros
- "Want to give an important reminder that the first flags or check backs are usually a bit uncomfortable and wheezy."
  (intro, 2026-04-12, sunday-scans-a43)
- "Next optimal opportunity market wide would be flagging action into the 20EMA broadly." (2025-12-07, sunday-scans-088)
- "This HTF (High Tight Flag) this week is momentum and a classic continuation pattern for leaders." (XLV, 2025-11-23,
  sunday-scans-56d)
- Leadership tell: "while the Q’s flagged out to the 20EMA on June 23rd, the SMH stayed strong in comparison only
  touching the 9ema before pushing and making new highs." (2025-07-06, sunday-scans-df6)
- False flags: "it’s possible to view this as some slight wedging-up action below the 50% retrace of a bearish
  engulfing candle" (2026-09-13, sunday-scans-2f5); "Failed bull flag into failed breakdown/shakeout/squat leading us to
  new highs?" (IGV, 2025-10-12, sunday-scans-296)
- The bear flag: "Worst thing will be a low grind bear flag formation that drifts up and finds relentless sellers again"
  (SMH, 2025-11-23, sunday-scans-56d)
- Stops: "Nothing matters but your thesis and your stop." (unsigned "Thoughts on the Market" intro, 2026-01-07,
  the-rest-of-the-week-3f0; moved here in checking because no author is named on it)

### 6.7 Contributors in The Rest of the Week
- ChartMaster: "Can look for an entry thru the top of the flag or back up off defined support of the trendline." (EME,
  2025-10-01, the-rest-of-the-week)
- Alex Jones Industrial Average: "Bull flagging right into the 9EMA. Ran Monday’s low today and reversed." (CAT,
  2025-11-12, the-rest-of-the-week-045)
- Manrav: "got a power earnings gap with a strong close and now flagging on daily. Watch for a push above 27.5 to get
  long." (TDC, 2025-11-19, the-rest-of-the-week-72c); "Watch for a push above 27.3 to get long with low of the day as
  your stop." (CLPT, 2025-10-29, the-rest-of-the-week-757)
- ChartMaster, short side: "Bear flagging acting very weak, EMA’s crossing over to the downside. Looks a short ready to
  flush." (RDDT, 2025-10-15, the-rest-of-the-week-39d)

### 6.8 The owner's rulings in the repo
`docs/study/audits/2026-10-24/owner_verdicts.jsonl`:
- On the Oops Reversal (LQDA): "I want it in a flag or as a like double bottom, or wedging down, or at the end of a
  downtrend. Location matters big time on these"
- On the Go Signal: "GO SIGNALS are supposed to be notable hourly flags that undercut a slight range and quickly go red
  to green in the first hour"
So in his method a flag is often the **location** and another signal (Oops, Go Signal, U&R) is the **trigger**.

### 6.9 One pre-rulebook habit the rulebook now forbids
"only a 3% size using $86 as stop. If gives another shot and shows good buying I will gladly up it to standard
15-20%." (CRWV, 2026-01-25, sunday-scans-7fb). A5 (2026-11-09) now says full size at one price, one stop, no adding.

---

## 7. How it fits the account rulebook (section 9 of `docs/study/sizing_rule.md`)

Rules that apply as written:
- **B26 (hard), 200-day:** flags are uptrend setups. 98.5% of `uct_flag_htf` fires were above the 200-day. No conflict;
  the course should still state it.
- **C31, leaders:** RS 80 or more, strongest groups. Fits: Kullamägi scans the top 1% to 2% movers; Bonde ranks 65-day
  momentum; Bracco wants "the first flag in the hottest theme"; an unsigned UCT intro (2026-01-07,
  the-rest-of-the-week-3f0) names "our strategy of buying pullbacks/higher lows in thematic relevant groups".
- **B23 and D42, liquidity:** $10 and $20 million a day; never more than 1% of daily volume.
- **A3, F62, stop:** a few cents under the day's low or the prior day's low.
- **E57, E58:** market order when the trigger trades, regular hours only.
- **C28:** no buy more than 4% above the trigger.
- **C29:** skip if more than 10% above the 10-day average (the owner's LXU and OUST examples).
- **B19, E51, E52:** breakeven at 2R to 5R; a third off at 3R, a third at 5R; trail the rest under the 10-day (fast
  movers) or 21-day (steadier), out on a close below.
- **B20:** gap through the stop; the first 30-minute low is the new stop; out past 2R.
- **B22:** no new buy in the 3 days before earnings. Post-earnings flags are fine.
- **C33:** under 1R after 10 trading days, sell. This sits well with Edwards and Magee's three-week limit.
- **E56:** at most 3 tries a week, 6 a month (the owner "tried it a few times" on several flags).
- **B18, F65, D46:** Green full; Yellow smaller and fewer; Orange A+ only; Red mostly cash, plus shorts below the
  200-day (a guide, not a hard cap, A10).
- **D38, E49:** size by grade.

Conflicts and how to resolve them:
1. **Stop width (A13: "the stop usually sits within about 3% of the buy") versus the flag-low stop.** The flag low is
   a median 9.7% away in our scanner. Resolution: the stop comes from the trigger day's low or the prior day's low; the
   flag low is the line that kills the idea, not the stop. Even then only about a fifth to a quarter of prior-day-high
   entries had a stop within 3% (section 4.6), so the course must teach waiting for an inside day, a higher low or an
   hourly base to tighten the stop (the owner's own NTRA, WULF and TER notes, 6.2), or skipping (A3: "if the honest
   stop does not fit the risk, skip the trade").
2. **Kullamägi's partial after 3 to 5 days** versus B19's third at 3R. The house wins.
3. **The app's 2R and 3R targets** versus B19 and E51. The house wins; `make_levels` is shared by every UCT detector,
   so a change needs the owner's OK.
4. **The app's liquidity floor and its 200-day guard** are looser than B23 and B26. The course filters on the house
   rules regardless of what the scanner shows.
5. **Adding to a starter** (6.9) versus A5. A5 wins.

There is no conflict with B26's parabolic exception: a flag is not a parabolic setup. C34 covers selling into a climax
on a long you already hold; no house rule says whether a flag right after a parabolic burst may be bought. My proposal:
treat it as extended (C29) until the 10-day average catches up.

---

## 8. PROPOSED RULES for our course

Every line is measurable. Defaults are the house's unless the setup clearly needs its own.

### 8.1 What it is
1. **Trend.** Close above the 200-day SMA (hard) and above a rising 50-day SMA (higher than 10 sessions ago); the
   50-day above the 200-day. [house rule B26] + [my proposal, from the app's judged textbook check]
2. **Leader.** RS rating 80 or more, in one of the strongest groups. [house rule C31] + [UCT]
3. **Pole.** From the lowest low of the 20 sessions before the pole top to the pole top, a gain of **at least 20%**.
   30% or more is an A+ cue. The pole top is the highest high of the whole pattern. [my proposal; 20% from the judged
   textbook check, 30% from Kullamägi] Options: 30% or more, made over days to weeks sometime in the past 1 to 3
   months [originator: Kullamägi]; no number, "steep" or "straight-line" [source consensus: Edwards and Magee, Murphy,
   Bulkowski, ChartSchool]. Recommend 20%: it is measurable and its recognition passed blind judging, and the classics
   give no number.
4. **Length.** The flag runs **3 to 15 sessions** after the pole top. 16 to 20 sessions: B- at best. More than 20: not
   a flag; judge it as a base (flat base, VCP). [source consensus for the ceiling near 15 sessions: Bulkowski under 3
   weeks, Murphy 1 to 3 weeks, Edwards and Magee 3 weeks with a 4-week maximum] + [my proposal for the 3-session floor
   and the 16 to 20 band] Option: up to 2 months [originator: Kullamägi]. Recommend 15: three of four classic sources
   and the owner's examples fit it.
5. **Depth.** The flag's lowest low gives back **at most half of the pole** and sits **at most 15% below the pole
   top**. A third or less, and 10% or less, is an A+ cue. [source: Edwards and Magee let the decline reach a 40% to 50%
   correction, the deepest of their buy points; no second outside source gives a depth] + [my proposal for the half-pole
   and 15% caps; the app's judged check uses half the pole and 12%]
6. **Shape.** Sideways or drifting down, with lower or level highs. **Not up-sloping** (higher highs and higher lows
   through the pause is a wedge, not a flag). [source consensus for down or sideways: Edwards and Magee, Murphy,
   ChartSchool, Bulkowski, Zanger] + [UCT: "not wedging up"]. Note: Edwards and Magee allow a rare up flag that will
   "slope up a trifle", so the no-up-slope line is stricter than they are.
7. **Tightness.** The flag's average daily range (high minus low, as a % of the close) is smaller than the pole's.
   [my proposal, from Bulkowski's tight versus loose and Kullamägi's "tightening range"]
8. **Volume.** Average volume during the flag is below the pole's average volume. No flag session closes red with
   volume of 1.5 times its 50-day average or more. [source consensus for the direction: Edwards and Magee, Murphy;
   Edwards and Magee for the warning day, though their warning is any day of "notably increased volume", red or not] +
   [my proposal for the 1.5x number and the red-close condition]
9. **Averages.** Every flag session closes at or above the rising 21-day EMA (the app's judged check allows no close
   under it). An intraday undercut that closes back above is allowed and is often the buy. One close under it that is
   reclaimed the next session drops the grade to B- (see 8.5 and section 9); two closes under it end the flag. Riding
   the 9/10-day is an A+ cue. [UCT] + [the app's judged check] + [my proposal for the one-day grace]
10. **Liquidity.** Price $10 or more and $20 million or more traded a day; position no more than 1% of daily volume.
    [house rule B23, D42]
11. **Not stretched.** No more than 10% above the 10-day average at entry. [house rule C29]

### 8.2 The buy (the trigger and the order)
Three triggers. All are market orders when the level trades, regular hours only. [house rule E57, E58]
- **T1, support reclaim (preferred).** Inside the flag, price undercuts the prior day's low or tags the rising 9/10-day
  or 20/21-day average, then trades back above the prior day's low (or the average). Buy as it reclaims. [UCT: XOM,
  TWLO, POWL, CLS, JOBY] [source: Edwards and Magee buy inside the flag]
- **T2, prior-day-high break.** A session trades above the prior day's high while rules 1 to 9 hold, ideally as price
  remounts the 9 and 20 EMAs. [UCT: NTRA]
- **T3, flag-top breakout.** Price clears the flag's highest high since the pole top, ideally on rising volume, timed
  with the opening-range high. [source consensus] + [originator: Kullamägi]
- Recommend T1 and T2 as the course's main buys and T3 as allowed. Reason: the owner says to focus on support over
  confirmation, and in section 4.6 the T2-style entry had a nearer stop (median 4.8%) than the breakout with a day-low
  stop (6.8%); T1 was not measured. [UCT] + [my proposal]
- Chase limit: no buy more than 4% above the trigger level. [house rule C28]
- Not in the 3 days before earnings. [house rule B22]
- An Oops Reversal, a Go Signal or a U&R at the flag's support is a valid T1. [UCT verdicts for the Oops and the Go
  Signal, 6.8] + [the firm's earlier playbook text for the U&R, 5.5, not confirmed as the owner's words]

### 8.3 The stop
- A few cents under the low of the entry day, or under the prior day's low when that is the planned stop. A real stop
  order with the broker. [house rule A3, F62, D41]
- It should usually sit within about 3% of the entry. If the honest stop is wider than the stock's average daily range
  or about 5%, skip or wait for a tighter spot (an inside day, a higher low, an hourly base). [house rule A3, A13] +
  [originator: Kullamägi, stop no wider than the ADR] + [my proposal for 5%]
- The flag's low is the idea's invalidation, not the default stop. [my proposal, from section 4.6]
- Gap through the stop: the first 30-minute low is the new stop; out past 2R. [house rule B20]
- The stop only moves up. [house rule A4]

### 8.4 Trims and trail (house defaults)
- Breakeven at 2R to 5R. [house rule B19]
- A third at 3R, a third at 5R; if it opens above a trim level, trim at the open. [house rule B19, E51, F63]
- Trail the last third under the 10-day (fast movers) or the 21-day (steadier), out on a close below. [house rule
  E52] The owner's own flags lean to the 20 EMA ("let 20EMA guide the position"). [UCT]
- Sell a big part into a climax burst. [house rule C34]
- Time stop: under 1R after 10 trading days, sell. [house rule C33]
- The measured move (pole length added at the breakout) is taught as a reference only, never as a sell rule. [source
  consensus for the method] + [my proposal for the use]

### 8.5 What invalidates it
Before entry:
- More than 20 sessions since the pole top. [source consensus]
- A close under the 21-day EMA that is not reclaimed the next session. [UCT] + [my proposal for the one-day grace]
- Depth past half the pole or 15% from the top. [8.1 rule 5]
- Two or more heavy red days in the flag (1.5 times average volume or more). [Edwards and Magee] + [my proposal]
- Up-sloping (wedging up). [UCT]
- The third flag in a short run without a proper base (the owner's FCEL). [UCT] + [Edwards and Magee: "two surges"]
- The market reads Red (mostly cash and shorts) or Orange (A+ only). [house rule D46, F65; a guide, A10]
After entry: the stop; the time stop [house rule A4, C33]; a close under the flag's low [my proposal; both app
detectors put their stop at or under the flag low].

### 8.6 The short mirror (the bear flag)
- Below the 200-day SMA only (hard); a falling 50-day; RS 20 or less in the weakest groups; skip hard-to-borrow names.
  [house rule B26, C31, D47, D48]
- A sharp drop of at least 20% within 20 sessions, then a 3 to 15-session drift **up** on lighter volume that retraces
  at most half the drop and stays under the falling 21-day EMA. [mirror of 8.1] Edwards and Magee note down flags "tend
  to slope up" and in fast declines are "completed in a matter of three or four days rather than weeks". Murphy: down
  flags "often last no longer than one or two weeks." [source consensus]
- Trigger: a break of the prior day's low or the flag's low, at market. Stop a few cents above the day's high or the
  prior day's high. Trims and trail mirrored. [house rule D47]
- UCT has used the idea ("low grind bear flag", RDDT). Our `bear_flag` detector is hidden as noise. Bulkowski's down
  breakouts fail 45% of the time with an 8% average decline.

### 8.7 Best market conditions
- A Green market [house rule B18, F65]; indexes above a rising 20-day EMA [my proposal; not in the rulebook]; best of
  all the first flags in the leading theme after a breakout or a market correction. [UCT: Bracco; the unsigned index
  section's "flagging action into the 20EMA broadly"]
- Edwards and Magee's warning stands: flags "show up most frequently in the later, dynamic phase of Bull Markets" and
  may be "a warning that an advance is approaching its final weeks". [source] Grading later flags down is [my
  proposal]; they do not say late flags pay less.

### 8.8 Common mistakes
1. Buying the pole or chasing far above the trigger (C28, C29; "OUST here would be a total chase"). [UCT, house]
2. Calling a deep, loose, jagged pullback a flag. [Bulkowski; Model Book]
3. Ignoring volume: a flag on heavy, irregular volume is distribution. [Edwards and Magee]
4. Using the flag low as the stop when it is 8% to 15% away, then sizing too big or skipping the A13 check. [section 4.6]
5. Waiting for a confirmation breakout and getting stopped in the chop below it. [UCT: JOBY]
6. Buying the third or fourth flag late in a run. [Edwards and Magee; UCT: FCEL]
7. Mistaking a wedge-up for a flag. [UCT]
8. Sitting in a "forever flag" with no trigger. [UCT; C33]
9. Adding to a flag trade (A5) or averaging down. [house rule]
10. Expecting the shape alone to pay: measured, it does not (section 4).

---

## 9. Grading: what makes an A+ versus a B-

E50 says grading is the owner's judgment, so these are observable cues from the sources, not a checklist.

| Cue | A+ | A / B | B- | Not a trade |
|---|---|---|---|---|
| Pole | 30%+ fast, on a catalyst, HVE or earnings gap, heavy volume (Kullamägi; "straight-line", Edwards and Magee) | 20% to 30% | under 20% or slow | no pole |
| Which flag | the first after a base breakout or a market correction (Bracco; Edwards and Magee "first such move") | the second | the third or later (FCEL; "two surges") | |
| Length | 3 to 10 sessions ("3 day flag", HUT) | 10 to 15 | 16 to 20 (Edwards and Magee "suspicion") | over 20 |
| Depth | a third of the pole or less, 10% or less | up to half, to the 20/21 EMA with a reclaim | near half, ragged | over half or 15% |
| Averages | rides the 9/10-day ("short and shallow") | tags the 20/21 EMA and reclaims | closes under it once, reclaims | closes under and stays |
| Volume | dries to the flag's lowest in the last 2 to 3 days (Edwards and Magee: activity should "continue to decline until prices break away"; the 2 to 3 days is my proposal) | below the pole's | uneven | heavy red days |
| Tightness | inside day or narrow-range day before the trigger (Bonde; Bracco "an inside day") | tightening | loose, jagged (Bulkowski) | wedge-up |
| Stop at the trigger | 3% or less | 3% to 4% | 4% to 5% | wider than ADR or 5% |
| Stock and market | RS 90+, leading theme, Green | RS 80+, Green or Yellow | Yellow | Orange (unless A+), Red |

The stop-width, length and depth bands in the table are my proposal (section 8), not a source's numbers. Extra A+
cues from the sources: a flag above a flat base (Bulkowski); a post-earnings flag (Bulkowski's earnings flag; UCT's PEG
and earnings-flag examples). Bulkowski also finds "The best performers occur when the breakout is within a third of
the yearly low." That cuts against C31's leaders, which trade near their highs, so I do not propose it as a cue for us.

---

## 10. Questions for the owner

1. **One setup or two?** (A) One setup, "Bull Flag", with "Classic Flag/Pullback" as its alias in the journal;
   pullbacks to an average without a pole go to setup 12. (B) Keep two tags. Recommend A.
2. **The main buy.** (A) T1 and T2 first (support reclaim, prior-day-high break), T3 allowed. (B) Only the flag-top
   breakout. (C) Any of the three, with the stop rule deciding. Recommend A (your own words: support over confirmation).
3. **Minimum pole.** (A) 20% in 20 sessions. (B) 30% or more, made over days to weeks, within the past 1 to 3 months
   (Kullamägi). (C) No number. Recommend A.
4. **Maximum length.** (A) 15 sessions. (B) 20 sessions. (C) Up to 2 months, as Kullamägi. Recommend A.
5. **Maximum depth.** (A) Half the pole and 15% from the top. (B) A third of the pole. (C) Keep the scanner's 62%.
   Recommend A.
6. **Volume.** (A) Required: flag volume below the pole's. (B) A grading cue only. Recommend A.
7. **The 20 EMA.** Is the disqualifier a close under the 21-day EMA that is not reclaimed the next day, with an
   intraday undercut and reclaim being the buy? Yes or no.
8. **Stop width.** A13 says "the stop usually sits within about 3% of the buy". Do you want a hard maximum for flags
   (for example 5%, or the stock's ADR), or keep it as guidance?
9. **Measured move.** Teach it as a reference, or leave it out?
10. **Hourly flags.** Teach hourly flags in this lesson, or keep them with the Go Signal?
11. **Earnings flags.** Part of this setup, or of the Power Earnings Gap lesson?
12. **The bear flag.** Teach the short mirror now, or later?
13. **Scanner.** Course examples from the textbook-checked rule (20% pole, 12% depth, volume test) rather than the
   raw `uct_flag_htf`? Do you want `uct_flag_htf` tightened (volume, depth) or left admin-only? (Code changes need
   your OK.)
14. **Model Book text.** The playbook is not your words and calls the flag "one of the most reliable" patterns. Replace
   it with your own wording from this review?
15. **High tight flag boundary.** Flags with a 90%+ pole go to setup 03 only?

---

## 11. Sources (all read 2026-11-09)

| Source | Publisher / author | URL or location | Reliability note |
|---|---|---|---|
| Technical Analysis of Stock Trends, 11th ed., Ch. 11, 32, 33, preface, foreword | Taylor & Francis (Routledge / Productivity Press; catalogued as CRC Press, 2018; © 2019); Edwards, Magee, Bassetti (1st ed. 1948) | book; read in an OCR copy | Originator of the written rule. OCR artifacts; the 11th ed. adds editor notes (none quoted here). Opinions, no counts. |
| Technical Analysis of the Financial Markets, Ch. 6 | NYIF, 1999; John J. Murphy | book; read in an OCR copy | Standard textbook. No counts. OCR garbles some words. |
| Flag, Pennant | StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns/flag-pennant | Established educator; no author; "Last updated 2 years ago". First read through a fetch tool; the cold check saved it with plain curl and matched every quote. The page also carries machine-directed text, ignored. |
| Bulkowski on Flags | Thomas Bulkowski | https://thepatternsite.com/flags.html | Only large published count. AI notice on the site. Read through a fetch tool (plain curl refused, HTTP 406). |
| Glossary | Thomas Bulkowski | https://thepatternsite.com/glossary.html | Definitions behind his statistics. Same AI notice. |
| Earnings Flag | Thomas Bulkowski | https://thepatternsite.com/earnflag.html | His own event pattern. Same AI notice. |
| High and Tight Flag | Thomas Bulkowski | https://thepatternsite.com/htf.html | For the setup 03 boundary and his buy rule ("Only buy when price closes above the highest peak in the chart pattern (including the flagpole)."). Same AI notice. |
| 3 TIMELESS setups ... | Kristjan Kullamägi | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Originator, primary (2021). His income claims not verified. |
| FAQ | Kristjan Kullamägi | https://qullamaggie.com/faq/ | Originator, primary (2021). |
| Top 50 stocks for swing traders | Pradeep Bonde | https://stockbee.blogspot.com/2013/09/top-50-stocks-for-swing-traders.html | Originator, primary. |
| How to identify the A quality setup | Pradeep Bonde | https://stockbee.blogspot.com/2014/01/how-to-identify-a-quality-setup.html | Originator, primary. |
| How to make money using anticipation setup : KOD | Pradeep Bonde | https://stockbee.blogspot.com/2019/12/how-to-make-money-using-anticipation.html | Originator, primary. |
| Earnings and Bulkowski | Pradeep Bonde | https://stockbee.blogspot.com/2007/04/earnings-and-bulkowski.html | Originator, primary; quotes Bulkowski's book. |
| Price Action Trading Glossary | Brooks Trading Course | https://www.brookstradingcourse.com/price-action-trading-terms-glossary/ | Course glossary, no author named. A forum page with a student's definition was read and not used. |
| Flags & Pennants; Chart Patterns | Dan Zanger | https://www.chartpattern.com/flags-pennants.cfm ; https://www.chartpattern.com/chart-patterns.cfm | His own site; claims "research" without naming it. |
| Base Your Stock Buys On Bases ... | Investor's Business Daily, 2014-11-04 | https://finance.yahoo.com/news/stock-buys-bases-things-better-221700195.html | IBD column, syndicated. Read through a fetch tool. |
| AIQ Opening Bell, August 1997 | Linda Bradford Raschke interview | https://lindaraschke.net/wp-content/uploads/2026/01/august1997.pdf | Originator, primary; used only to show the Holy Grail is not a flag. |
| A dynamic trading rule based on filtered flag pattern recognition ... | Arévalo, García, Guijarro, Peris, ESWA 2017 | https://riunet.upv.es/bitstream/handle/10251/102317/ESWA%20Author.pdf | Peer-reviewed, author copy. Index data; template flag. |
| Trading rule discovery using technical analysis and a template matching technique ... | Lobão, Pacheco, Fernandes, Int. Studies of Economics 2024 | https://econpapers.repec.org/RePEc:wly:intsec:v:19:y:2024:i:2:p:168-185 | Peer-reviewed; abstract only. |
| UCT Substack, all 102 public posts (38 quoted after the cold check; the sitemap lists 103, one subscriber-only) and the About page | Uncharted Territory: Patrick (TSDR), Bracco, contributors | https://unchartedterritoryy.substack.com (sitemap and post API) | UCT's own words; outranks outside writers for "how we trade it". Authorship by section. |
| Account rulebook, section 9 | the owner, 2026-11-09 | `docs/study/sizing_rule.md` | House rules. |
| Owner verdicts | the owner | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | His words. |
| Trade plans | repo | `docs/study/TRADE_PLANS.md` | No flag row. |
| Scanners | repo | `api/services/pattern_engine/detectors/uct/uct_flag_htf.py`, `.../classical/bull_flag.py`, `bear_flag.py`, `pennant.py`, `.../uct/high_tight_flag.py`, `uct_pullback_ma_v5.py`, `pullback_to_10ema.py`, `pullback_to_21ema.py`, `pullback_to_50sma.py`, `holy_grail.py`, `uct_setups_common.py`, `primitives/liquidity.py`, `pattern_engine/tag_textbook.py`, `services/setup_tags.py`, `detectors/registry.py`, `pattern_vision/rubrics.py`, `tests/test_negative_outcome_withheld.py` | What the app actually does. |
| App pages | repo | `app/src/pages/modelbook/setupCatalog.js`, `setupPlaybooks.js` (and its git history), `app/src/constants/setupGroups.js`, `app/src/pages/journal-2-0/lib/setupTagMap.js`, `notebookTemplates.js` | The playbook text is not the owner's words (5.5). |
| Study and research notes | repo | `docs/study/UNITS-method.md`, `docs/study/research/definitions.json`, `docs/wisdom/vocabulary/setup-vocabulary-v1.json`, `docs/superpowers/research/bases/01-bulkowski-classic-patterns.md`, `02-oneil-ibd-base-taxonomy.md`, `06-edwards-magee-murphy-canon.md` | Earlier internal research, cross-checked here against the sources. |
| Investopedia, Flag | Investopedia | https://www.investopedia.com/terms/f/flag.asp | Not read today (blocked); nothing quoted. |

---

## 12. Cold check (2026-11-09)

A second reader re-opened every source: the 64 UCT Substack passages (60 from the first draft plus 4 added) matched
word for word, with their dates and the section each sits in; every outside quote was re-matched at its source (see
the header for how); the two owner verdicts and every rulebook rule cited in sections 7 and 8 were re-read; section 5
was re-read against the code and the git history. No quote in the first draft was invented or put in the wrong
person's mouth. What changed is wording that went past its source, code details that did not match the code, and
tags that claimed more agreement than the sources give.

### Corrected in checking
1. 11th edition publisher: the scan's copyright page reads "© 2019 by Taylor & Francis Group" (Productivity Press,
   Routledge); "CRC Press, 2018" is how library catalogues list it. Both now given (3.1, 11).
2. Edwards and Magee target pages: the measuring rule is on pp. 154 to 155 and the semilog note on p. 156 (was "pp. 154
   to 156" for all of it). The rule's middle step, measuring "to the Minor Reversal level at which the Flag or Pennant
   started to form", was added (3.1).
3. Edwards and Magee's volume rule was quoted without its exception, "except the increasing volume that
   characteristically attends the start of the breakout drive"; restored (3.1).
4. Kullamägi's pole was summarised as "30% to 100%+ in 1 to 3 months". His words: the move came "sometime in the past
   1-3 months" and "usually lasts a few days to a few weeks". Fixed in 3.13, 3.14, 8.1 rule 3 and question 3.
5. Volume: Zanger ("generally contracts", in his pennant paragraph) and Bonde ("preferably orderly") were listed as
   making drying volume a requirement; they state a tendency. Fixed in 3.14 item 5 and 5.7 item 1.
6. Bulkowski's flag trigger was given as "trendline pierce or close outside"; his glossary's breakout is "When price
   pierces a chart pattern trendline or above the top or below the bottom of a chart pattern", with no close (3.13).
7. "Bulkowski's count says the opposite" (of "most reliable") became the numbers themselves (3.14 item 9, 5.7 item 9).
8. Section 3.14 item 8 mixed two questions (where in the move, where in the bull market); split.
9. `uct_flag_htf` (5.1): it refuses fewer than 220 bars and declares 222 to the scan (was "needs 222"); the pole low is
   the lowest of 41 bars, the pole-high session and the 40 before it (was "40 sessions"); "forming" is tried only when
   the breakout case fails (was "no breakout yet"). Added: relative volume feeds the confidence score but cannot block
   a fire (lowest possible score 53.5 against a floor of 50).
10. Textbook check (5.2): the pole top is 5 to 20 bars before the marked session in the code (its comment says 4 to 20).
11. `bull_flag` (5.3): its drawing reaches members only behind `AUTO_STRUCTURES_MEMBERS_ENABLED` and only for round-9
    rows (was "public; its drawing is served to members"). Its target is "usually higher" than the classic rule (was
    "the most aggressive of all", which is not always true).
12. Pattern Vision must-have quoted in full: "A clear, steep pole (sharp advance)" (5.4).
13. The unsigned quote "Nothing matters but your thesis and your stop." sat under the heading "The owner on what to
    avoid"; moved to the unsigned section 6.6.
14. "The owner and Bracco want 'the first flag in the hottest theme'": that sentence is Bracco's alone (section 7).
15. Market filter: "Red no new longs" is not the rulebook's wording. D46 and F65 say Red is mostly cash plus shorts, and
    A10 makes it a guide (sections 7 and 8.5).
16. The parabolic paragraph in section 7 presented "not a new buy" as if C34 said it; C34 is about selling a long you
    hold. Now tagged as my proposal.
17. Rule 5 (depth) was tagged [source consensus] on Edwards and Magee plus the Model Book playbook, which is not the
    owner's words and not an outside source. Only Edwards and Magee give a depth, and as the deepest of three buy
    points, not a maximum. Retagged.
18. Rule 4 (length): the 3-session floor and the 16 to 20 band are my proposal; only the ceiling has source consensus.
19. Rule 6 (shape): Edwards and Magee allow a rare up flag that will "slope up a trifle"; the rule now says it is
    stricter than they are.
20. Rule 9 (averages) said every flag session must close above the 21-day EMA, while 8.5 and section 9 allowed one
    close under it if reclaimed the next day. Reconciled with a stated one-day grace.
21. Section 8.7: "indexes above a rising 20-day EMA" was tagged as a house rule; it is not in the rulebook. And Edwards
    and Magee do not say late flags "pay less"; they call them a warning that the advance is near its end.
22. Section 9 volume cue: the "last 2 to 3 days" is my number, not Edwards and Magee's.
23. Bulkowski's "breakout within a third of the yearly low" was offered as an A+ cue; it cuts against C31 (leaders near
    their highs), so it is now listed but not proposed.
24. Section 4.3: the abstract says "DJIA index", but the paper's data are 15-minute candles of the DJIA future; the
    paper also builds on its authors' own 2015 flag rule (Cervelló-Royo, Guijarro and Michniuk).
25. Section 4.6: the survivorship caveat was "not checked"; the cold check found that every stock in the database with
    1,500 or more daily bars has bars into 2026, so the sample holds no delisted names and the results lean high. The
    table's first rows were reproduced from the saved fire file; the prior-day-high rows were re-run on today's (grown)
    database and agree within about a point. Two rows were added.

### Added in checking (sources the first draft missed or cut short)
- Edwards and Magee p. 392: wait for "a nearly vertical, almost unbelievable rise, followed by several days of
  congestion with practically no volume", and sell if it "continues or sags off for more than about three weeks".
- Edwards and Magee p. 411: in a horizontal flag a buy is justified "at almost any point in the pattern".
- Murphy's own summary, p. 145 (one to three weeks "on very light volume"; "about the midpoint").
- ChartSchool: "mark a midpoint of the move"; "some consider eight weeks to be pushing the limits".
- Bulkowski: "If you don't have a straight-line (or a quick move) price run (the flagpole), then you don't have a
  flag."; his high and tight flag buy rule; his glossary definitions of break-even failure, ultimate high and bull
  market.
- Kullamägi's own ADR example for the stop cap.
- Bonde's KOD post: "It is also called High Tight Flag", the market-on-open entry and the 0.62% risk.
- The owner: NTRA's first flag with triple inside days and both a weakness buy and a strength buy (2025-12-28); WULF's
  inside day and higher-low hammer at the 20 EMA (2025-12-07); TER's "couple inside days" for tighter risk
  (2026-04-05).
- The firm's earlier High Tight Flag playbook text from git history (a prior-day-high trigger on the 10-day SMA, a stop
  "only if that stop is within 3% of entry"), flagged as not confirmed to be the owner's words.

### Removed in checking
1. "'Perfect trades' are idealised (no costs, ideal exits)": Bulkowski's flags page and glossary do not define the
   term, and I could not find his definition. Replaced with "read it as idealised trades, not real fills".
2. "Richard W. Schabacker (1920s and 1930s)": the dates are not in any source read here. Removed; the Foreword's 1937
   revision of his book is given instead.
3. "Bulkowski ... named the 'earnings flag'": coinage not confirmed. Now "describes".
4. "momentum pause" as one of Bonde's names: a paraphrase, not his term. His term "Ants" was added.
5. "Caution: the rise [of the earnings flag] is measured to the ultimate high": not stated on that page. Replaced with
   what the flags page does say.
6. "the most aggressive of all" (the `bull_flag` target): removed. "This is the strictest and most textbook-faithful
   rule in the app" is kept only as a labelled judgment.

---

## 13. Examples (from our data)

(Numbered 13 because section 12 is the cold check. Scan, charts and numbers: 2026-11-09 night, from the sandbox's
daily bars; scripts `scan2.py`, `pick2.py`, `stats2.py` in the setups scratchpad, folder `02-bull-flag/final/`.)

**The scan's rule in one paragraph.** On every one of the 2,630 names that ever met the liquidity rule (B23: $10 or
more, $20 million or more a day, measured as the 50-day average dollar volume on the day before entry), a hit is the
first session that trades above the prior day's high (trigger T2, 8.2) after a flag that holds every rule of 8.1 on
every one of its sessions: close above the 200-day SMA and above a 50-day SMA that is higher than 10 sessions earlier
and above the 200-day (rule 1, B26); a pole top that is the highest high of the pattern and of the 20 sessions before
it, at least 20% above the lowest low of those 20 sessions (rule 3); a flag of 3 to 20 sessions after the pole top
(rule 4; 3 to 15 is the rule, 16 to 20 kept as B-); a flag low no more than 15% under the pole top and giving back no
more than half the pole (rule 5); a least-squares slope of the flag's highs at or below zero (rule 6); a mean daily
range and a mean volume in the flag below the pole's (rules 7, 8); no red flag session on 1.5 times its 50-day
average volume or more (rule 8); a rising 21-day EMA with at most one flag close under it, reclaimed the next
session (rule 9); entry no more than 10% above the 10-day SMA (rule 11, C29). The entry is a market order at the
prior day's high plus one cent, or at the open when the stock gaps over it, and no fill more than 4% above the
trigger (E57, C28). The stop is 5 cents under the lower of the trigger day's and the prior day's lows; if that is more
than 3% away, 5 cents under the trigger day's low; if still more than 5%, no trade (A13 and 8.3). B22 (no entry in
the 3 sessions before a report) is applied to the examples. Not coded: RS 80+ and group rank (C31), which flag of
the run it is, the market colour, and the intraday T1 reclaim, which daily bars cannot see.

**Base rate (window 1996-02 to 2026-11; the first hit is in 1996 because the dollar-volume gate needs a 50-day
history and a $20M tape).** All 2,630 names were scanned (175 seconds): 11,707 hits in all; 11,190 on stocks with a
3-to-15-session flag. Of those, **30.5% reached 3R and 21.4% reached 5R** before the stop within 60 sessions, with a
FIXED stop at the entry-day low and no trims, no breakeven move, no trail. 89% were eventually stopped inside the
60-session window, because with a fixed 1-to-3% stop and no management almost every trade comes back to it sooner
or later; the 3R and 5R figures are the ones that matter for the house plan (a third off at 3R, a third at 5R, B19).
Splits from `final/buckets.txt`: a stop within 3% (A13) 32.5% / 22.9% against 20.4% / 13.5% for a 3-to-5% stop; the
trigger day also clearing the flag's high (T3 on the same day) 41.7% / 30.9% against 26.1% / 17.6% when it did not;
trigger-day volume of 1.5 times average or more 47.3% / 36.9% (only 582 hits) against 29.6% / 20.5%; a pole of 30%
or more 31.7% / 22.4% against 29.8% / 20.8% for 20 to 30%; the 16-to-20-session band 29.2% / 18.3% (120 hits). The
flag being 10 to 15% deep did slightly better (36.6% / 26.5%, 1,330 hits) than 10% or shallower (29.7% / 20.7%),
which cuts against the A+ cue in 8.1 rule 5; one scan is not enough to drop the cue, but the owner should know.
Caveats: a daily-bar scan with no RS, group or market filter; survivorship (the database leans to names that still
trade); the fixed stop. The all-years base rate is close to the 2015-and-later one (29.6% / 20.5%).

**The 10 examples** (one per ticker; `final/01_..10_*.png`, phone sheets `final/sheet_1-4.png`, `sheet_5-7.png`,
`sheet_8-10.png`; numbers in `final/examples.json`). "Pole" is pole low to pole top; "flag" is sessions after the
pole top; depth is the flag low under the pole top; best R is the highest high within 60 sessions over the fixed
stop. Dates are the entry day.

| # | Ticker | Entry | Pole | Flag | Depth (of pole) | Flag vol / pole vol | Buy | Stop (%) | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | UIS | 1997-09-09 | +34% in 20 d to 118.12 (1997-08-27) | 7 d, 110.62 to 116.88 | 6.3% (25%) | 0.51x | 112.51 | 110.58 (1.7%) | 27.2 | A seven-day drift on half the pole's volume riding the 10-day; the trigger day cleared the flag's high on 2.3x volume and ran for six weeks. |
| 2 | QCOM | 1999-06-29 | +60% in 18 d to 17.19 (1999-06-22) | 4 d, 15.62 to 16.88 | 9.1% (24%) | 0.72x | 16.89 | 16.54 (2.0%) | 22.8 | The classic 1999 leader: steep pole, four quiet days to the 10-day EMA, a 2% stop, 3R the next session. |
| 3 | ISRG | 2005-11-10 | +50% in 15 d to 10.65 (2005-11-03) | 4 d, 10.06 to 10.50 | 5.6% (17%) | 0.38x | 10.63 | 10.46 (1.7%) | 28.7 | An earnings-gap pole (report inside the pole), four sessions on a third of the pole's volume, a gap-open entry still inside the 4% chase limit; never looked back. |
| 4 | BB | 2007-08-29 | +37% in 4 d to 84.10 (2007-08-22) | 4 d, 77.04 to 82.12 | 8.4% (31%) | 0.28x | 80.41 | 78.66 (2.2%) | 32.3 | A near-vertical four-day pole, then four days on a quarter of the volume; the prior-day-high buy came before the flag's high broke (T2 ahead of T3). |
| 5 | NUS | 2013-07-18 | +39% in 12 d to 79.96 (2013-07-11) | 4 d, 76.39 to 79.90 | 4.5% (16%) | 0.75x | 78.01 | 76.81 (1.5%) | 18.3 | A tight four-day shelf 4.5% under the top; trigger day on 3.7x volume cleared the flag high; 3R the next day. Report inside the pole. |
| 6 | RARE | 2015-05-27 | +53% in 13 d to 85.93 (2015-05-19) | 4 d, 80.25 to 85.79 | 6.6% (19%) | 0.59x | 83.26 | 81.18 (2.5%) | 25.9 | A staircase leader: pole, four-day rest at the 10-day EMA, prior-day-high buy, stop 2.5%, then a second leg of the same size. Report inside the pole. |
| 7 | AMD | 2018-08-21 | +29% in 14 d to 20.28 (2018-08-14) | 4 d, 18.73 to 20.10 | 7.6% (34%) | 0.75x | 20.09 | 19.81 (1.4%) | 50.2 | The owner's kind of flag: a 1.4% stop under a four-day pause after an earnings-gap pole, then 20 to 34 in five weeks (50R on the fixed stop). |
| 8 | SHOP | 2020-05-04 | +99% in 12 d to 66.57 (2020-04-21) | 8 d, 59.50 to 66.26 | 10.6% (21%) | 0.85x | 62.80 | 61.65 (1.8%) | 41.7 | A doubled pole off the 2020 low, an eight-day flag that held the 21-day EMA on every close, buy under the flag's high with a 1.8% stop. |
| 9 | PANW | 2020-12-03 | +36% in 18 d to 49.75 (2020-11-25) | 4 d, 48.30 to 49.63 | 2.9% (11%) | 0.53x | 48.98 | 48.29 (1.4%) | 26.4 | The tightest of the ten: four sessions in a 2.9% range on half the pole's volume; the A+ cues (a third or less of the pole, 10% or less) both met. Report inside the pole. |
| 10 | TSEM | 2025-09-17 | +49% in 19 d to 67.75 (2025-09-10) | 4 d, 64.59 to 67.67 | 4.7% (14%) | 0.81x | 66.62 | 64.78 (2.8%) | 34.2 | A recent one: a four-day flag on the 10-day EMA, trigger day cleared the flag high, nine sessions to 3R and then a run to 100+. |

Two examples are from 2020 (SHOP, PANW): both were kept because they are the two cleanest shapes of the whole
candidate list; every other year is distinct (1997, 1999, 2005, 2007, 2013, 2015, 2018, 2025). Five of the ten have
a report inside the pole (ISRG, NUS, RARE, AMD, PANW), which fits Bulkowski's earnings-flag observation and the
owner's NTRA: the best poles are often earnings gaps. UIS 1997 and QCOM 1999 are before the earnings file's
coverage (about 2005 on), so their poles cannot be classed as earnings or news. None of the ten was entered in the 3
sessions before a report (B22) and none of the trigger days is itself an earnings reaction day. RS 80+ was not
measured; every one of the ten was at or near a 6-month high at the pole top.

**Rejected while looking at the charts.** MGA 2014-02-25 ranked in the top 20 on the numbers (a "+171% pole") and is a
data hole: the bars jump from 2010-05 straight to 2014-02, so the pole is a four-year gap, not a move. BIDU
2007-10-02 (0.6% stop) and TEAM 2026-08-27 (0.8% stop, a 122% pole that dwarfs the flag) were valid but unreadable
as teaching charts; AAPL 2026-07-24 and NVDA 2021-06-11 had a jagged run into the pole; VSAT 2025-06-25 is a valid
116R winner whose R-lines sit on top of each other at $13. No ETFs were in the final set.

**Notable failures (fixed stop, same rule; charts in `charts_fail2/`).**
- QCOM 2019-05-10: a textbook-looking five-day flag (pole +62% in 14 days on an April 2019 gap, flag 8.9% deep on
  0.44x the pole's volume, stop 1.8%). The trigger day was the high; the stock reversed and fell about 25% over the
  next four weeks. The pole was a one-day gap rather than a trend, and the flag sat in the pole's third week: the
  lessons are 8.5 (a parabolic pole is not a leader's pole) and the time stop.
- STZ 2013-03-04: a four-day flag 3.1% deep on a quarter of the pole's volume, the kind of tightness the rules
  reward. It broke out, failed within days (best 0.85R), hit the 1.8% stop, and then ran to 50 without us. A clean
  shape still loses about seven times in ten before 3R under a fixed stop; the house answer is the small stop and
  the next trigger, not a wider stop.
- LLY 2024-08-30: a five-day flag at all-time highs after a +30% pole, stop 2.25%, best 0.56R. The breakout failed
  the same week and the stock drifted under the 50-day for two months. A later flag in a long run (the "third or
  fourth flag" of 8.8) in a stock already extended on the weekly chart.

---

## 14. Failures and near-misses (from our data)

(Added 2026-11-10, deliverable 4 of `CRITERIA_PROGRAMME.md`. Every number is read off the sandbox's daily bars with the same scan and the same fixed-stop walk as the examples section above; charts in `_study-resume/scratchpad/setups/02-bull-flag/final/` (`fail_1-4.png`, `near_1-4.png`, `pair_03-high-tight-flag.png`), numbers in `final/failures.json` and `final/near_misses.json`, scripts `near_scan_*.py` and `failnear_*.py` in the setup's scratchpad folder, outside the repo.)

**Four failures.** Valid bull flag setups by every gate of the card, bought by the rules and stopped before 3R (fixed stop under the day's low, no trims, no breakeven move). Dates are the trigger day; "where it stopped" counts sessions after the trigger.

| Ticker | Date | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|
| QCOM | 2019-05-10 | 84.85 | 83.30 (1.83%) | day 1 (2019-05-13, low 82.99), best 0.0R | A 5-day flag 8.9% deep (23% of the pole) on 0.44x the pole's volume after a 62% pole made in 14 days on one April 2019 gap. The trigger day closed at the high (85.84) on 0.76x volume and was the top; the next session's low (82.99) took the stop and the stock fell for four weeks. | `bf.not_after_burst` |
| STZ | 2013-03-04 | 44.34 | 43.55 (1.78%) | day 2 (2013-03-06, low 43.07), best 0.85R | A 4-day flag 3.1% deep (8% of a 59% pole) on a quarter of the pole's volume. The trigger day closed at the high on 0.32x volume, reached 0.85R and hit the stop on day 2 (low 43.07); the stock then ran to 50 without us. | `bf.stop` |
| LLY | 2024-08-30 | 957.53 | 935.95 (2.25%) | day 3 (2024-09-05, low 906.17), best 0.56R | A 5-day flag 3.8% deep after a 30% pole at all-time highs, on 0.51x the pole's volume. The trigger day closed at the high on 0.76x volume, made 0.56R and was stopped on day 3 (low 906.17). A later flag in a long run in a stock already extended on the weekly chart. | `bf.inv_third_flag` |
| TSLA | 2023-07-12 | 276.33 | 271.41 (1.78%) | day 1 (2023-07-13, low 270.60), best 0.0R | A 5-day flag 6.7% deep (26% of a 36% pole) on 0.71x the pole's volume. The trigger day traded through the prior high and closed at the low of its range (271.99) on 0.69x volume; the stop was 1.78% under the fill against a 3.91% average daily range and the next session's low (270.60) took it. | `bf.stop_width` |

**Four near-misses.** Charts that look like a bull flag but fail exactly one gate of the card. Each came from re-running the setup's scan with that one gate relaxed and keeping only the hits the strict rule rejects for that criterion; everything else passed. The outcome is the same fixed-stop walk, for information only: a near-miss that worked is still not the setup.

| Ticker | Date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|
| META | 2025-07-09 | `bf.pole` | pole +18.2% in 20 sessions; the rule is 20% or more | A tidy 5-day, 4.7% pause on 0.75x volume, but the rise before it was 18.2% in 20 sessions. No pole, no flag: a pullback in an uptrend, judged under the moving-average pullback card (setup 12). Best 1.58R, stopped. |
| AXON | 2024-04-04 | `bf.length` | flag of 21 sessions; the rule is 3 to 15 (16 to 20 B-), past 20 it is a base | A 30% pole and a 6.6%-deep pause on 0.81x volume that ran 21 sessions. Past 20 sessions it is a base, judged as a flat base (setup 01) or a Qullamaggie consolidation (setup 18). Best 0.0R, stopped. |
| DKNG | 2021-02-19 | `bf.depth_half_pole` | flag low gives back 55% of the pole; the rule is half or less | A 7-day flag only 12.8% under the top on half the pole's volume, but the low gave back 55% of the pole. A pullback that retraced more than half the pole is a deeper retest, closer to a pullback to the 21 EMA or the 50-day (setup 12) than to a flag. Best 3.01R, stopped. |
| BA | 2020-12-01 | `bf.shape` | flag highs rise +5.6% across the flag; the rule is a flat or falling line of highs | A 7-day pause 10.7% deep after a 58% pole, but its highs rose 5.6% across the pause. Higher highs and higher lows through the rest is a wedge up (bf.inv_wedge_up), not a flag. Best 0.0R, stopped. |

**What the failures have in common.** Three of the four were stopped within three sessions and all four triggered on below-average volume (0.76x, 0.32x, 0.76x and 0.69x the 50-day). Three closed the trigger day at the high and still failed (QCOM, STZ, LLY): a strong close on a light-volume T2 does not make a flag work, and two of them were late or one-gap poles (LLY, QCOM). TSLA closed at the low with a stop inside its daily range. The answer the card gives stands: the small stop, the time stop and the next trigger, not a wider stop.

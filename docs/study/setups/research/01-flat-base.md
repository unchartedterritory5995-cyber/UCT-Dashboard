# Setup 01: Flat Base Breakout (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Where I could not
read a source, I say so and give no wording from it.

**How the quotes were checked.** Every quote is 40 words or fewer and copied from the page named next to it. Two kinds:
- **Checked against a saved copy** (downloaded and searched word for word): UCT's Substack, qullamaggie.com, Kell
  Trading, the TraderLion pages (read through the Internet Archive, because traderlion.com refused the download),
  Stockbee, MarketSmith, Wyckoff Analytics, stageanalysis.net and our own code.
- **Read through a page-reading tool** (the site refused a plain download): the IBD columns syndicated on Yahoo Finance
  and Bulkowski's thepatternsite.com. The tool drops words that are links on the page. Where that happened I quote
  only the part that is whole, and say so. Check these against the live page before a quote goes into a lesson.

**Cold check (2026-11-09, a second reader).** Every quote below was opened again, independently, and found on its page
word for word and in context, except where this file now says otherwise. How: IBD columns S2 and S6 word for word
against Internet Archive copies of the Yahoo pages (captured 2012-10-27 and 2015-05-14); S1, S3, S4, S5, S7 and S8
sentence by sentence through a page reader (Yahoo refused a plain download, HTTP 429); Bulkowski's pages word for word
against Internet Archive copies (captured October 2026; the Volume Study page April 2026), because thepatternsite.com
refuses a plain download (HTTP 406); everything else downloaded fresh and searched. Substack dates are each post's
publish date in US Eastern time. Every fix and removal is listed in "Removed in checking" at the end.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the people who named or
codified it (IBD / William O'Neil and his MarketSmith data firm); **[UCT]** the owner, Bracco or the Substack;
**[house rule]** the account rulebook, `docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for
the owner to accept or change.

Terms. **Pivot**: the price the stock must trade through, the top of the base. **Left-side high**: the high where the
base begins. **Depth**: the fall from the left-side high to the base's lowest intraday low, in percent. **LOD**: low of
the day. **R**: the risk on the trade (entry minus stop). **ADR**: average daily range in percent. **RS rating**:
relative strength, 1 to 99. Moving averages: 10-day, 21-day (EMA), 50-day and 200-day (SMA).

---

## 1. What it is

After a strong advance, a stock rests sideways for at least about five weeks in a tight range that falls no more than
15% from its high. The trade is the breakout: you buy as price trades through the top of that range, with a stop just
under that day's low.

**Why it works (the psychology).** Each point names its source. The "who is trapped" point is my reasoning. None of
it is a measured fact.
- Leaders move in steps. Kristjan Kullamägi: "they tend to move in stair steps. Meaning they will make a 20-50%+ move,
  pull back and go sideways for a while, then make another move." ([qullamaggie.com, 2021](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/))
  The flat base is the "go sideways" step.
- The time in the base shakes out weak holders. IBD on the five-week minimum: "Shorter patterns are not adequate
  enough to flush out weak or impatient shareholders." ([IBD via Yahoo, 2013](https://finance.yahoo.com/news/flat-simple-pattern-does-fine-205400421.html))
- The Wyckoff school calls a range inside an uptrend a re-accumulation: "Trading ranges (TRs) are places where the
  previous trend (up or down) has been halted and there is relative equilibrium between supply and demand."
  ([Wyckoff Analytics](https://www.wyckoffanalytics.com/wyckoff-method/)) The breakout is their "sign of strength".
- The shallow depth is the point. Holders keep most of their gain, so few are desperate to sell. TraderLion: "This
  shallow depth signals strength and stability, as the stock holds its gains without major pullbacks, showing that
  sellers are not overwhelming the market." ([TraderLion, 2023](https://traderlion.com/technical-analysis/the-flat-base-pattern/))
- Who is trapped at the breakout (reasoning): people who sold each time the ceiling stalled, short sellers betting the
  range holds, and holders who sold out of boredom in the base. All of them must buy back higher. Our own flat-top
  scanner's text says it the same way: "A ceiling that has rejected price more than once collects the supply of
  everyone selling there; a close through it says that supply is gone." (`uct_flat_top_breakout.py`, in-house text,
  not a source)
- Quiet volume in the base is read as sellers running out. Bracco on TSLA: "Weekly chart extremely tight with volume
  drying up within the base." ([Sunday Scans, 2025-09-07](https://unchartedterritoryy.substack.com/p/sunday-scans-52e))
  Section 4 shows the measured evidence on volume is mixed.
- The owner's one-line version of the whole idea: "Look for tightness with potential for expansion."
  ([Sunday Scans, 2025-10-05](https://unchartedterritoryy.substack.com/p/sunday-scans-6ef))
- Caution: the usual story is that institutions are quietly accumulating (TraderLion tells it). No source I read
  measured it.

---

## 2. Origin and naming

**Who named it.** The flat base is one of the base patterns taught by William O'Neil and his newspaper, Investor's
Business Daily (IBD). The oldest IBD column I could read is from 2008 (Alan R. Elliott): "A flat base is one of the
more bullish price patterns. The shortest of the major base patterns" (lead paragraph only, the rest is behind IBD's
paywall; [IBD, 2008-10-17](https://www.investors.com/ibd-university/how-to-buy/flat-base/)).

**O'Neil's book.** O'Neil describes it in *How to Make Money in Stocks*. I could not read the book in this pass, so no
edition, chapter or page is cited here. Two people quote it:
- Pradeep Bonde (Stockbee), 2011: According to O'Neil a "flat base usually occurs after a stock has advanced 20% or
  more off a cup with handle pattern". He does not name the edition. ([Stockbee, 2011-12-13](https://stockbee.blogspot.com/2011/12/william-oneil-setups.html))
- TraderLion quotes O'Neil on base length (no book named): "with the exception of high, tight flags, ... flat bases
  of five or six weeks, and the square box of four to seven weeks, the most reliable base patterns must have a minimum
  of seven to eight weeks". ([TraderLion, 2023](https://traderlion.com/technical-analysis/the-flat-base-pattern/))

**Automated by O'Neil's data firm.** MarketSmith (William O'Neil + Co.) detects it by rule: "Flat bases form over a 5
to 65 week range. The minimum depth is 0% with a maximum of 15%." ([MarketSmith Hong Kong](https://www.marketsmith.hk/flat-base/?lang=en))

**Older and parallel names for the same shape.**
- **Darvas box.** Bonde: "This is nothing but Darvas box setup. But again O'Neil has added significant details to
  define it." (Stockbee, 2011, link above.) Nicolas Darvas's own book was not read.
- **Rectangle** (classical charting). Bulkowski's "Rectangle Tops" is a flat range after an uptrend
  ([thepatternsite.com](https://thepatternsite.com/recttops.html)).
- **Re-accumulation trading range** (Wyckoff school, link above).
- **Stage 2 continuation** (Stan Weinstein's school): a consolidation above a rising 30-week average, then a new high.
  Weinstein's book was not read; the wording I have is a community checklist ([stageanalysis.net, 2019](https://www.stageanalysis.net/blog/4372/stage-analysis-breakout-quality-checklist)).
- **Base 'n Break** (Oliver Kell, step 4 of his "Cycle of Price Action"): "Constructive consolidation followed by
  continuation." ([kelltrading.com](https://kelltrading.com/)) The owner uses Kell's terms (wedge pop, EMA crossback,
  reversal extension) often in his Substack sections: about twenty paragraphs in his own sections by the checker's
  count (the exact number depends on how a passage is split).
- **Breakout setup** (Kristjan Kullamägi): "It's pretty much flat channels, symmertrical and descending triangles."
  (qullamaggie.com, 2021; his spelling.)
- **UCT's own words** (section 6): "flat base breakout", "flat top breakout", "clean flat pivot", "$160 flat", "base
  breakout", "weeks tight", "NMS (Need More Sideways)". The owner's verdict log calls the family "BaseBreakouts".

**A name clash to fix in the course.** Bulkowski's "flat base" is a different pattern: a horizontal price area of any
length, used as a bottom. His example comes after a steep drop, and he writes: "I examined rectangle bottoms, which
are a special case of a flat base." His page: "The length of the flat base can be any duration, depending on your
scale (intraday, daily, weekly)." ([thepatternsite.com, Flat Base](https://thepatternsite.com/FlatBase.html)) Study's
lessons V.02 and V.04 already quote Bulkowski's flat base. Our setup is O'Neil's, which rests an advance near the highs.

**"Flat top breakout".** I found no originator for this name. UCT contributors use it for a clean horizontal ceiling. Our `uct_flat_top_breakout` scanner (admin-only as a scan result; its drawing can be
shown to members, 5.2) is a much looser rule (section 5).

**Neighbors that are not flat bases.** The **square box** (IBD's; Bonde's 2011 summary: "It can be as short as four
weeks." and "This was introduced by IBD in recent years."), the
**three weeks tight** (IBD), the **high tight flag** (its own journal setup), the **VCP** (Mark Minervini's contracting
pullbacks; his books were not read in this pass), the **ascending base**, and the **base-on-base**.

---

## 3. Every definition, source by source

### 3.1 IBD (William O'Neil's newspaper): the originator

IBD columns are syndicated on Yahoo Finance under the byline "Investor's Business Daily". Read through a page reader
(see the note at the top); S2 and S6 were also checked word for word against Internet Archive copies. Investors.com
itself serves only the lead paragraph to a non-subscriber.

| Criterion | IBD's words | Source |
|---|---|---|
| Length | "It needs at least five weeks to form." | [S1, 2013](https://finance.yahoo.com/news/flat-simple-pattern-does-fine-205400421.html) |
| Why that length | "Shorter patterns are not adequate enough to flush out weak or impatient shareholders." | S1 |
| How to count | "Usually, start counting with the first down week on a weekly chart." | S1 |
| Length, again | "they must take shape over a minimum of five weeks, usually beginning with the first down week." | [S3, 2014](https://finance.yahoo.com/news/early-buy-point-flat-investors-220500783.html) |
| Too short | "One, two or three weeks do not get the job done." | [S4, 2015](https://finance.yahoo.com/news/looking-great-chart-sure-count-203400677.html) |
| Depth | "The stock's price declines no more than 15% from its intraday peak to intraday trough." | S1 |
| Depth, again | "The correction within a flat base should be no more than 15% from its intraday high to the bottom of the pattern." | S3 |
| Depth, tighter band | "Still, look for consolidation areas that are at least five weeks long and fall no more than 10% to 15%." | S4 |
| Depth, a third wording | "By definition, a flat base consists of a stock price decline of less than 15%," | [S2, 2012](https://finance.yahoo.com/news/learn-spot-bullish-flat-stock-215000316.html) |
| Shape | "It should look like a rectangular box with a correction from high to low of no more than 15%." | [S6, 2015](https://finance.yahoo.com/news/flat-springboard-big-stock-market-213500613.html) |
| Shape, variant | "the "flat" base has kind of a "U" shape and doesn't look so flat." | S1 |
| Tightness | "Flat bases should show tight trading." (No number is given.) | [S5, 2013](https://finance.yahoo.com/news/correctly-shaped-bases-create-winning-215900488.html) |
| Tightness, again | "Flat bases are tight, shallow patterns that can form more quickly." | S4 |
| Prior trend | "These shallow patterns often start forming as a stock takes a breather after an earlier advance." | S3 |
| Prior trend, a number (all bases, not flat bases only) | "In a weekly chart, look for periods of sideways movement or mild declines following a prior uptrend of at least 30% in price." | S4 |
| Base stage | "Flat bases tend to form as a second or third base in a stock's major advance" | S1 |
| Base stage, again | "The flat base is usually not a first-stage structure." | S6 |
| Buy point | "The typical buy point is the price high made before the decline, plus 10 cents." | S2 |
| Buy point, again | "To get the proper buy point, add 10 cents to the highest price in the pattern, which is usually the start of the base." | S3 |
| Buy point, again | "The buy point in a flat base is 10 cents above the left-side high." | S6 |
| Early buy point | "But a stock may sometimes form a resistance area slightly below the prior high, setting up a potential early buy point." | S3 |
| How to find it | "Sometimes you can draw a trend line connecting at least three points along the top of the base and find the lowest potential entry." | S3 |
| Breakout volume | "you want to see volume bulge at least 40%-50% above average when a stock breaks out of the flat base." | S6 |
| Breakout volume, again | The 2013 column asks for volume "at least 40% above its 50-day average". The reader dropped a linked word just before this, so only this part is quoted. | S1 |
| Moving average | "The 10-week moving average served as a support level." (one example, Herbalife, not a rule) | S2 |
| Base count | "A breakout needs to produce a gain of at least 20% in order to be counted as one stage." | [S7, 2015](https://finance.yahoo.com/news/why-stage-patterns-often-lead-215800864.html) |
| Late-stage | "Breakouts from late-stage bases will often blow up." | S7 |
| Best stage | "It's usually best to buy when a stock breaks out from a first-stage or second-stage base." | S7 |
| Stop | "One guideline is the 7%-8% sell rule." (a maximum loss from the purchase price; a general IBD rule, S8 does not mention flat bases) | [S8, 2013](https://sg.finance.yahoo.com/news/sit-tight-tips-dealing-pullback-222700526.html) |

**IBD's worked examples** (single cases, not data): Tractor Supply, a base of about eight weeks and 14%, "The buy point
was 78.32 [chart marker (1)] but an alternative buy point could be traced at 75.58." It broke out on Jan. 12, 2012 "in
volume nearly five times its average." (S1). Herbalife: "It proceeded to consolidate in a tight fashion for about six
weeks." It broke out in the week ended Feb. 25, 2011 (S2). Monster Beverage, a flat base in September to October 2010:
"The five-week pattern corrected by just 7% and formed after the stock broke out from a cup with handle in July." It
cleared its buy point in the week ended Oct. 15 (S6; the column states the year as 2010). Baidu, a flat base that began
with an intraday high on July 27, 2009: "Baidu cleared both early buy points on Sept. 8 as it surged 4% in
above-average trade." (S3; the example is from 2009, the column from 2014).

Not found in the IBD columns I read: a stop placement inside the pattern, a profit target, a volume rule for inside
the base, or a rule on moving averages. The 5% buy zone is not in these columns; O'Neil's data firm states it in its
manual (3.2: "The Pivot Range is 0% to 5% above the pivot point").

### 3.2 MarketSmith (O'Neil's data firm): the rule a computer applies

From the MarketSmith Pattern Recognition Users Manual (a copy on silo.tips, undated; the manual carries
marketsmith.com's address) and the MarketSmith Hong Kong page:
- "Flat bases form over a 5 to 65 week range. The minimum depth is 0% with a maximum of 15%." (both)
- Prior trend, not required: "Flat bases often occur after a stock runs up after breaking out of one of the other chart
  patterns." (both)
- Pivot: "In the case of a Cup, Flat Base, Consolidation or IPO Base, the Pivot corresponds to the Left Side High that
  began the base." The manual marks it "without any additional amount added (e.g. 10 cents)".
- Left-side high: "In most cases, it is the highest intra-day price over the last 100 days (or 20 weeks)".
- Depth: "The percent decline from the start of the base (left side high) to the bottom (intraday low) of the base."
- Length: "measured from the first day the pattern begins (left side high) to, but not including, the breakout day."
- Stage: "Stocks emerging from third, fourth or later stage bases are late in their moves and may be more likely to
  fail." A 20% move from one base's pivot to the next base's left-side high adds a stage; less adds a letter (1a, 1b).
- Stage reset: "The Base Stage and Count are always reset to 1 once an intraday low price undercuts the low of the
  previous base."
- Buy, sell and profit zones (manual only, not on the Hong Kong page): "The Pivot Range is 0% to 5% above the pivot
  point"; "The Loss Range is 5% to 8% below the pivot point"; "The Profit Target Range is 20% to 25% above the pivot
  point". These are the manual's general ranges for any base, not flat-base rules.

### 3.3 TraderLion (Nick Schmidt): the four numbers of the first pass

[TraderLion, "Master the Flat Base Pattern for Maximum Profits", Nick Schmidt, 2023-03-12](https://traderlion.com/technical-analysis/the-flat-base-pattern/).
This is where the first pass's four numbers (30%, 5 weeks, 15%, 40% more volume) came from. UCT interviewed Nick Schmidt on its
Substack ([2025-06-12](https://unchartedterritoryy.substack.com/p/interview-with-nick-schmidt)).
- Prior trend: "A prior uptrend of 30% or more: This is the initial strong move that leads into the consolidation phase."
- But later the same page: "it should already have shown a strong uptrend of at least 20-30%."
- Depth: "the stock's price should not fall more than 15% from its highest point within the base."
- Length: "The flat base should last for a minimum of 5 weeks".
- Breakout volume: "the trading volume should be at least 40% higher than its average volume (1.4 times the relative volume)."
- Tightness: "A well-formed flat base should have tight and orderly price action".
- Market: "Flat base breakouts are more likely to succeed in a strong, bullish market."
- Quotes attributed to O'Neil with no book named: "When a stock breaks out of its flat base, the volume should surge at
  least 40% to 50% above average." and "In almost all cases, one-, two-, and three-week bases are risky. They should be
  avoided." The page also prints "Wide and loose bases are a big sign of real danger." in quotation marks with no
  speaker named.
- No stop, no target, no moving-average rule.

### 3.4 Pradeep Bonde (Stockbee)

UCT's Sunday Scans run Bonde's "StockBee (Pradeep Bonde) Market Monitor" for breadth, so he is a known name to members.
- He passes on O'Neil's rule: "The 'flat base' moves straight sideways in a fairly tight price range for at least five
  weeks and does not correct more than 10% to 15%." ([2011-12-13](https://stockbee.blogspot.com/2011/12/william-oneil-setups.html))
- His own view: "This is nothing but Darvas box setup." (same post)
- What the pattern means: "All these pattern essentially indicate stalled price action on the charts."
  ([2007-02-25](https://stockbee.blogspot.com/2007/02/finding-flat-bases-and-cups-with-handle.html))
- His scan for them (measurable): take the stocks up 100% or more from their low in 260 days, "sort those stocks with
  65 day price growth and take bottom 10%." (same post). That finds leaders that have stalled.
- Entry: "you can anticipate a breakout and enter with a pre defined buy stop." (same post)
- A warning on hindsight: "When a stock makes a big move the perception distorts the earlier chart." and "It looks like
  a breakout from flat base." ([2009-08-13](https://stockbee.blogspot.com/2009/08/how-to-find-non-existent-patterns-in_13.html))
- A warning on biotechs: "It looks very attractive like a flat base and often has upside breakout which fails."
  ([2009-06-08](https://stockbee.blogspot.com/2009/06/how-to-trade-biotech-profitably.html))

### 3.5 Kristjan Kullamägi (Qullamaggie): the breakout setup

[qullamaggie.com, "3 TIMELESS setups that have made me TENS OF MILLIONS!", 2021-01-08 (updated 2021-04-28)](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/).
His breakout is broader than a flat base, but he says it covers "flat channels". Closest to how UCT trades.
- Find them: "Scan for the 1 or 2% of stocks that are up the most over these 3 timeframes" (1, 3 and 6 months).
- Prior move: "A big move higher sometime in the past 1-3 months. This move can be anywhere from 30-100%+ and usually
  lasts a few days to a few weeks."
- Shape: "An orderly pullback and consolidation with higher lows and tightening range in the consolidation phase."
- Length: "The consolidation phase is usually 2 weeks to 2 months."
- Moving averages: "During the consolidation the stock price "surfs" the rising 10- and 20-day. and sometimes toe
  50-day moving average." (his wording)
- Entry: "Enter on the opening range highs." (the first 1-minute, 5-minute or 60-minute bar)
- On anticipating: "This method can also be traded by anticipating the breakout but I don't find it as effective".
- Stop: "Stop is always lows of the day and stop should not be wider than the ATR or ADR of the stock".
- Exits: "You should sell 1/3 to 1/2 of the position after 3-5 days, and then move the stop to break even. The rest of
  the position should be trailed with the 10- or the 20-day moving average."
- Trail detail: "If a beginner stick to the 10-day. You wait for the first CLOSE below the 10- day."
- Volume: his breakout section does not mention volume.

### 3.6 Oliver Kell: Base 'n Break

- His site, step 4, Base ‘n Break: "Constructive consolidation followed by continuation. How to identify trend
  continuation vs. failure." ([kelltrading.com](https://kelltrading.com/))
- His TraderLion article ([2024-09-10](https://traderlion.com/technical-analysis/chart-patterns/cycle-of-price-action-by-oliver-kell/)):
  "The stock will now begin to move sideways allowing moving averages to catch up. You will begin to notice these
  tight basing patterns are defined within just a couple of weeks."
- Where it happens: "The Base n' Break occurs multiple times and can develop within the structure of a base before a
  "traditional" buy area, align with a breakout on a higher time frame, or after a tight flag formation".
- Trailing: "We continue to look for positive price action and higher lows, allowing us to raise our stops in a
  trailing format."
- The short mirror: "Like the Base n' Break to the upside, the Base n' Break to the downside will trade sideways into
  the declining moving averages."

### 3.7 The Wyckoff school

[Wyckoff Analytics, "Wyckoff Method" (page heading "Real Rules of the Game")](https://www.wyckoffanalytics.com/wyckoff-method/) (no
author or date on the page).
- "In a re-accumulation TR (which occurs during a longer-term uptrend)" the phases "generally have a shorter duration
  and smaller amplitude than those in the primary accumulation base."
- The breakout, their "sign of strength" (SOS): "a price advance on increasing spread and relatively higher volume."
- The retest: "Backing up to an LPS means a pullback to support that was formerly resistance, on diminished spread and
  volume." This is the classic second entry after a breakout.

### 3.8 The Weinstein school (Stage 2 continuation)

Stan Weinstein's book was not read. Two second-hand sources:
- TraderLion quotes him repeating an old saying: "the bigger the base, the bigger the move" (TraderLion 2023, link
  above; no book named).
- A community checklist ([stageanalysis.net, 2019-10-01](https://www.stageanalysis.net/blog/4372/stage-analysis-breakout-quality-checklist)),
  in its own words, not Weinstein's: for a continuation, "is price above a strongly rising 30 week moving average";
  weekly volume "at least two times the four week average"; daily volume "at least three times the daily average volume
  on the breakout day".

### 3.9 Thomas Bulkowski (thepatternsite.com)

**AI notice on this site.** The site's footer says: "This website, in whole or in part, shall not be used to train
artificial intelligence (AI) systems, technologies," (the notice continues). Six of the seven pages read here carry it;
the archived Volume Study page (April 2026) did not show it. I read and cite these pages with links and short quotes
only, as the task allows, and flag the notice.
- His "Flat Base" ([FlatBase.html](https://thepatternsite.com/FlatBase.html)) is a different pattern (section 2):
  "Look for price moving horizontally." Entry: "When price closes above this line, then buy." Exit: "If price closes
  below the bottom of the flat base, then close out a long position." Target: "Use 85% of the height of the flat base,
  projected upward from the top of the pattern." Length: "Select a flat base longer than 65 days (or price bars) for
  the best performance".
- His "Rectangle Tops" ([recttops.html](https://thepatternsite.com/recttops.html)) is the uptrend rectangle, the closest
  match to O'Neil's flat base: price trend "Upward leading to the chart pattern."; "Price should touch one trendline at
  least three times and twice on the other trendline, using distinct peaks and valleys"; volume "Trends downward 70% of
  the time."; height "Tall patterns perform better than short ones."; and "Throwbacks hurt post breakout performance."
  Statistics in section 4.

### 3.10 Mark Minervini: not verified

Minervini's VCP is the pattern our Model Book card actually describes (section 5). His books were not read and his own
site gave no page on this, so nothing from him is quoted. Secondary sites disagree with each other on what he says
about flat bases. Leave him out of the flat base lesson until his own words are read.

### 3.11 The criteria side by side

| | Prior trend | Length | Depth | Shape / tightness | Volume in base | Breakout volume | Moving averages | Trigger / entry | Stop | Exits |
|---|---|---|---|---|---|---|---|---|---|---|
| **IBD** (S1-S8) | "after an earlier advance"; 30%+ prior uptrend for any base (S4); usually 2nd or 3rd base | 5 weeks min, counted from the first down week | 15% max (also "10% to 15%") | sideways box, "tight trading", U-shape allowed | not stated | 40% to 50% above the 50-day average | 10-week line as support (one example) | pivot = base high + $0.10; early pivot = a lower ceiling touched 3 times | 7% to 8% max loss (general rule) | not in what I read |
| **O'Neil's book** (as quoted by Bonde, TraderLion) | 20%+ off a prior base | 5 weeks; "five or six weeks" | 10% to 15% | "fairly tight price range" | not stated | 40% to 50% (TraderLion's quote) | not stated | not stated | not stated | not stated |
| **MarketSmith** | often after a run-up, not required | 5 to 65 weeks, left-side high to the day before the breakout | 0% to 15% | "relatively narrow price range" | not stated | not stated | not stated | pivot = left-side high, no 10 cents; buy range 0% to 5% over it (any base) | loss range 5% to 8% under the pivot (any base) | profit range 20% to 25% over the pivot (any base) |
| **TraderLion** | 30%+ (later "20-30%") | 5 weeks min; 5 to 7 or more better | 15% max; tighter is better | "tight and orderly" | not stated | 1.4x average | not stated | not stated | not stated | not stated |
| **Bonde** | stock up 100%+ in 260 days, then stalled | 5 weeks (O'Neil's) | 10% to 15% (O'Neil's) | "stalled price action"; a Darvas box | not stated | not stated | not stated | buy stop, anticipated | not stated | not stated |
| **Kullamägi** | 30% to 100%+ in the past 1 to 3 months | 2 weeks to 2 months | not stated | higher lows, tightening range | not stated | not stated | surfs rising 10/20-day, sometimes the 50-day | opening range high | LOD, no wider than the ADR | 1/3 to 1/2 after 3-5 days, stop to breakeven, trail 10/20-day |
| **Kell** | inside a trend | "within just a couple of weeks" | not stated | tight basing, MAs catch up | not stated | not stated | rising MAs support | not stated | trail under higher lows | not stated |
| **Wyckoff school** | uptrend (re-accumulation) | not stated | "smaller amplitude" | trading range | not stated | "relatively higher volume" (SOS) | not stated | the SOS; or the back-up on lighter volume | not stated | not stated |
| **Weinstein school** | Stage 2, above a strongly rising 30-week line | not stated | not stated | consolidation | not stated | 2x the 4-week average (weekly); 3x (daily) | above the rising 30-week | new high | not stated | not stated |
| **Bulkowski rectangle top** | uptrend into it | not stated | "Tall patterns perform better than short ones." | 3 touches one side, 2 the other | falls 70% of the time | not stated | not stated | a close above the top | not stated | measured statistics only |
| **Bulkowski flat base** (different pattern) | his example follows a steep drop | any; longer than 65 days best | not stated | horizontal | not stated | not stated | not stated | close above the top | close below the bottom | 85% of height |

### 3.12 Where they disagree

1. **Minimum length.** IBD and MarketSmith: 5 weeks. Kullamägi: 2 weeks. Kell: "a couple of weeks". The owner's own
   examples run from 8 days (USAR) to 7 weeks (NOW) (section 6). Under 5 weeks, IBD would call it a different pattern
   (square box at 4 weeks, three weeks tight at 3, a flag below that).
2. **Maximum depth.** IBD says 15% in three columns and "10% to 15%" in a fourth. Our own scanners use 12%, 15%, 22%
   and 35% (section 5).
3. **Prior advance.** O'Neil (via Bonde) 20%+; IBD 30%+ for any base (S4); TraderLion 30%+ then "20-30%"; Kullamägi
   30% to 100%+; MarketSmith none required; Bonde's scan wants 100%+ in a year.
4. **Breakout volume.** IBD and TraderLion require 40% to 50% above average. Kullamägi does not mention volume. The
   owner: "Not a big volume guy" (section 6). Bulkowski's measured data cut both ways (section 4).
5. **The buy point.** IBD: the high plus 10 cents. MarketSmith: the high, no 10 cents, and a buy range up to 5% over it
   (the house allows 4%, C28). Kullamägi: the opening range high on the breakout day. IBD also allows an earlier, lower pivot inside the base. The owner has called an
   undercut-and-reclaim inside the base the "ideal spot" (PLTR, section 6). Bulkowski: wait for a close above.
6. **The stop.** IBD: a maximum 7% to 8% loss. Kullamägi and the house: the low of the day. Our `flat_base.py`: 1.5%
   under the base low, which can be up to about 12.7% under its entry (a 12% midpoint depth plus the 1.5%).
7. **Anticipate or wait.** Bonde anticipates with a buy stop. Kullamägi: anticipating is less effective.
8. **The name "flat base".** O'Neil's is a rest near the highs in an uptrend. Bulkowski's is a bottoming area of any
   length. Our Model Book card describes a third thing, a VCP.
9. **Shallow or tall.** IBD caps the depth (15%, or "10% to 15%") and TraderLion calls the shallow depth the
   pattern's strength ("This shallow depth signals strength and stability"). Bulkowski's measured rectangles point the
   other way on height: "Tall patterns perform better than short ones." Different patterns and samples, but no source
   read here measured that a shallower flat base works better, so the course should not claim it.

---

## 4. Measured evidence

No source I read measured O'Neil's flat base itself (5+ weeks, 15% max, after an advance) as a trade. The closest
published numbers are Bulkowski's rectangles. Every number below is from the page named.

| What | Number | Who and how | Limits |
|---|---|---|---|
| Rectangle tops, upward breakout, bull market: break-even failure rate | 15% (34% for downward breakouts) | Bulkowski, [Rectangle Tops](https://thepatternsite.com/recttops.html); "based on more than 1,000 perfect trades" | "Failure" = did not rise at least 5% ([glossary](https://thepatternsite.com/glossary.html)). Not limited to 15% depth or 5 weeks. His own pattern picks. |
| Same: average rise | 51% (decline 13% for downward breakouts) | same page | Measured "from the opening price the day after the breakout to the ultimate high" (glossary), and the ultimate high is "The highest peak before price declines by at least 20%". Nobody sells at the exact top, so this overstates a real trade. |
| Same: throwback rate | 66% | same page | A throwback = price returns to the breakout price within 30 days (glossary). So two times in three, a retest happens. A stop under the breakout day's low will often be tested. |
| Same: meets the measure-rule target | 78% | same page | Target is his height rule, not our 3R / 5R. |
| Same: rank | 4 out of 39 (upward) | same page | Rank among his own patterns. |
| Same: breakout direction | "Upward 63% of the time." | same page | |
| Same: height | "Tall patterns perform better than short ones." | same page | No number on the page. Cuts against teaching "shallower is better" (3.12, point 9). |
| Ascending triangles (flat top, rising lows), upward breakout, bull market | failure 17%, average rise 43%, throwback 64%, target met 70%, rank 16 of 39, "more than 1,400 perfect trades" | Bulkowski, [Ascending Triangles](https://thepatternsite.com/at.html) | Relevant to the flat-top scanner. Same limits. |
| Rectangle bottoms by length, upward breakouts, bull market | shorter than the 65-day median: average rise 41%; longer: 51% | Bulkowski, [Flat Base page](https://thepatternsite.com/FlatBase.html) | Rectangle bottoms, not tops. Loosely supports longer bases giving bigger moves. |
| Breakout-day volume | Upward breakouts on above-average volume gained 37.6%; below average 35.8%. Failures to move 10%: "14% versus 5% for upward breakouts on above/below average volume, respectively." Throwbacks 57% vs 18%. | Bulkowski, [Volume Study](https://thepatternsite.com/VolumeStudy.html): "I looked over 8,000 chart patterns (samples) from July 1991 to May 2011", only rectangles and double and triple tops and bottoms; volume compared to the prior 31 calendar days | Runs against IBD's 40% rule: heavy volume did not help much and failed more often in this sample. One study, his definitions. |
| Breakout-day volume, across his many studies | Heavy volume helped in 79% of the studies he polled (upward breakouts) | Bulkowski, [study of studies, GS11](https://thepatternsite.com/studystudy.html) | A count of studies, not of trades. Conflicts with the Volume Study above. His own word on volume overall: mixed. |
| Volume trend inside the pattern | Rising volume did better in 62% of polled studies for upward breakouts; "The results are close and mixed." | Bulkowski, same page, GS9 | Runs against the idea that volume should dry up in the base. Weak either way. |
| Breakout volume, his summary line | "After a high volume breakout, performance doesn't improve much but failures triple." | Bulkowski, [volume resource page](https://thepatternsite.com/volpatterns.html) | Same study as above. |
| Base length and reliability | "IBD's historical research shows that typical base patterns require a minimum number of weeks to form." | IBD (S4) | No numbers published in what I read. |
| Late-stage bases | "Stocks emerging from third, fourth or later stage bases are late in their moves and may be more likely to fail." | MarketSmith manual | No numbers given. |
| R multiples in good markets | "In a bullish market it is very common to get moves that are 10-20x+ your initial risk if you are good at setup selection." | Kullamägi, 2021 | His experience, not a study. |
| Academic | Rectangle tops and bottoms are among the ten patterns tested; the abstract says several technical indicators "do provide incremental information" | Lo, Mamaysky and Wang, *Journal of Finance* 55 (2000), 1705-1765 ([abstract page](https://web.mit.edu/~alo/www/Papers/techanal.html)); the pattern list is in the NBER working paper version ([w7613](https://www.nber.org/system/files/working_papers/w7613/w7613.pdf)) | Tests return distributions after patterns, 1962-1996, not trade profits. Their rectangle tables were not read, so no number is given. |
| **In-house:** our flat-top scanner's recognition | Test recall 21.2% at a random-day fire rate of 2.84% (lift 7.50); two blind packets of 25 fires judged 15 yes / 2 no and 13 yes / 4 no, "pooled precision of decided 82.4% (Wilson 95% CI 66-92)" | `uct_flat_top_breakout.py` docstring (offline lab, traders' scored calls) | Measures whether it finds what our traders called a flat-top breakout. Not whether the trade made money. Small samples. |
| **In-house:** the wider ftb4 rule | Test recall 27.0% vs 23.0% (paired gain +3.9 points, 95% CI +1.8 to +6.5); new-branch fires pooled 28 / 32 (87.5%) | `uct_flat_top_breakout_ftb4.py` docstring | Same limits. |
| **In-house:** how common the shape is | IBD's rules alone matched 41.1% of 3,705 symbols; with our tightness gate 26.4%; with a 20% prior advance 4.8%; with horizontality 3.8% to 4.5% | `api/services/screener/base_catalog.py` comments | Shows IBD's numbers alone are too loose to be a useful label. |
| **In-house:** do our two engines agree? | "13% agreement" over 744 tickers (2026-08-31) | `flat_base.py` header | The screener and Compass name different stocks as flat bases today. |
| **In-house:** are the drawings right? | `flat_base` box judged 0.30 of 3 ("its box wrapped the whole prior advance"), then 1.60 after a fix; the screener's flat-base box 1.20 (hidden). Later, as the team drawing (the pivot line plus its capped box), `flat_base` passed two independent blind packets and is in the member drawing set; the screener's flat base passed drawn as its pivot line only (2.40 and 2.30); the flat-top drawing (ceiling plus touch marks) passed at 2.60 and 2.57 | `api/services/pattern_engine/detectors/registry.py` comments (blind judges, n=10 charts per v3 re-judge) | Drawing placement, not trade results. |

**What this means for the course.** There is no published win rate for O'Neil's flat base. The best outside numbers
(Bulkowski's rectangles) say: upward breakouts from uptrend rectangles fail to make 5% about 15% of the time, and
two in three come back to the breakout price within 30 days. On volume, the evidence is mixed. Any win rate we teach
must come from our own replay (question 13).

---

## 5. Our app: what the scanners actually test

Four engines in this repo decide whether a chart shows a flat base. They disagree with each other and with IBD.

### 5.1 `api/services/pattern_engine/detectors/uct/flat_base.py` (public; Compass reads it)

What the code does, faithfully:
- **Gate:** price at least $2 and a 20-bar average dollar volume of at least $10,000 (`primitives/liquidity.py`).
- **Base window:** every length from 15 to 35 bars, ending on the last bar or up to 4 bars earlier.
- **Depth:** (base high minus base low) divided by the base's **midpoint**, at most 12%. IBD and MarketSmith divide by
  the high. The midpoint is smaller than the high, so this reads a little deeper than IBD would: a 12% midpoint depth
  is about 11.3% measured IBD's way.
- **Flatness:** the least-squares slope of the closes, at most 0.5% of the midpoint per bar.
- **Prior advance:** in the 60 bars before the base, the lowest low to the highest high after it is at least 25%, over
  at least 3 bars.
- **Not already broken:** fewer than 3 closes more than 1% over the base high since the base ended. So it fires
  **before or at** the breakout, as an alert, not on a confirmed breakout.
- **Trend gate:** rejects only when Stage 4, a bearish moving-average stack and falling RS all happen together. A flat
  base under a falling 200-day can pass.
- **Volume gate:** the second half of the base must average at most 75% of the first half's volume.
- **Score:** 40% geometry (depth, 20 to 25 bars is the "sweet spot", flatness), 25% volume contraction, 20% context
  (Stage 2, MA stack, RS trend, accumulation, a CAN SLIM grade bonus), 15% a fixed 50. Fires at 50 or more.
- **Levels:** entry = base high x 1.001; the condition text says close above the entry "on volume > 1.5x 20-bar avg" (the
  code does not check this); **stop = base low x 0.985**; target = half the prior advance's height added to the pivot,
  capped at +20%.

### 5.2 `uct_flat_top_breakout.py` (admin-only as a scan result, "experimental")

The detector is in the registry's internal (admin-only) list. Its drawing is a separate matter: since 2026-10-18 the
"flat top" drawing (the ceiling plus its touch marks) is in the member drawing set, served to paid members behind the
`AUTO_STRUCTURES_MEMBERS_ENABLED` switch only when the row carries the confirmed drawing stamp (`registry.py`).
A port of the offline lab's rule for the traders' "flat top breakout" calls:
- At least 200 bars; the same $2 / $10,000 gate.
- Close above the 50-day SMA, and the 50-day above the 200-day.
- Ceiling = the highest high of the 40 sessions before today. Touches = highs within 0.5 ATR of it, in at least 2
  groups at least 3 sessions apart, the first touch at least 10 sessions back.
- Depth of the 40-session window at most **35%**.
- Fires when the close is within 1 ATR under the ceiling ("at_line") or up to 2 ATR over it ("breakout"). Newest of the
  last 3 sessions, and only if no later bar traded under its stop.
- No prior-advance rule. Volume is scored (relative volume to the 50-day), never required.
- Entry = the ceiling ("at_line") or the close ("breakout"); stop = that session's low; targets 2R and 3R.

### 5.3 `uct_flat_top_breakout_ftb4.py` (admin-only)

Everything in 5.2, plus a second chance at 25 or 60-session ceilings when: the first touch is at least 15 sessions back,
no higher high in the 120 sessions before (within 0.5 ATR of the ceiling), and the 200-day is rising (higher than 20
sessions ago).

### 5.4 `api/services/screener/base_catalog.py`, structure `flat-base` (the screener)

The most careful one, with IBD's quotes in the code: at least 25 bars (5 weeks), depth at most 15% measured from the
high, pivot = high + $0.10, the base must open within 3% of its high in its first week (IBD's "first down week"),
plus our own gates: mean daily range at most 2.5% of the close, a 20% prior advance in the 60 bars before, total
drift at most 10% (two thirds of 15%), up to 260 bars back. Fires on 4.5% of the universe.

### 5.5 Chart IQ v3 (`api/services/chart_iq/engine/v3_bases.py`), which writes Study's base questions

Study's bank segment `chart.bases` (100 "Flat base" items, drafts for the owner's approval) teaches: "a sideways base
no more than 22% deep (15% for a short one, under 20 sessions)." (`scripts/study/bank_v2/gen_bases.py`). In the code a
base of 20 bars or fewer and at most 15% deep (when it is not first named a bull flag), or a longer one at most **22%**
deep that is not a cup, is called a flat base. No 5-week minimum for the short one. Chart IQ v3 has no price or
liquidity floor of its own; the bank drafts keep only breakouts from "the top 1,000 stocks by dollar volume that day,
held over 20 sessions" (`gen_bases.py` header), so the 100 examples are breakouts that held.

### 5.6 The Model Book card (`app/src/pages/modelbook/setupCatalog.js`)

The card's text: "A coiling price structure where each pullback is smaller than the last, reflecting drying-up selling
pressure and compressed volatility before the move through resistance." Its drawing is a zigzag of shrinking swings
(9, -6, 7.5, -4, 5, -2.5 ...). The code comment says so: "base breakout with a VCP-style contraction glyph." That is a
VCP, not a flat base. The Model Book has no separate VCP card, so the VCP was folded into this one.

### 5.7 Journal tags and the course plan

- `app/src/constants/setupGroups.js` lists **"VCP"** and **"Flat Base Breakout"** as two separate tags, and the grades
  A+, A, B, C, F (the rulebook uses A+, A, B, B-).
- `app/src/pages/journal-2-0/lib/setupTagMap.js` maps `flat_base` to "Flat Base Breakout". The two flat-top scanners
  map to no tag.
- `docs/study/UNITS-method.md` SET.07 plans the flagship lesson as "The coil: each pullback smaller than the last ...
  the stop under the final contraction low." Same VCP mix-up.
- `docs/study/TRADE_PLANS.md`, `api/services/study_trade.py` and Hard mode (`study_hard.SETUP_RULES`) have **no Flat
  Base entry yet**.

### 5.8 Our engines side by side

| | Length | Depth | Prior advance | Trend / MAs | Volume | Entry | Stop | Target |
|---|---|---|---|---|---|---|---|---|
| IBD (for reference) | 5+ weeks | 15% | after an advance | none stated | breakout 40%+ over the 50-day avg | high + $0.10 | 7-8% max | none |
| `flat_base.py` | 15-35 bars | 12% (of the midpoint) | 25% in 60 bars | rejects only full Stage 4 | base dries up (75%) | high x 1.001 | base low x 0.985 | half the advance, max +20% |
| `uct_flat_top_breakout` | 40-bar ceiling, 2+ touch groups | 35% | none | close > 50 > 200 | scored only | ceiling or close | that day's low | 2R, 3R |
| ftb4 | 25/40/60 bars | 35% | none | + rising 200-day (new branch) | scored only | same | same | 2R, 3R |
| `base_catalog` flat-base | 25-260 bars | 15% | 20% in 60 bars | none | none | high + $0.10 | none | none |
| Chart IQ v3 | any | 15% short / 22% long | none | none | none | its pivot | none | none |
| The house (rulebook) | | | | above the 200-day (B26) | | market order (E57) | under the day's low (A3, F62) | 1/3 at 3R, 1/3 at 5R (B19, E51) |

### 5.9 What looks wrong (for the owner and the next code change)

1. **The Model Book card describes a VCP** (5.6). Proposed new text: "After a strong advance the stock rests sideways
   for five weeks or more in a tight range no more than 15% deep, near its highs; the buy is the move through the top
   of the range." The drawing should be a flat box near the highs after a rise. Needs his OK (question 2).
2. **Claims in `flat_base.py`'s member-facing text with no source found:**
   - "refined for swing trading by Pradeep Bonde and Bauer at Stockbee". Bonde's own post calls it "nothing but Darvas
     box setup" and credits O'Neil's details. I found no "Bauer" in any source.
   - "CAN SLIM data shows flat bases with depths inside the 12% threshold produce materially higher follow-through".
     IBD's ceiling is 15%. I found no IBD data on a 12% line.
   - "O'Neil's research shows the first 20% of a flat-base breakout is statistically the highest-probability segment".
     No source found.
   - "15-35 bars is optimal". IBD's minimum is 5 weeks (25 sessions). 15 bars is 3 weeks.
3. **The stop is far too wide for the house.** Base low minus 1.5% can be up to about 12.7% under the entry. The house stop
   is the day's low, usually within about 3% (A3, A13). It also differs from the shared 2R / 3R targets every other
   UCT setup uses.
4. **No 200-day rule.** `flat_base.py` and Chart IQ v3 can call a base under a falling 200-day a flat base. B26 is a
   hard rule: no longs below the 200-day.
5. **Liquidity floor $2 and $10,000 a day** in `flat_base.py`, the two flat-top scanners and the screener (Chart IQ v3
   has no floor of its own) vs the house $10 and $20 million a day (B23).
6. **The breakout volume rule is in the text but not the code** (5.1), and the text says 1.5x the 20-bar average where
   IBD says 40% over the 50-day.
7. **Depths of 22% (Chart IQ v3) and 35% (flat-top)** are outside every flat base definition read. A 35% deep base
   with a flat top is a cup or a deep base, not a flat base.
8. **Four engines, four answers, 13% agreement** between two of them. Study needs one definition (question 14).

---

## 6. UCT's own words

All from UCT's public Substack (https://unchartedterritoryy.substack.com). I read all 103 posts in the sitemap through
Substack's post feed and searched every one for "flat base", "flat top", "flat pivot", "base breakout", "weeks tight",
"sideways", "tight base", "drying up" and similar. One post (Sunday Scans, 2026-10-18) is for subscribers only and was
not read past its preview. In the Sunday Scans, "TSDR's Weekly Outlook & Watchlist" and the "Charts Covered" list
under it are the owner's section (the Substack heads it "Patrick (TSDR)'s Weekly Outlook & Watchlist" in some weeks).
The "Index & ETF" section has no individual byline. Quotes keep the writers' spelling. Dates are the publish date in
US Eastern time; three "Rest of the Week" posts carry a UTC timestamp one day later than the date in their own
subtitle, and the subtitle date is used here.

### 6.1 The owner (TSDR)

On what a flat base looks like:
- FPS, [2026-03-01](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8): "IPO in the data center group saw a
  40% advance after opening trade consolidating sideways and closing tight 4 weeks in a row." Then: "now we need to see
  if it can break $35 and hold. If it does that is a buy with LOD stop imo."
- CHYM, [2026-01-18](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1): "Five weeks sideways following a 75%
  move off lows." And: "Near term daily we have a slight failed breakout and squat back into range."
- LHX, [2026-03-08](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf): "we have a large move to start the
  year and then about 6 weeks of sideways. Shakeout into the 50SMA then a retest of the top of the base here and 20EMA."
  And: "Friday's low is a level to trade against and great day to enter."
- NOW, [2025-07-06](https://unchartedterritoryy.substack.com/p/sunday-scans-df6): "Best in class software stock that
  held the 200day following a 7 week consolidation, squat, then breakout. Anything sideways, preferably an inside day,
  and this is a top watch."
- PLTR, [2025-10-26](https://unchartedterritoryy.substack.com/p/sunday-scans-13e): "Getting extremely tight below $190
  ish. Baby trigger on Friday for the breakout but ideal spot would’ve been the UnR at $170. Want to see this follow
  through after 6 weeks of sideways here."
- USAR, [2026-01-18](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1): "8 days sideways with lower wicks
  below $17 and tightness makes it compelling this week on a breakout."
- MXL, [2026-05-17](https://unchartedterritoryy.substack.com/p/sunday-scans-679): "I love these stocks that consolidate
  at or around $100 and give us a nice tight base for us to get involved in."
- SEI, [2025-10-26](https://unchartedterritoryy.substack.com/p/sunday-scans-13e): "Looking for this to firm up and build
  a bit more of a base vs just sharp pullback to 20EMA." And: "Weekly giving 304 weeks tight around $50 flat would be
  ideal." ("304" is as printed; it reads like "3-4".)

On the flat ceiling (the pivot):
- EAT, [2025-06-15](https://unchartedterritoryy.substack.com/p/sunday-scans-744): "Leading the restaurant stocks and has
  a clean flat pivot over $178"
- FUTU, [2025-07-06](https://unchartedterritoryy.substack.com/p/sunday-scans-df6): "Flagging out under the 3rd tap of
  this flat top resistance. Volume is drying up and any market wide catalyst for China stocks could see this lead the way."
- RDDT, [2026-01-04](https://unchartedterritoryy.substack.com/p/sunday-scans-153): "now 3 taps of the $240-$242 breakout
  spot. Should be able to work up the right side here now if the market is going to cooperate."
- NBIS, [2025-09-01](https://unchartedterritoryy.substack.com/p/sunday-scans-4d1): "$72-$73 building flat level to break
  through much like the $55 spot before earnings gap up."

On the trigger, the entry and the stop:
- SE, [2025-06-29](https://unchartedterritoryy.substack.com/p/sunday-scans-d70): "Tight base with a shakeout bar on
  Monday." "$160 flat is the level to hold above." "Will keep eyes on the hourly chart for tightening prior to a $160
  breakout. Can also look for retest on hourly following breakout." "Living under $155 would invalidate."
- BTU, [2026-01-04](https://unchartedterritoryy.substack.com/p/sunday-scans-153): "Taking out what was Tuesday’s high will
  trigger this trade. Ideally we see an inside day tomorrow or a red to green move."
- His stop habit, [2025-06-22](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2): "I always take 1-2% losses
  when trades do not show me positive results from the get go. That is usually how pure of entries I try to get with a
  stop at LOD (Low Of Day)."
- His trail then (2025-06-22, same post): "My stops are now trailing at two consecutive closes below the 20ema on these."
- His whole process, PL, [2026-03-22](https://unchartedterritoryy.substack.com/p/sunday-scans-cab): "By stocks with good
  setups and stories, get positioned with tight risk, see results from the start, trim off risk and lock in some win,
  then trail and hold your winners."

On volume:
- CRM, [2026-10-11](https://unchartedterritoryy.substack.com/p/sunday-scans-31b): "Not a big volume guy but I see volume
  drying up like the desert as this builds out here. One high volume up day and I think this is off to highs over $300."

On what to avoid:
- DAVE, [2025-10-26](https://unchartedterritoryy.substack.com/p/sunday-scans-13e): "Was really looking to find a way in
  here but just was too lose and wide of daily candles for me to properly risk"
- SNOW, [2025-11-16](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a): "Not ideal given the looseness of
  it, so either a big snap back to highs then tighten up or build a bit of a base."
- A failed base breakout as a market warning, [2025-10-05](https://unchartedterritoryy.substack.com/p/sunday-scans-6ef):
  "if we start to see NVDA as a failed base breakout and come back in under $184.5 and then below some MAs then that is
  telling that the two biggest names cannot push further at this point."

On patience and the watchlist:
- [2025-06-08](https://unchartedterritoryy.substack.com/p/sunday-scans): "I will be very focused on the strong stocks on
  my NMS (Need More Sideways) list." And: "Ideally would love to see some of these give opportunity for entry via tight
  patterns and consolidation." (From the post's "Closing Thoughts", which follows the owner's section and carries no
  name of its own; very likely his, not certain.)
- [2026-10-11](https://unchartedterritoryy.substack.com/p/sunday-scans-31b): "I demand buys on buy days, on setup days."
  And: "I do think Stock>Setup however it has to be a blend of both."
- [2026-09-06](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd): "Here is my approach. Give me an oops. Give
  me some sideways and a tap of the 20EMA. Give me an inside day. Give me a clean retest or remount after and undercut."

### 6.2 Bracco

- TSLA, [2025-09-07](https://unchartedterritoryy.substack.com/p/sunday-scans-52e): "Weekly chart extremely tight with
  volume drying up within the base." And: "More tightening below this $360 level and I will be paying very close attention."
- [2025-09-28](https://unchartedterritoryy.substack.com/p/sunday-scans-9a2): "With recent volatility and lack of clean,
  tight bases I am in a day trader mindset"
- [2025-10-26](https://unchartedterritoryy.substack.com/p/sunday-scans-13e): "it is probably smart to stay focused on the
  leaders that have been basing sideways as most momentum leaders pulled back sharply off the highs."
- MP, [2026-05-03](https://unchartedterritoryy.substack.com/p/sunday-scans-bcc): "Has gone sideways for 6-months now and
  approaching the top of this base." And: "this is the first base after all time highs, which can be a very powerful setup."
- WGMI, same post: "zooming out this looks like a huge stage 2 continuation base." And: "A couple more weeks tight around
  this $50 level and through the January high this is a top focus."
- USAR, [2025-10-05](https://unchartedterritoryy.substack.com/p/sunday-scans-6ef): "Got aggressive through the opening
  range highs and added through $19. Caught a massive day 1 breakout and trimmed 1/3 after hours" and "+40% move from
  the base breakout and traded back to back highest volume ever."
- PLTR, [2025-10-19](https://unchartedterritoryy.substack.com/p/sunday-scans-6cc): "Very tight range between 50ma and this
  188-190 area. Imagine this makes a quick $20-30 move whichever direction it breaks."

### 6.3 The Index & ETF section (no individual byline)

- XLI, [2026-01-11](https://unchartedterritoryy.substack.com/p/sunday-scans-0b3): "Flat base breakout higher low and
  breakout with some tightness here looking for continuation and that’s about it."
- IYT, [2025-11-30](https://unchartedterritoryy.substack.com/p/sunday-scans-422): "keeping an eye on the transports ETF
  looking to see if it can break to ATHs out of this flat base." And: "a lot of the sectors like XLI XLF XLC XLU etc
  looking like they could come out of flat bases from the past 3 months or so."
- ETH, [2025-09-28](https://unchartedterritoryy.substack.com/p/sunday-scans-9a2): "Willing to keep eye out for a UnR
  (Undercut and Reclaim) of the flat base we are consolidating below."
- QQQ hourly, [2025-07-06](https://unchartedterritoryy.substack.com/p/sunday-scans-df6): "I mark out important higher low
  pivots, open gaps, lower wick bases, and flat top resistance areas."

### 6.4 Team contributors ("The Rest of the Week")

- Jersace on U, [2025-12-02](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-bad): "Currently believe
  that $U is amid a solid flat top breakout on the daily chart"
- "Alex Jones Industrial Average" on MMM, same post: "Looking for a flat top breakout here. Great looking volume
  patterns as well."
- Same contributor on GM, [2026-01-06](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-3f0): "Looking for
  the flat top breakout on this. Tight inside day today and great VPA." And: "Currently long with a stop below LOD."
- "Lost Not Found" on AIP, [2025-10-14](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-39d): "AIP has set
  up with 7 tight days of consolidation at the top of a 2 1/2 year base."

### 6.5 The owner's verdict log (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`)

- TAN, Launchpad pass 3, cut: "Eh, it is more of a VCP or flat base breakout so I would say no to launchpad". He names
  VCP and flat base as two things.
- HON, Launchpad pass 3, kept: "Some of these will crossover with BaseBreakouts btw and that is fine".
- No ruling yet on the flat base itself.

### 6.6 What UCT's words add up to

- The UCT flat base is judged by **tightness**, a **flat level** ("$160 flat", "clean flat pivot") and **taps** of it
  (3 taps), more than by IBD's week count. The owner's examples run from 8 days to 7 weeks.
- In his own sections the owner never writes the words "flat base". Across the 102 public posts the phrase appears
  three times, all in the Index & ETF section (ETH, IYT, XLI); the team contributors write "flat top breakout". The
  owner writes "flat pivot", "flat top resistance", "flat level", "$160 flat", "tight base", "weeks tight" and
  "sideways". So the examples in 6.1 are flat bases by this file's reading of his descriptions, not by his label.
- **Prior advance:** his examples name 40% (FPS), 75% (CHYM) and a double (MXL).
- **Entry:** the break of the flat level or of a recent day's high, often refined on the hourly; he also likes an
  undercut and reclaim inside the base, or a retest after the breakout.
- **Stop:** the low of the day. Invalidation sits just under the level (SE: $155 under $160, about 3%).
- **Volume:** noted, not required ("Not a big volume guy").
- **Market:** Bracco steps back to day trading when there is a "lack of clean, tight bases".
- **ETFs:** sector ETFs are called flat bases too (XLI, IYT).

### 6.7 Examples UCT named at the time (candidates for his example review)

Named in the posts above; outcomes not checked; none graded by the owner yet: FPS (2026-03-01), CHYM (2026-01-18), LHX
(2026-03-08), NOW (2025-07-06), PLTR (2025-10-26), SE (2025-06-29), EAT (2025-06-15), FUTU (2025-07-06), RDDT
(2026-01-04), XLI (2026-01-11), IYT (2025-11-30), MP (2026-05-03), MMM (2025-12-02), GM (2026-01-06). IBD's own examples:
TSCO (breakout Jan. 12, 2012), HLF (breakout week ended Feb. 25, 2011), MNST (base Sept.-Oct. 2010, buy point cleared
the week ended Oct. 15, 2010), BIDU (base from July 27, 2009, early buy points cleared Sept. 8, 2009).

---

## 7. How it fits the owner's account rulebook (section 9)

| Rule | What it means for a flat base | Conflict? |
|---|---|---|
| A3, F62 stop a few cents under the day's low | The stop is the breakout day's low, not the base low | **Yes, with the sources' structure.** IBD allows up to 7-8%; `flat_base.py` uses the base low. The house wins: day's low. |
| A13 stop usually within about 3% | A breakout day with a wide range can put its low more than 3% under a late entry | **Sometimes.** Then A3 applies: skip if the honest stop does not fit. Kullamägi's cap (no wider than the ADR) is a second test. |
| A4 the stop only moves up | IBD's early pivot does not change this | No |
| A5 full size at one price, one stop | No pilot buy in the base and add on the breakout | No conflict with the setup; the owner's old "pilot position starter" (SEI, 2025) is struck by A5 |
| B19, E51, E52 trims and trail | 1/3 at 3R, 1/3 at 5R, trail the last third under the 10-day (fast) or 21-day (steadier) | Differs from Kullamägi (sell 1/3 to 1/2 after 3-5 days) and from the scanners (2R / 3R; half the advance). The house wins. |
| B20 a gap through the stop | First 30-minute low is the new stop; out past 2R | No |
| B21, E56 re-entry | A failed breakout can be bought again only when it triggers again; 3 tries a week, 6 a month | No |
| B22 no buys 3 days before earnings | A flat base right before a report is not bought until after it | **Yes, at times.** Some flat bases break out on an earnings gap (the owner's NBIS note, section 6). Buying the earnings-day breakout itself is after the report, so allowed. |
| B23 $10 and $20 million a day | Four scanners use $2 and $10,000; Chart IQ v3 has no floor | **Yes, in the code.** The house rule wins for Study. |
| B26 no longs below the 200-day (hard rule) | A flat base must sit above the 200-day | **Yes, in the code** (`flat_base.py`, Chart IQ v3 do not check). Bulkowski's bottoming "flat base" is excluded by this rule. |
| C28 no chase past 4% over the buy point | MarketSmith's manual: "The Pivot Range is 0% to 5% above the pivot point" | Small. The house 4% wins. |
| C29 skip a long more than 10% over its 10-day | A flat base breakout is usually close to the 10-day | Rarely; a wide-range gap breakout can break it |
| C31 RS 80+ in strong groups | IBD's flat bases are in leaders | No |
| C33 time stop: under 1R after 10 trading days, sell | Fits Kullamägi's sell-some-after-3-5-days and the owner's "see results from the start" | No |
| C34 sell into a climax run | Applies after a long run | No |
| D38, E49 grade sets the size | A+ flat base 1% to 1.5% risk; A and B 0.5% to 1%; B- 0.25% to 0.5% | No |
| D40 growing sales and earnings, chart first | Matches IBD's CAN SLIM | No |
| D47 shorts are the long setups reversed | Section 8.8 | No |
| E50 grading is discretionary, no fixed checklist | Section 9 gives cues, not a scored checklist | No |
| E57 market orders | Buy at market when price trades over the pivot, not a limit at the pivot | Differs only from IBD's pivot-plus-10-cents wording |
| E58 no buys outside regular hours | A pre-market move over the pivot is not bought until the open | No |
| F63 a gap over a trim level: trim at the open | Applies | No |
| F65 the market reading | Green full risk; Yellow smaller and fewer; Orange A+ only; Red mostly cash | No |

**Does the setup live below the 200-day?** No. O'Neil's flat base is a rest in an uptrend, so B26 fits it. **Is its
natural stop wider than 3%?** Yes, if the stop is the base low (up to 15% away, the base's depth). With the house stop (the day's low) it is
usually within a few percent.

---

## 8. Proposed rules for our course

Every line is measurable. "Session" = a trading day. Where sources disagree I give the options and recommend one.

### 8.1 What it is

- **Prior trend.** The left-side high is at least 30% above the lowest low of the 65 sessions before it
  [originator: IBD S4, "a prior uptrend of at least 30% in price", stated for all bases; source consensus: TraderLion
  30%, Kullamägi 30% to 100%+ in 1 to 3 months; the 65-session window is my proposal, from Kullamägi's "past 1-3
  months"]. Options: (a) 20% [O'Neil via Bonde; MarketSmith's stage step]; (b) 25% [`flat_base.py`]; (c) 30%.
  **Recommend 30%**: IBD and two other sources agree, and the owner's own examples (40%, 75%, a double) clear it easily.
- **Base count.** First or second base since the last stage reset; a breakout that gained less than 20% before this
  base does not count as a new stage; the count resets to 1 when price undercuts the prior base's low [originator: IBD
  S7 "first-stage or second-stage base"; MarketSmith manual for the 20% step and the reset].
- **Where the base starts.** At the left-side high: the highest intraday high of the last 100 sessions [originator:
  MarketSmith]. The base's first week reaches within 3% of that high [UCT code: `base_catalog.py`].
- **Length.** At least 25 sessions (5 weeks) from the left-side high to the day before the breakout; at most 65 weeks
  [originator: IBD and MarketSmith for the minimum; MarketSmith alone for the maximum and the counting rule]. Options: (a) 25 sessions; (b) 15 sessions (3 weeks) [owner's examples; Kullamägi 2
  weeks; Kell "a couple of weeks"]. **Recommend 25 sessions** for the name "Flat Base", and teach 2 to 4-week tight
  rests under the house's flag setups (Classic Flag/Pullback, High Tight Flag) so the names stay clean. He decides
  (question 3).
- **Depth.** At most 15%, from the left-side high to the lowest intraday low, divided by the high [originator: IBD,
  MarketSmith]. 10% or less as the A+ version is my proposal [from IBD's "10% to 15%" band and TraderLion's "This
  shallow depth signals strength"; no source measured it, and Bulkowski's "Tall patterns perform better" cuts the
  other way, 3.12 point 9].
- **Shape: flat.** The least-squares line through the base's closes moves no more than 10% of the base's average close
  from start to end, that is two thirds of the 15% depth ceiling [UCT code: `base_catalog.py` `FLAT_MAX_DRIFT`, derived
  from IBD's sideways shape]. A U-shaped flat base is allowed [originator: IBD S1].
- **Shape: tight at the end.** IBD gives no number [originator: "Flat bases should show tight trading."]. Proposed
  test: the last 10 sessions' high-to-low range is at most half the base's depth, or the last 3 sessions include an
  inside day [my proposal, from the owner's words "double inside days" and "Anything sideways, preferably an inside
  day", and a team contributor's "Tight inside day today"]. This adjusts to the stock's own volatility, which a fixed
  2.5% daily range (our screener's gate) does not.
- **The ceiling.** Two or more separate touches of the top, within 0.5 ATR, the first at least 10 sessions back
  [UCT code: the lab's frozen flat-top rule]. Three or more taps as the A+ version is my proposal [from UCT: FUTU "3rd
  tap", RDDT "3 taps"; Bulkowski's rectangle "should touch one trendline at least three times"; IBD's "at least three
  points along the top" is about drawing the early buy point, not grading the main ceiling].
- **Volume in the base.** The second half of the base averages less volume than the first half [UCT: Bracco, the
  owner; UCT code]. A grade cue, not a gate: Bulkowski's data on volume inside patterns is "close and mixed".
- **Location.** On the breakout day: price above the 50-day and the 200-day, and the 50-day above the 200-day
  [house rule B26; UCT code: the lab's "c>s50>s200"]. The 200-day is not lower than 20 sessions ago [UCT code: ftb4;
  Weinstein school's rising 30-week]. In the base, at least 80% of the closes are at or above the 50-day; a brief
  shakeout under the 50-day is allowed [the 80% is my proposal, to make "holds the 50-day" countable; Kullamägi
  "sometimes toe 50-day"; owner on LHX "Shakeout into the 50SMA"]. At entry, no more than 10% above the 10-day average
  [house rule C29].
- **Liquidity.** Price $10 or more and $20 million or more traded a day on average [house rule B23]; the position is
  at most 1% of average daily volume [house rule D42].
- **Leadership.** RS rating 80 or more, in a strong group [house rule C31]; growing sales and earnings preferred
  [house rule D40].

### 8.2 The buy

- **Pivot:** the highest intraday high of the base [originator: MarketSmith]. IBD adds 10 cents; with market orders the
  10 cents does not matter [house rule E57].
- **Trigger:** price trades above the pivot during regular hours [house rule E58; Kullamägi's opening range high is
  the same idea]. Buy with a market order [house rule E57]. Set the alert at the pivot.
- **Do not chase:** no buy more than 4% above the pivot [house rule C28].
- **Earnings:** no new buy in the 3 sessions before a report [house rule B22].
- **Volume on the trigger day.** Options: (a) required: on pace for at least 1.4 times the 50-day average volume
  [originator: IBD; TraderLion]; (b) a grade cue only [owner: "Not a big volume guy"; Kullamägi silent; Bulkowski's
  study found heavy-volume breakouts failed more]. **Recommend (b)**: required for an A or A+ grade, not to take the
  trade. He decides (question 6).
- **Other entries he uses** (teach as named variants only if he rules them in): the early pivot, a lower ceiling inside
  the base touched three times [originator: IBD S3]; the undercut and reclaim of the base low [UCT: PLTR "ideal spot
  would’ve been the UnR"; this is also the journal's "Classic U&R" setup]; the retest of the pivot after the breakout,
  on lighter volume [UCT: SE "retest on hourly"; Wyckoff back-up]. Question 7.

### 8.3 The stop

- A few cents under the breakout day's low [house rule A3, F62; Kullamägi "Stop is always lows of the day"; owner FPS
  "a buy with LOD stop"].
- If that stop is more than the stock's ADR (its average daily range, over 20 sessions as my proposal) below the
  entry, or more than 3% below it, skip the trade or wait for a tighter entry; never pull the stop closer to make it
  fit [house rule A3, A13 ("the stop usually sits within about 3% of the buy"); Kullamägi "stop should not be wider than the ATR or ADR of the
  stock"]. Question 8 asks him where the line is.
- Real stop order with the broker [house rule D41]. It only moves up [house rule A4].
- A gap through the stop: the first 30-minute low is the new stop; out if past 2R [house rule B20].
- Not the stop: the base low. It can be up to 15% away (the base's depth) and then breaks A13 [house rule; contrast
  `flat_base.py` and IBD's 7-8%].

### 8.4 Trims and trail (house defaults; nothing setup-specific is needed)

- Stop to breakeven between 2R and 5R [house rule B19].
- Sell a third at 3R, a third at 5R [house rule B19, E51]. If it opens above a trim level, take that trim at the open
  [house rule F63].
- Trail the last third: a close under the 10-day for a fast mover, under the 21-day for a steadier one [house rule E52].
- Time stop: under 1R after 10 trading days, sell [house rule C33].
- A climax run (Bracco's parabolic burst): sell a big part into it [house rule C34].
- Note for the lesson: two in three uptrend-rectangle breakouts come back to the breakout price within 30 days
  (Bulkowski, section 4). The day's-low stop will be tested often. That is normal, not a reason to widen it.

### 8.5 What invalidates it

Before the trigger:
- The depth grows past 15%: no longer a flat base [originator: IBD]. It may turn into a cup or a double bottom (my
  reading, not a source).
- A close under the 200-day [house rule B26].
- The base low is undercut: the flat base is off. If price reclaims the low within 3 sessions, it is a U&R setup
  instead [UCT: the owner's UnR habit; my proposal for the 3 sessions].
- The base turns wide and loose: the average daily range of the last 10 sessions is larger than that of the base's
  first 10 sessions [the test is my proposal; UCT: DAVE "too lose and wide"; TraderLion: "Wide and loose bases are a
  big sign of real danger."].
- A report within 3 sessions: wait [house rule B22].

After the entry:
- The stop is the exit [house rule A4; owner: "my stop is my stop most of the time"].
- A close back inside the base under the pivot is a warning, not an exit by itself [UCT code narrative "the first
  warning"]. The owner struck the rule "cut at least half if the stock falls back into its base" (2026-11-09).

### 8.6 Best market conditions

- A Green market reading: full risk; Yellow: smaller and fewer; Orange: A+ only; Red: mostly cash and shorts [house
  rule F65, B18, D46].
- A cue, not a rule: when many leaders are basing sideways after a pullback [UCT: Bracco 2025-10-26]. Bracco steps back when there is a
  "lack of clean, tight bases" [UCT].
- After a correction, when the reading turns Green again, start with a few positions [house rule F68]. TraderLion:
  "Flat base breakouts are more likely to succeed in a strong, bullish market."

### 8.7 Common mistakes

1. Calling a VCP or any sideways chop a flat base (our own Model Book card does this).
2. Buying a base too early: under 5 weeks or not yet tight [IBD: "One, two or three weeks do not get the job done.";
   O'Neil as quoted by TraderLion: "In almost all cases, one-, two-, and three-week bases are risky."].
3. Buying a wide, loose base [owner, DAVE and SNOW].
4. Buying a third or fourth-stage base [IBD S7; MarketSmith].
5. Chasing more than 4% past the pivot or more than 10% over the 10-day [house rules C28, C29].
6. Putting the stop at the base low (too wide) or pulling it tighter to fit the size [house rules A3, A13].
7. Buying a "flat base" under the 200-day: that is Bulkowski's bottoming base, not ours [house rule B26].
8. Ignoring the market [house rule F65; Bracco].
9. Picking examples after the fact. Bonde: "When a stock makes a big move the perception distorts the earlier chart."
10. Buying the week of earnings [house rule B22].
11. A biotech that burst once and then went flat. Bonde: it "often has upside breakout which fails."
12. Anticipating inside the base with no trigger [Kullamägi: anticipating is less effective].
13. Adding to it later or buying in pieces [house rule A5].

### 8.8 The short mirror: the flat base breakdown

The house rule says shorts are the long setups reversed (D47). Mirror, line by line:
- Below the 200-day, the 50-day below the 200-day [house rule B26].
- The left-side low is at least 30% under the highest high of the 65 sessions before it.
- At least 25 sessions sideways in a range at most 15% tall, opening at its low, the closes flat, tight at the end.
- RS rating 20 or less, in a weak group [house rule C31 mirror]; not hard to borrow [house rule D48].
- Trigger: price trades under the base's lowest low; short at market; stop a few cents over that day's high; same
  trims and trail, mirrored.
- Sources: Kell names it, "the Base n' Break to the downside will trade sideways into the declining moving averages."
  Bulkowski's downward measure rule for his flat base is 50% of the height. IBD's columns I read teach no short flat
  base. **Caution:** Bulkowski's downward breakouts from *uptrend* rectangles failed 34% of the time with an average
  13% decline, much worse than the upside. That is a different case (a top breaking down), but it shows the mirror is
  not automatically as good. Question 10.

---

## 9. Grading: A+ versus B-

The owner ruled that grading is discretionary and has no fixed checklist (E50). These are observable cues from the
sources, for teaching, not a score. Grade sets size (D38, E49).

| Cue | A+ | B- | Basis |
|---|---|---|---|
| Leadership | RS 90+, a top group, growing sales and earnings | RS near 80, a lagging group | house C31, D40; IBD |
| Prior advance | 50% or more, recent | about 30% or older | my proposal, from Kullamägi's 30-100%+ and the owner's examples (40%, 75%, a double) |
| Base stage | first or second | third or later | IBD S7; MarketSmith |
| Length | 5 to 8 weeks, or a long first base after new highs | right at the minimum | IBD's minimum; TraderLion ("six to eight weeks, often lead to stronger breakouts"); Bracco on MP |
| Depth | 10% or less | 12% to 15% | my proposal, from IBD "10% to 15%" and TraderLion; unmeasured, and Bulkowski's "Tall patterns perform better" points the other way |
| Tightness at the end | inside days, narrow ranges, tight weekly closes | wide daily bars, loose closes | IBD; owner (DAVE, SNOW) |
| The ceiling | 3 or more clean taps of one flat level | ragged top, one touch | owner (FUTU, RDDT, EAT); Bulkowski's rectangle touches |
| Volume in the base | dries up on the right side | heavy on down days | Bracco; owner (CRM, FUTU); mixed evidence |
| Moving averages | rides the rising 10/21-day above a rising 50 and 200 | under the 50-day for much of it, 200 flat | Kullamägi; house B26 |
| Breakout day | 40%+ over the 50-day volume, closes near the high | light volume, closes mid-range | IBD (volume); our `flat_base.py` text (close in the upper half); Bulkowski's data mixed |
| Stop | day's low within about 3% | 3% or more, near the ADR | house A13; Kullamägi |
| Market | Green | Yellow or Orange | house F65 |

---

## 10. Questions for the owner

1. **Name and scope.** Is "Flat Base Breakout" one setup with "flat top breakout" and "base breakout" as other names
   for it, or is a flat top with rising lows (an ascending triangle) its own setup? Options: (a) one setup; (b) two.
2. **The Model Book card.** It describes a VCP. Replace its text with the proposal in 5.9 and redraw it as a flat box?
   And is VCP a separate setup (the journal has both tags; the Model Book has only this card)? Options: (a) fix the
   card and add a VCP card; (b) fix the card only.
3. **Minimum length.** (a) 5 weeks, IBD's rule, shorter rests taught as flags; (b) 3 weeks, closer to your examples
   (FPS "4 weeks", USAR "8 days"); (c) 2 weeks, Kullamägi's.
4. **Maximum depth.** (a) 15%, IBD; (b) 12%, our Compass scanner; (c) 10%, the tight end of IBD's band.
5. **Prior advance.** (a) 20%, O'Neil; (b) 25%; (c) 30%, TraderLion and Kullamägi.
6. **Breakout volume.** (a) required at 1.4 times the 50-day average; (b) only for an A or A+ grade; (c) not used.
7. **Entries you use besides the pivot break.** Which, if any, go in the course: the early pivot inside the base, the
   undercut and reclaim of the base low, the retest after the breakout, the hourly break?
8. **Stop width.** When the breakout day's low is more than about 3% under the entry: (a) skip; (b) allowed up to the
   stock's ADR; (c) use the opening-range low (30-minute) instead.
9. **Earnings.** A flat base that breaks out on the earnings gap: (a) buy the gap day (after the report, B22 allows
   it); (b) treat it as a different setup (Episodic Pivot / Power Earnings Gap).
10. **The short mirror.** Teach the flat base breakdown (8.8) as a short? Options: (a) yes; (b) no, flat bases are long
    only.
11. **Sector ETFs.** XLI and IYT were called flat bases on the Substack. Do ETFs count, and does RS 80 (C31) apply to
    them?
12. **Grading cues.** Are the A+ and B- cues in section 9 the right things to look at, knowing grading stays your
    call (E50)?
13. **Our own numbers.** Run a replay of house rules (day's-low stop, 1/3 at 3R and 5R, 10/21-day trail) on flat bases
    from 2015 to now, to give members a win rate from our data instead of none?
14. **Which scanner feeds Study.** `flat_base.py`, the flat-top pair, the screener's flat-base or Chart IQ v3 (which
    already wrote 100 "Flat base" bank drafts at up to 22% deep)? Options: (a) one new rule from section 8 for all of
    Study; (b) the screener's (closest to IBD).
15. **Examples.** Review the names in 6.7 first (UCT's own calls), then fill to 10 from a scan using section 8?

---

## 11. Sources

All read on 2026-11-09. "Reader" = read through a page-reading tool; "saved" = downloaded and checked word for word.

**Originators (IBD / O'Neil and his firm)**

| # | Source | Publisher, author | Notes |
|---|---|---|---|
| S1 | ["Flat Base Is A Simple Pattern, But It Does Have Fine Details"](https://finance.yahoo.com/news/flat-simple-pattern-does-fine-205400421.html), 2013-06-25 | IBD, syndicated on Yahoo Finance | Reader. Linked words dropped in two sentences; only whole parts quoted. High reliability (the originator). |
| S2 | ["Learn To Spot A Bullish Flat Base On Stock Charts"](https://finance.yahoo.com/news/learn-spot-bullish-flat-stock-215000316.html), 2012-10-12 | IBD via Yahoo | Reader; checked word for word against the [Internet Archive copy of 2012-10-27](http://web.archive.org/web/20121027123040/http://finance.yahoo.com:80/news/learn-spot-bullish-flat-stock-215000316.html). High. |
| S3 | ["Early Buy Point In A Flat Base Can Give Investors Jump-Start"](https://finance.yahoo.com/news/early-buy-point-flat-investors-220500783.html), 2014-08-12 | IBD via Yahoo | Reader. High. |
| S4 | ["Looking At A Great Chart Base? Make Sure To Count The Weeks"](https://finance.yahoo.com/news/looking-great-chart-sure-count-203400677.html), 2015-03-11 | IBD via Yahoo | Reader. High. Also the source of IBD's 30% prior uptrend for any base. |
| S5 | ["Correctly Shaped Bases Create Winning Breakouts"](https://finance.yahoo.com/news/correctly-shaped-bases-create-winning-215900488.html), 2013-02-04 | IBD via Yahoo | Reader. High. |
| S6 | ["Flat Base Can Be Springboard To Big Stock Market Winners"](https://finance.yahoo.com/news/flat-springboard-big-stock-market-213500613.html), 2015-03-31 | IBD via Yahoo | Reader; checked word for word against the [Internet Archive copy of 2015-05-14](http://web.archive.org/web/20150514042134/http://finance.yahoo.com:80/news/flat-springboard-big-stock-market-213500613.html). High. |
| S7 | ["Why Late-Stage Base Patterns Often Lead To A Timely Exit"](https://finance.yahoo.com/news/why-stage-patterns-often-lead-215800864.html), 2015-06-16 | IBD via Yahoo | Reader. High. |
| S8 | ["Sit Tight: Tips For Dealing With A Pullback After The Breakout"](https://sg.finance.yahoo.com/news/sit-tight-tips-dealing-pullback-222700526.html), 2013-02-28 | IBD via Yahoo Singapore | Reader. High. |
| S9 | ["When To Buy Growth Stocks: Why Oracle Shows The Flat Base Is A Bullish Chart Pattern"](https://www.investors.com/how-to-invest/investors-corner/when-to-buy-the-basics-of-a-flat-base-a-super-growth-stock-pattern/), first 2023-04-24, updated 2026-03-31 | IBD, David Saito-Chung | Saved; lead paragraph only (paywall). |
| S10 | ["Flat Base Can Be Short, But Powerful, Pattern"](https://www.investors.com/ibd-university/how-to-buy/flat-base/), 2008-10-17 | IBD, Alan R. Elliott | Saved; lead paragraph only (paywall). |
| S11 | ["Flat Base"](https://www.marketsmith.hk/flat-base/?lang=en) | MarketSmith Hong Kong (O'Neil's data firm) | Saved. High. |
| S12 | [MarketSmith Pattern Recognition Users Manual](https://silo.tips/download/marketsmith-pattern-recognition) | MarketSmith; copy on silo.tips, undated | Saved. Medium: a third-party copy of a vendor manual. Also the source of the 0-5% buy range, 5-8% loss range and stage reset. |

**Other originators and educators**

| # | Source | Publisher, author | Notes |
|---|---|---|---|
| S13 | ["William O'Neil Setups"](https://stockbee.blogspot.com/2011/12/william-oneil-setups.html), 2011-12-13 | Stockbee, Pradeep Bonde | Saved. His own view plus O'Neil quoted (no edition named). |
| S14 | ["Finding flat bases and cups with handle"](https://stockbee.blogspot.com/2007/02/finding-flat-bases-and-cups-with-handle.html), 2007-02-25 | Stockbee, Pradeep Bonde | Saved. |
| S15 | ["How to find non existent patterns in the charts"](https://stockbee.blogspot.com/2009/08/how-to-find-non-existent-patterns-in_13.html), 2009-08-13 | Stockbee, Pradeep Bonde | Saved. |
| S16 | ["How to trade biotechs profitably"](https://stockbee.blogspot.com/2009/06/how-to-trade-biotech-profitably.html), 2009-06-08 | Stockbee, Pradeep Bonde | Saved. |
| S17 | ["Master the Flat Base Pattern for Maximum Profits"](https://traderlion.com/technical-analysis/the-flat-base-pattern/), 2023-03-12 (modified 2024-10-27) | TraderLion, Nick Schmidt | Saved from the Internet Archive capture of 2025-05-13; the live site refused (HTTP 403). Medium: an educator; its O'Neil and Weinstein quotes name no book. |
| S18 | ["3 TIMELESS setups that have made me TENS OF MILLIONS!"](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/), 2021-01-08 (updated 2021-04-28) | qullamaggie.com, Kristjan Kullamägi | Saved. High (his own words). Reader comments on the page were not used. |
| S19 | [Kell Trading home page](https://kelltrading.com/) | Oliver Kell | Saved. High (his own site); one line per step. |
| S20 | ["Cycle Of Price Action"](https://traderlion.com/technical-analysis/chart-patterns/cycle-of-price-action-by-oliver-kell/), 2024-09-10 | TraderLion, bylined Oliver Kell | Saved from the Internet Archive capture of 2025-06-23. High. |
| S21 | ["Wyckoff Method" (heading "Real Rules of the Game")](https://www.wyckoffanalytics.com/wyckoff-method/) | Wyckoff Analytics (Wyckoff Associates, LLC), no author, no date | Saved. High for the Wyckoff school's definitions. |
| S22 | ["Stage Analysis Breakout Quality Checklist"](https://www.stageanalysis.net/blog/4372/stage-analysis-breakout-quality-checklist), 2019-10-01 | Stage Analysis, no author | Saved. Medium-low: the site's own checklist, not Weinstein's words. |

**Measured statistics (Bulkowski; the site carries an AI-training notice, flagged in 3.9).** The cold check read each
page word for word in an Internet Archive copy (October 2026; Volume Study April 2026), since the live site refuses a
plain download (HTTP 406).

| # | Source | Notes |
|---|---|---|
| S23 | [Bulkowski on the Flat Base Pattern](https://thepatternsite.com/FlatBase.html), Thomas N. Bulkowski | Reader. A different pattern from O'Neil's. |
| S24 | [Rectangle Tops](https://thepatternsite.com/recttops.html) | Reader. Statistics. |
| S25 | [Bulkowski on Ascending Triangles](https://thepatternsite.com/at.html) | Reader. Statistics. |
| S26 | [Volume Study](https://thepatternsite.com/VolumeStudy.html) | Reader. 8,000+ patterns, 1991-2011. |
| S27 | [Study of studies](https://thepatternsite.com/studystudy.html), sections GS9 and GS11 | Reader. Counts of studies, not trades. |
| S28 | [Glossary](https://thepatternsite.com/glossary.html) | Reader. Definitions of failure rate, average rise, ultimate high, throwback. |
| S29 | [Volume pattern resource](https://thepatternsite.com/volpatterns.html) | Reader. |

**Academic**

| # | Source | Notes |
|---|---|---|
| S30 | Lo, Mamaysky and Wang, "Foundations of Technical Analysis", *Journal of Finance* 55 (2000), 1705-1765 ([abstract page](https://web.mit.edu/~alo/www/Papers/techanal.html)); NBER working paper [w7613](https://www.nber.org/system/files/working_papers/w7613/w7613.pdf) | Abstract read; the working paper read only for its list of ten patterns (rectangle tops and bottoms among them). Peer reviewed. Rectangle tables not read. |

**UCT (house)**

- UCT Substack, all 103 posts listed in https://unchartedterritoryy.substack.com/sitemap.xml, read through Substack's
  post feed and saved; the posts quoted are linked in section 6. "The Parabolic Short" (Bracco) was downloaded with the rest; it has nothing on flat bases.
  The Sunday Scans of 2026-10-18 is subscriber-only and was not read past its preview.
- `docs/study/sizing_rule.md` section 9 (the account rulebook); `docs/study/TRADE_PLANS.md`;
  `docs/study/audits/2026-10-24/owner_verdicts.jsonl` (the latest rulings, 2026-11-08 and 2026-11-09, and the TAN and
  HON Launchpad rulings).
- Code: `api/services/pattern_engine/detectors/uct/flat_base.py`, `uct_flat_top_breakout.py`,
  `uct_flat_top_breakout_ftb4.py`, `uct_setups_common.py`; `api/services/pattern_engine/primitives/liquidity.py`;
  `api/services/pattern_engine/detectors/registry.py`; `api/services/screener/base_catalog.py`;
  `api/services/chart_iq/engine/v3_bases.py`; `scripts/study/bank_v2/gen_bases.py`; `api/services/study_trade.py`;
  `api/services/study_hard.py`.
- App: `app/src/pages/modelbook/setupCatalog.js`, `app/src/constants/setupGroups.js`,
  `app/src/pages/journal-2-0/lib/setupTagMap.js`.
- Plans: `docs/study/UNITS-method.md` (SET.07, SET.12), `docs/study/courses/V/V.02.json`, `V.04.json`.
- Not quoted: the in-house knowledge base extracts under `docs/study/levels/` hold more trader notes on bases. They come
  from private sources, so nothing from them is copied into this public file.

**Tried and not reached (so nothing from them is quoted)**

- William O'Neil, *How to Make Money in Stocks*: no access to the book; Google Books asked for a captcha. The Internet
  Archive holds lending copies (1988 to 2011 editions) but its search-inside service did not answer in the cold check.
  Quoted only through Bonde (S13) and TraderLion (S17).
- Oliver Kell, *Victory in Stock Trading* (sold on kelltrading.com): not read.
- Mark Minervini's books and site: no primary page found; secondary sites disagree.
- Stan Weinstein, *Secrets for Profiting in Bull and Bear Markets*: not read.
- Nicolas Darvas, *How I Made $2,000,000 in the Stock Market*: not read.
- Edwards and Magee on rectangles: not read.
- investors.com articles in full (paywall), Nasdaq's IBD copies (timed out), MarketSmith India (no article text served),
  traderlion.com live (HTTP 403).
- Not searched for this setup: Linda Raschke, Toby Crabel, Larry Williams, Victor Sperandeo, John Carter, Lance
  Breitstein, Brian Shannon. I know of no flat base rule from them, but I did not check. Their narrow-range and
  opening-range ideas would touch only the tightness and entry lines.

---

## Removed in checking

The cold check (2026-11-09) re-opened every quote, statistic, attribution and code claim above. Of the quotes, all were
found word for word on their pages. What was wrong or unsupported, and what was done:

**Corrected (the truth was found)**
1. IBD's Monster Beverage example was dated "2014 from context". The column says the base formed "in September to
   October 2010". Fixed in 3.1 and 6.7.
2. IBD's Baidu example was dated 2014 (the column's year). The base began "July 27, 2009" and the Sept. 8 breakout was
   in 2009. Fixed in 3.1 and 6.7.
3. Herbalife was dated "about 2010". The column gives the breakout as the week ended Feb. 25, 2011. Fixed in 6.7.
4. The Tractor Supply quote silently dropped a chart marker, "(1)", from the middle of the sentence. The gap is now
   marked.
5. `flat_base.py` depth: the file said dividing by the midpoint "reads a little shallower than IBD". It reads deeper
   (a 12% midpoint depth is about 11.3% from the high). Fixed in 5.1.
6. `flat_base.py` stop width: "13% or more" under the entry. The code's most is about 12.7%. Fixed in 3.12, 5.9.
7. "Liquidity floor $2 and $10,000 in every scanner": Chart IQ v3 has no floor of its own (the bank keeps the day's top
   1,000 by dollar volume). Fixed in 5.5, 5.9 and section 7.
8. Chart IQ v3's short flat base is "20 bars or fewer" (the code's `n <= 20`), not "under 20". Fixed in 5.5.
9. The proposed flatness rule said "less than two thirds of the depth"; the code's limit is 10% of the average close,
   two thirds of the 15% ceiling, not of the base's own depth. Fixed in 8.1.
10. `uct_flat_top_breakout` was called simply "admin-only". The scan result is; its drawing is in the member drawing
    set (`registry.py`). Fixed in section 2 and 5.2.
11. The drawing-judge row stopped at the v3 re-judge. Later blind checks passed `flat_base`'s team drawing and the
    screener's flat base as a pivot line (2.40, 2.30). Added in section 4.
12. Three "Rest of the Week" posts and the Nick Schmidt interview were dated by their UTC timestamp, one day late
    (2025-10-15, 2025-12-03, 2026-01-07, 2025-06-13). Their own subtitles and Eastern time give 2025-10-14, 2025-12-02,
    2026-01-06 and 2025-06-12. Fixed.
13. "Tight inside day" was given as the owner's words in 8.1. It is a team contributor's (GM, 2026-01-06). The owner's
    own words used instead: "double inside days", "Anything sideways, preferably an inside day".
14. "TraderLion's quote of O'Neil" for "Wide and loose bases are a big sign of real danger.": the page prints it in
    quotation marks with no speaker named. Reworded in 3.3 and 8.5.
15. The Bulkowski rectangle column said breakout volume "not required"; his page does not say that. Now "not stated".
16. "Every page says" (Bulkowski's AI notice): six of the seven pages read carry it; the archived Volume Study page did
    not show it. Reworded in 3.9.
17. Bulkowski's flat base was described as "usually after a decline". His page does not say "usually"; it was
    replaced by his own words (rectangle bottoms are "a special case of a flat base") and the fact that his example
    follows a steep drop.
18. The Lo, Mamaysky and Wang row said rectangles were tested, but the only page read was the abstract, which does
    not name them. The NBER working paper's pattern list confirms rectangle tops and bottoms; the source was added.
19. The 5% buy zone was "widely attributed to IBD, not read in its own words". O'Neil's data firm's manual states it:
    "The Pivot Range is 0% to 5% above the pivot point". Added in 3.1, 3.2, 3.11, 3.12 and section 7.
20. Basis tags made honest in sections 8 and 9: "10% or less is the A+ version" and "three taps is the A+ version"
    were tagged as if sourced; both are now marked as proposals (no source grades them, and IBD's "three points" is
    about the early buy point). The 65-session window in the prior-trend rule is marked as a proposal. "At most 65
    weeks" is MarketSmith's alone, not IBD's. The Red market line now matches F65 and D46 ("mostly cash and shorts").
21. Lines that were not measurable were given a test, each tagged as a proposal: "price mostly holds the 21-day or
    50-day" (now 80% of closes at or above the 50-day), "daily ranges grow" (now the last 10 sessions' average range
    against the first 10), "clearly more than about 3%" (now more than 3%, with question 8).
22. "The owner uses Kell's terms ... (18 passages)": the count could not be reproduced (the checker counts about
    twenty, depending on how passages are split). Replaced by "about twenty paragraphs".
23. The Wyckoff Analytics page was cited as "Wyckoff Method: Real Rules of the Game"; its title is "Wyckoff Method" and
    "Real Rules of the Game" is a heading on it. Fixed in 3.7 and S21.
24. A new wording added in this check, A13 "usually within about 3%", was not the rulebook's text; it now quotes A13
    as written: "the stop usually sits within about 3% of the buy".
25. IBD S1's "Flat bases tend to form as a second or third base in a stock's major advance" is a fragment: the column's
    sentence continues after "advance". It was already shown without a full stop; noted here so a lesson does not
    present it as a whole sentence.

**Added (missed by the first pass)**
- IBD's own 30% prior-uptrend rule for any base (S4), which now joins the prior-trend consensus.
- IBD's "first-stage or second-stage base" sentence (S7) and MarketSmith's stage reset rule.
- MarketSmith's loss range (5% to 8% under the pivot) and profit range (20% to 25% over it).
- O'Neil, as quoted by TraderLion: "In almost all cases, one-, two-, and three-week bases are risky."
- Bulkowski: "Tall patterns perform better than short ones." (a conflict with shallow-is-better, 3.12 point 9),
  "Throwbacks hurt post breakout performance." and "Select a flat base longer than 65 days".
- The owner never writes the words "flat base" in his own sections (6.6).

**Removed (could not be confirmed)**
- "Retail education sites use [flat top breakout] for a flat ceiling with rising lows (an ascending triangle)." No
  site was named or read.

**Checked and confirmed, no change:** every other quote (IBD S1-S10, MarketSmith Hong Kong and manual, Stockbee x4,
TraderLion x2, qullamaggie.com, kelltrading.com, Wyckoff Analytics, stageanalysis.net, Bulkowski x7, 55 Substack
passages with their tickers and section authors, the owner's verdicts), all Bulkowski and in-house statistics, and the
code summaries of `flat_base.py`, the two flat-top scanners, `base_catalog.py`, Chart IQ v3, the Model Book card, the
journal tags and the course plan. The 2026-10-18 Sunday Scans is confirmed subscriber-only; the sitemap lists 103
posts.

---

## 12. Examples (from our data)

**The scan's rule (one paragraph).** Daily bars from the local sandbox, 1984 to 2026-11-06, every ticker with 320 or
more sessions (3,874 names; the scan completed, nothing was cut for time). A hit is the first session whose high trades
above the pivot, where the pivot is the highest intraday high of a base that satisfies section 8: 25 to 325 sessions
long (5 to 65 weeks), the longest qualifying length taken; the left-side high was the highest high of the 100 sessions
before it and at least 30% above the lowest low of the 65 sessions before it; the base's first week came within 3% of
the pivot; depth (pivot to lowest low) 15% or less; the least-squares line through the closes drifts no more than 10%
of the mean close; tight at the end (the last 10 sessions' range at most half the base's depth, or an inside day in
the last 3 sessions); two or more separate touches of the pivot within 0.5 ATR(14); at least 80% of the base's closes
at or above the 50-day; on the trigger day close > 50-day > 200-day (B26) with the 200-day not below its value 20
sessions earlier; close $10 or more and 50-day average dollar volume $20 million or more (B23); the market-order fill
is the pivot plus a cent, or the open when the open gapped above the pivot, and no fill more than 4% over the pivot
(C28) or more than 10% over the 10-day average (C29); no trigger in the 3 sessions before a report where report dates
exist (B22); stop 5 cents under the lower of the trigger day's low and the prior day's low, falling back to the
trigger day's low alone, and the trade skipped if that is still more than 3% under the fill (A13). Breakout volume,
volume dry-up, taps, close position and the ADR are recorded as grade cues, not gates. Not coded: base count (first or
second base), the RS rating and group, the market reading, and the trims. One hit per name per 20 sessions.
Outcome: from the day after the trigger, 60 sessions forward, the first of stop / 3R / 5R; same day, the stop wins.

**Base rate.** 3,849 hits (3,671 on stocks, 178 on ETFs; 3,644 of the stock hits are on names in the house liquid
universe). Of the stock hits, **28.9% reached 3R and 20.0% reached 5R before the stop**; 86.5% were eventually stopped
at the original stop within the 60-session window (that includes winners, since the stop never moves here), and 46%
never reached 1R before the stop. Among the winners the median time to 3R was 5 sessions. The window is the whole
database, 1994-01-31 to 2026-11-04. **Caveat:** this is a fixed stop with no trims, no breakeven move, no trail and no
time stop, so it measures how often the structure delivers 3R and 5R, not what the house trade earns. Cuts worth
teaching (same scan, stocks only): breakout volume 1.4x the 50-day average or more, 788 hits, 39.2% to 3R and 30.1% to
5R, against 26.0% and 17.3% below 1.4x (IBD's volume rule earns its grade); a gap open above the pivot (582 hits) did
better, 37.8% / 27.7%, not worse; depth 10% or less (1,207 hits) was NOT better, 27.1% / 18.5% against 29.7% / 20.8%
for 10-15%, which sides with Bulkowski's "Tall patterns perform better" over the shallow-is-better proposal in 8.1;
three or more taps (1,621 hits) made no difference, 28.9% / 20.5%; volume drying up in the second half (2,859 hits)
made no difference, 29.0% / 20.1%. Triggers that were themselves earnings-reaction days (102) did better, 43.1% /
35.3%, but they are a different setup (question 9) and were excluded from the examples.

**The 10 examples** (all stocks, one per name, ten different years, none an earnings-reaction day; every one reached
5R and was above 1R by the tenth session, so the house time stop (C33) would not have cut it; prices are
split-adjusted as the database holds them). Files: `scratchpad/setups/01-flat-base/final/NN_TICKER_DATE.png` and the
phone sheets `sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png` (not in the repo).

| # | Ticker | Trigger | Base (weeks / depth / taps / prior run) | Breakout vol | Buy | Stop (risk) | Best R (3R on day) | Why it is textbook |
|---|---|---|---|---|---|---|---|---|
| 1 | NUS | 2013-09-09 | 6.0 wk / 10.3% / 3 / +82% | 1.85x | 90.01 | 88.22 (2.0%) | 23.5R (1) | A six-week shelf riding the rising 10- and 21-day after the stock nearly doubled; three clean taps of 90; broke out on 1.9x volume and reached 3R the next session. |
| 2 | FIX | 2025-09-10 | 6.4 wk / 11.6% / 3 / +115% | 1.57x | 733.26 | 721.82 (1.6%) | 25.1R (1) | The shelf sat above a steep 50-day after a run from about 300; three taps near 733; 3R the next session, and the lowest low of the next 30 sessions (751.85) never came near the pivot. |
| 3 | ALLY | 2019-06-27 | 11.2 wk / 5.5% / 4 / +31% | 1.80x | 30.28 | 29.79 (1.6%) | 8.1R (10) | The shallowest base of the ten (5.5%), four taps of 30 and inside days into the breakout: the "tight at the end" rule in one picture. Slower, 3R on day 10. |
| 4 | LNG | 2014-05-29 | 8.6 wk / 14.3% / 4 / +47% | 3.34x | 59.40 | 57.96 (2.4%) | 11.8R (1) | At the depth limit (14.3%), but four taps, volume drying up on the right side, and a 3.3x volume breakout that reached 3R the next session: depth matters less than the ceiling and the volume. |
| 5 | WSM | 2023-09-25 | 8.0 wk / 14.6% / 4 / +30% | 4.99x | 73.16 | 72.24 (1.2%) | 10.0R (1) | The heaviest breakout volume of the ten (5x); 5R by day 10, then a throwback to 71.56 in late October, through the pivot and the original stop, after both trims were due: Bulkowski's two-in-three throwback in person, before the run to 99. |
| 6 | CMG | 2020-07-06 | 6.6 wk / 11.3% / 3 / +155% | 1.36x | 21.75 | 21.18 (2.6%) | 10.3R (11) | A flat shelf after the March-2020 rebound; three taps; the 50-day crossed back above the 200-day inside the base. Volume only 1.36x and 3R took 11 sessions, a B+ version that still worked. |
| 7 | BAC | 2017-02-14 | 9.8 wk / 10.7% / 5 / +57% | 1.33x | 23.56 | 23.12 (1.9%) | 5.1R (5) | Five taps of a 23.5 ceiling after a vertical run; 5R in about three weeks, then it fell back into the base (low 22.16 within 30 sessions). The case for taking the 3R and 5R trims (B19) and trailing the rest. |
| 8 | LII | 2016-07-01 | 12.6 wk / 7.9% / 4 / +33% | 0.82x | 143.20 | 141.89 (0.9%) | 15.9R (4) | A long, shallow shelf; the breakout came on light volume (0.82x) and still ran to 15.9R, the case for volume as a grade cue, not a gate. The stop was tested to the cent (low 141.90) before it went. |
| 9 | APH | 2026-01-12 | 10.8 wk / 13.2% / 4 / +49% | 1.30x | 72.20 | 70.70 (2.1%) | 7.6R (3) | Four taps of 70-72 over eleven weeks on a rising 50-day; 3R on day 3 and 5R by day 10, then a failure back through the base (low 63.10 within 30 sessions): the trims and the trail are what keep this a win. |
| 10 | C | 2012-12-17 | 8.8 wk / 12.1% / 2 / +54% | 1.30x | 38.73 | 37.71 (2.6%) | 9.0R (12) | The minimum two taps and modest volume: a B-grade version. It paused just under the pivot for two weeks (low 38.50, above the stop) before running; 3R on day 12. Shows that the minimum structure can still pay when the stop holds. |

Replaced in the visual review: ZION 2003-07-18 (two taps on a base that read as a shallow pullback, not a shelf, and an
RS proxy of 55), AAPL 2010-12-06 (a clean shelf, but only 0.6R by the tenth session, so the house time stop C33 would
have sold it before the 6.5R move) and GOOG 2021-06-07 (a clean, slow 12.8R climb, but an RS proxy of 75, under the
C31 line). None failed the scan; they failed the "obvious to a learner" and the house-rules tests.

**Relative strength (a proxy, not IBD's rating).** The scan cannot read an RS Rating, so `rs_proxy.py` ranks each
example's weighted 12-month price change (the latest quarter counted twice, quarters of 63 sessions) from 1 to 99
against every name in the database with a year of history on that date (1,500 to 3,800 names, survivors only, so it
is NOT the IBD number and will run a little high). Ranks on the trigger day: NUS 96, LNG 96, FIX 94, CMG 89, C 90,
BAC 88, APH 86, WSM 83, LII 82, ALLY 80. All ten are at or above the house line of 80 (C31) on this proxy; ALLY sits
exactly on it.

**Notable failures (from the same scan).**
- **AMZN 2024-03-21.** A 6.4-week, 8%-deep shelf with four taps of 180, inside days at the end, volume drying up: the
  structure was as good as any example above. The breakout day traded to 181.41 on 0.72x volume and closed at
  178.15, the low of the day, back inside the base; the next session's low (176.75) took the 2.05 stop. It closed
  3% under the fill 20 sessions later. The lesson is the close: a breakout that finishes at the day's low has not
  broken out (the "close in the upper half" cue from `flat_base.py`, section 5.1).
- **META 2020-06-23.** A 5-week, 12.5%-deep base with four taps after a 73% run. It gapped open above the pivot
  (241.28), made 245.19, closed mid-range on average volume (1.0x), and the next day's low (232.68) hit the stop; two
  sessions later it closed at 216.08, 10% under the fill. The stop did its job: the alternative, "give it room", was a
  14% hole in three sessions. It recovered to the pivot only after about six weeks.
- **XOM 2026-03-20.** A 6-week, 10.4%-deep base, two taps, breakout on 2.5x volume, but a close at 159.67 in the
  bottom fifth of the day's range, and the stop was 0.88% under the fill while the stock's 20-day average range was
  2.5%. A 2% gap-down the next morning (low 155.02) stopped it; it then closed back above the pivot the same day and
  ran to 176 within six sessions. A stop set inside the stock's normal daily range gets shaken out by noise; the
  rule in 8.3 (skip or wait for a tighter entry, never pull the stop in) is written for this, and so is a second
  entry on the reclaim.

**Limits of this check.** Base count, the real RS rating and the group, the market reading and the owner's discretionary grade
are not in the scan, so the base rate mixes A+ and C setups. The database has no delisted names, so the base rate
leans toward survivors. ETFs were scanned but excluded from the examples. The scan predates the 2026-11-09 `C.scan`
helper; the same rules were run over every ticker to completion, so coverage is full. Everything here is from bars;
nothing is a published statistic, and none of it should be quoted as one.

---

## 13. Failures and near-misses (from our data)

(Added 2026-11-10, deliverable 4 of `CRITERIA_PROGRAMME.md`. Every number is read off the sandbox's daily bars with the same scan and the same fixed-stop walk as the examples section above; charts in `_study-resume/scratchpad/setups/01-flat-base/final/` (`fail_1-4.png`, `near_1-4.png`, `pair_06-vcp.png`), numbers in `final/failures.json` and `final/near_misses.json`, scripts `near_scan_*.py` and `failnear_*.py` in the setup's scratchpad folder, outside the repo.)

**Four failures.** Valid flat base setups by every gate of the card, bought by the rules and stopped before 3R (fixed stop under the day's low, no trims, no breakeven move). Dates are the trigger day; "where it stopped" counts sessions after the trigger.

| Ticker | Date | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|
| AMZN | 2024-03-21 | 180.15 | 178.10 (1.14%) | day 1 (2024-03-22, low 176.75), best 0.0R | A 6.4-week, 8.0% shelf with four taps after a 33% run. The breakout day closed at 178.15, the low of its range, back inside the base, on 0.72x volume. The next session's low (176.75) took the 178.10 stop. | `fb.close_back_in_base` |
| META | 2020-06-23 | 241.28 | 236.86 (1.83%) | day 1 (2020-06-24, low 232.68), best 0.0R | A 5-week, 12.5% base with four taps after a 73% run. It gapped open at 241.28 above the 241.21 pivot, closed mid-range at 242.24 on 1.0x volume, and the next day's low (232.68) hit the stop. | `fb.stop` |
| XOM | 2026-03-20 | 160.46 | 159.05 (0.88%) | day 1 (2026-03-23, low 155.02), best 0.0R | A 6-week, 10.4% base, two taps, breakout on 2.52x volume, but a close at 159.67 near the day's low. The stop sat 0.88% under the fill against a 2.54% average daily range; the next morning's low of 155.02 took it. | `fb.stop_width` |
| BHC | 2015-04-09 | 206.85 | 203.95 (1.4%) | day 6 (2015-04-17, low 203.46), best 1.63R | A 6.4-week, 10.0% shelf with four taps after a 55% run, volume in the second half of the base a quarter of the first. The breakout came on 0.5x volume and closed low in its range at 205.72; it reached 1.63R and was stopped on day 6 (low 203.46). | `fb.breakout_volume` |

**Four near-misses.** Charts that look like a flat base but fail exactly one gate of the card. Each came from re-running the setup's scan with that one gate relaxed and keeping only the hits the strict rule rejects for that criterion; everything else passed. The outcome is the same fixed-stop walk, for information only: a near-miss that worked is still not the setup.

| Ticker | Date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|
| AMZN | 2020-05-19 | `fb.depth` | 18.5% deep; the rule is 15% or less | A 27-session rest after a 51% run with three taps, but 18.5% deep. Past 15% it is not a flat base; it is a cup-shaped base (04-cup-handle territory). Best 1.1R, stopped. |
| NVDA | 2026-05-08 | `fb.length_min` | 13 sessions from the left-side high; the rule is 25 or more | A 13-session, 10.2% pause after a 32% run. Too short for a flat base; a rest of 10 to 40 sessions after a 30% move is the Qullamaggie breakout base (setup 18). Best 4.9R, stopped. |
| MSFT | 2024-03-21 | `fb.prior_trend` | +28% before the base; the rule is 30% or more | A 39-session, 7.2% shelf with two taps, but only a 28% rise before it. A large-cap drift with no leader's run in front of it, graded under the moving-average pullback cards rather than as a flat base. Best 0.0R, stopped. |
| BBY | 2026-07-09 | `fb.above_mas` | close +14.3% against the 200-day, 50-day -1.6% against it; the rule is close > 50-day > 200-day | A 28-session, 14.5% base after a 42% rebound; the close was 14.3% above the 200-day but the 50-day was still 1.6% under it. A base built in a recovery out of a downtrend, not a leader resting above a settled 50 over 200 order. It worked (best 6.3R) but it is not ours. |

**What the failures have in common.** All four passed every structure gate and none reached 3R; three were stopped the next session. Two closed the breakout day in the lower part of its range (AMZN at the low, XOM near it), three broke out on volume at or under the 50-day average (AMZN 0.72x, META 1.0x, BHC 0.5x), and the one with heavy volume (XOM, 2.52x) carried a stop inside the stock's normal daily range. The breakout day's close and volume are what grade the trade, and the stop under the day's low only works when it sits outside the day-to-day noise.

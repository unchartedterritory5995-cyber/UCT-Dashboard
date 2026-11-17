# Setup 04: Cup & Handle (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page
named next to it. Quotes from saved copies (Zanger, StockCharts, Stockbee, UCT's Substack, our own code) were checked
word for word against the saved file. Quotes from Yahoo Finance reprints of IBD columns and from Bulkowski's site were
read through a fetch tool (Yahoo refused plain downloads, Bulkowski's server refused curl), and the key IBD sentences
were checked a second time with an exact-match pass. Nothing here is a ruling. Where I could not read a source, I say so
and give no wording from it.

**Cold check, 2026-11-09 (a second reader).** Every quote below was re-opened at its source: the IBD columns on Yahoo
Finance and Bulkowski's pages through a fetch tool, asked to copy each sentence and to report deliberate decoy sentences
as missing (it did, every time); Zanger, StockCharts, Stockbee, investors.com, Kullamägi, the Internet Archive record,
Minervini's posts (X's public oEmbed service) and all 103 UCT posts by plain download and an exact string match; our
code read in full and the synthetic probe re-run. Corrections are made in place; the list of what changed and what was
removed is at the end ("Corrections and removals in checking").

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the named trader's or
IBD's own words; **[UCT]** UCT's own writers or the owner's verdict log; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

Names used for UCT's writers: **TSDR** is the owner's own section of the newsletter ("TSDR's Weekly Outlook &
Watchlist", "TSDR Trading"). **Bracco** is the partner ("Bracco's Breakdown & Top Ideas"). ChartMaster, Manrav, Beebe
and others are community contributors in "The Rest of the Week".

---

## 1. What it is

A stock that has already run up at least about 30% rests in a rounded, U-shaped base that takes weeks or months, climbs
back near its old high, then dips a little on light volume (the handle). You buy when price breaks above the top of
the handle, ideally on heavy volume.

**Why it works (the psychology).** These points are the classic explanations, not measured facts.
- **The old high is a wall of sellers.** People who bought near the left-side high and sat through the fall want their
  money back. Dan Zanger: "As the stock comes up to test the old highs, the stock will incur selling pressure by the
  people who bought at or near the old high." ([chartpattern.com](https://www.chartpattern.com/cup-handle.cfm)) The
  handle is that supply being absorbed.
- **The handle shakes out weak holders.** IBD: "Most successful handles also feature a shakeout, where prior lows in the
  handle are undercut." And: "This serves to scare out weak hands, i.e. shareholders who lack conviction"
  ([IBD, 2015-02-25](https://finance.yahoo.com/news/why-look-proper-handle-often-220600578.html)).
- **Light volume in the handle says sellers are running out.** IBD: "Volume should dry up, evidence that the weak
  holders are just about gone." ([IBD, 2015-09-24](https://finance.yahoo.com/news/faulty-handle-spells-trouble-too-195200814.html))
- **Who is trapped at the breakout:** anyone who sold the handle dip or shorted under the old high. When price clears
  the handle's top they buy back, and late buyers who waited for "new highs" chase. That demand meets thin supply.
- **Who is buying:** in O'Neil's telling, large funds accumulating a leader. That is IBD's explanation of the pattern,
  not something I could check with data.
- **IBD's plain description:** "The base is a place where the stock pauses to rest and get ready for the next move up."
  ([IBD, 2014-11-04](https://finance.yahoo.com/news/stock-buys-bases-things-better-221700195.html))

---

## 2. Origin and naming

**Who named it.** William J. O'Neil, founder of Investor's Business Daily. StockCharts: "It was developed by William
O'Neil and introduced in his 1988 book How to Make Money in Stocks."
([ChartSchool](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns/cup-with-handle))
AAII says the same: O'Neil "introduced the cup with handle in his 1988 book"
([AAII, Thorp, 2015-12](https://www.aaii.com/journal/article/the-cup-with-handle-pattern)). The Internet Archive's
catalogue confirms a 1988 McGraw-Hill edition (*How to make money in stocks: a winning system in good times or
bad*, ISBN 0070477604; the record does not label it a first edition). AAII's 2001 article also calls it "a price
pattern identified by William O'Neil, founder of Investor's Business Daily". **I could not read the book's text.** The Archive's lending copies and Google Books both
refused automated access, so no wording from the book is quoted here. O'Neil's rules below come from IBD, his own
publication; an IBD column calls him "IBD founder and Chairman William O'Neil"
([IBD, 2015-06-30](https://finance.yahoo.com/news/stock-gains-20-25-build-220800542.html)).

I found no earlier named source for the "cup with handle". StockCharts and AAII both credit O'Neil, and Bulkowski's
duration rule (7 to 65 weeks) is the same as IBD's, which suggests later writers took O'Neil's bounds.

**Other names and close relatives**

| Name | What it is | Who |
|---|---|---|
| Cup with handle, cup-with-handle base, cup and handle, "Cup n Handle" | The pattern itself | O'Neil / IBD; everyone |
| Cup without handle (a "cup base") | Same cup, no handle; buy point at the left-side high | IBD, 2013-10-03 |
| Saucer with handle | A longer, shallower cousin | IBD lists it as a separate base (2014-11-04) |
| 3-C, cup completion cheat, "cheat", low cheat | An earlier buy inside the cup, in its lower to middle third | Mark Minervini |
| Inner cup | A smaller cup inside a larger one | Bulkowski |
| "Mid range cheat entry" | The owner's own words for an early buy inside a forming cup and handle | TSDR (UCT), 2026-02-04 |
| Inverted cup with handle | The short-side mirror | Bulkowski; our app's `inverse_cup_handle.py` |

---

## 3. Every definition I could find, source by source

### 3.1 O'Neil / Investor's Business Daily (originator's own publication)

IBD's site (investors.com) is paywalled: a plain download returns only each article's free first lines (3.1.9). I
read IBD's columns as syndicated in full on Yahoo Finance, where each carries the "Investor's Business Daily" byline.

**3.1.1 Shape.** "Cup-with-handle patterns are shaped like the silhouette of a tea cup viewed from the side."
([IBD, 2015-03-11](https://finance.yahoo.com/news/looking-great-chart-sure-count-203400677.html))
"Cups should show smooth action on the left and right sides of the pattern." "There shouldn't be jagged edges or many
wild weekly swings of 10% to 15% or more." Symmetry: "the number of down weeks on the left side should roughly match the
number of up weeks on the right side" ([IBD, 2013-02-04](https://finance.yahoo.com/news/correctly-shaped-bases-create-winning-215900488.html)).
"V-shaped patterns are less reliable." ([IBD, 2013-10-03](https://finance.yahoo.com/news/cup-patterns-without-handles-still-182000010.html))

**3.1.2 Prior trend.** "The pattern's basic requirements start with a run up of at least 30% before the stock turns
down into a consolidation." ([IBD, 2015-09-11](https://finance.yahoo.com/news/chart-pattern-star-power-simple-212700404.html))
Another column praises "a steep climb of more than 30% before the pattern started to form in April."
([IBD, 2013-09-25](https://finance.yahoo.com/news/cup-handle-familiar-understand-key-203500768.html)) And, on where to
look: "In a weekly chart, look for periods of sideways movement or mild declines following a prior uptrend of at least
30% in price." (2015-03-11)

**3.1.3 Length.** "A proper cup base needs to span a minimum of seven weeks, while a flat base can be as short as five
weeks." ([IBD, 2015-02-18](https://finance.yahoo.com/news/qualities-investors-look-studying-bases-224700851.html))
"The base must be at least seven weeks long, including the handle." (2015-09-11) "They range from seven weeks to as long
as 65 weeks in length, with many forming over three to six months." How to count: "Count the weeks in the base starting
with the first week that closes down through the week prior to the breakout." (2015-03-11) But the cup-without-handle
column says: "A cup can be as short as six weeks." and "Most outstanding cup patterns will last between three and six
months." (2013-10-03)

**3.1.4 Depth.** "The size of the decline, or correction, in a cup base should generally be between 12% and 33%."
(2015-02-18) "The consolidation (the decline from the stock's high) can be up to 35% deep, but tends to range from 12%
to 33%." (2015-09-11) "The correction in a cup should generally run no deeper than 30% to 35%." "In bear markets, cups
can run as deep as 50%." Against the market: "to correct 1-1/2 to 2-1/2 times the market averages" (2013-10-03).
"The stock's decline during the U-portion should be no more than 30% or 35%."
([IBD, 2014-02-06](https://finance.yahoo.com/news/identify-good-qualities-cup-handle-233000441.html))

**3.1.5 The handle.**
- Position: "A proper handle forms in the upper half of a base and drifts slightly downward along its price lows."
  (2015-02-18) "First, a good handle forms in the upper half of the base." (2015-09-24) The measured version: "In the
  handle, the midpoint of the handle's high and low marks should be above the midpoint of the high and low of the left
  side of the cup" (2015-09-11). "Handles that form too low present added risk of failure during breakouts." (2015-09-11)
- Moving average: "Second, a handle should generally form above the 50-day or 10-week moving averages." (2015-09-24)
- Length: "Handles must be at least five days long, and typically last for several weeks." (2015-09-11) "It should also
  last more than one or two weeks. If it's shorter than five days, it's not a handle." (2015-09-24; "It" is the handle,
  from the sentence before.) So five days is IBD's floor, and more than one or two weeks its preference.
- Depth: "the stock makes a secondary decline, usually no more than 8% to 12%." (2014-02-06; a linked word just before
  this was dropped by Yahoo's copy, so the sentence's opening is not quoted.)
- Drift: "Then it began to form a handle with an upward drift, a negative." (2013-09-25) "If you spot a stock with an
  upwardly wedging handle, beware." "Stocks with wedging handles have a higher failure rate and often are seen in
  late-stage bases, the bases of laggard stocks or the bases of very active leaders that have become too widely
  followed." (2015-09-24) "Overeager handles that wedge upward tend to fail, while handles that drift lower foreshadow
  assertive action." "A wedging handle with no shakeouts is a sign to steer clear." (2015-02-25)
- Volume and tightness: "Volume should mostly ease until the breakout." (2015-02-18) "Volume should dry up, evidence that
  the weak holders are just about gone." (2015-09-24) "Handles should have areas of tight trading and days or weeks where
  volume contracts sharply." (2015-02-25)

**3.1.6 The buy point.** "The buy point is located by taking the highest price in the handle and adding 10 cents."
(2014-02-06) "Mark the buy point by adding a dime to the left-side high mark of the handle." (2015-09-11) For a cup with
no handle, the buy point "is 10 cents above the left-side high of the base" (2013-10-03; the subject word was dropped by
Yahoo's copy), and IBD accepts it especially "if the stock takes out the left-side high in heavy trade" (same column).
Buy zone: "Ideally, the stock will quickly clear the 5% buy zone and create a cushion of gains." (2014-11-04)

**3.1.7 Breakout volume.** "it should be at least 40% to 50% above average when shares rise past the proper buy point."
(2014-02-06; the subject word before "it" was dropped by Yahoo's copy; the column is talking about breakout volume.)
IBD bent its own line once: a breakout that "cleared that buy point on a barely sufficient 38% increase in volume"
(2013-09-25).

**3.1.8 Stop, profit-taking, base count.**
- Stop: "the rule says to sell all your shares of a stock if it falls 7% or 8% below the price at which you bought it."
  In a weak market, the same column says to consider cutting losses "at even less", naming 4%. Its reason: "Research has
  shown that leading stocks, when purchased at the proper buy point, rarely fall more than 8% from their entries."
  ([IBD, 2014-09-10](https://finance.yahoo.com/news/why-cutting-stock-losses-short-211000887.html)) Also: "Get out if a
  stock drops 8% below your buy point." (2014-11-04)
- Profits: "Once your stock has broken out, take most of your profits when they reach 20% to 25%." The exception, for a
  stock that runs up 20% or more within one to three weeks of the breakout: "Hold it for at least eight weeks to see if it
  can be held for a bigger long-term gain." (2015-06-30)
- Base count: "It's usually best to buy when a stock breaks out from a first-stage or second-stage base." "Breakouts from
  late-stage bases will often blow up." ([IBD, 2015-06-16](https://finance.yahoo.com/news/why-stage-patterns-often-lead-215800864.html))
- Stock quality: "check for recent excessive stock splits or share offerings that might dilute the stock's value."
  (2013-02-04)

**3.1.9 investors.com, free lines only.** "Everything You Need To Know About Handles In Bases" (Michael Molinski,
updated 2022-04-14): "A good cup with handle should truly look like the silhouette of a nicely formed tea cup." "How To
Buy Stocks: Everything You Need To Know About Handles In Bases" (Kimberley Koenig and David Saito-Chung, published
2024-01-02, updated 2026-05-13): "A handle defines the proper entry." The next sentence starts "The highest price in the
handle plus 10 cents" and is cut off by the paywall. "Recognize The Proper—And Improper—Cup With Handle" (Donald H.
Gold, published 2013-09-13, updated 2016-02-05) shows its first lines: "The cup-with-handle base is the most commonly
found of all the recognized base patterns. It's the classic." The rest is behind the paywall.

### 3.2 Dan Zanger (originator of his own version; chartpattern.com)

Saved copy of [chartpattern.com/cup-handle.cfm](https://www.chartpattern.com/cup-handle.cfm) (undated; footer
"Copyright © 1998 - 2026 Daniel J. Zanger"; the footer also says "Do not duplicate or redistribute in any form.", so
only short quotes are used here).
- What it is: "The Cup & Handle is the corrective action after a powerful stock advance."
- Prior move: "Generally a stock will have a powerful move of some 2 to 4 months, then go through a market correction."
- Depth: "The stock will sell off into the correction in a downward fashion for maybe 20 to 35 percent off the old high
  point."
- Cup length: "The time factor is generally anywhere from 8 to 12 weeks depending on the overall market condition."
- Handle: drift "in a sideways fashion with a bias to the downside for about 4 days to 3 weeks." "The handle is
  generally about 5% below the old high point. A handle that is any lower is generally a defective stock and contains
  higher risk for failure." (His 5% is measured from the old high, not from the handle's own high, so it is a position
  as much as a depth.)
- Buy: "The time to buy the stock, is as it emerges into new highs at the top of the handle and not the old high point
  set some 8 to 12 weeks ago."
- Market: "the best stocks with this formation are found at the beginning of a market move after a good market
  correction, and not during, or at the end of a major market advance."
- His view of it: "It is one of the best and most reliable formations to look for."
- Volume: in an article by Zanger on traderslog.com (the page's metadata says published 2018-12-03; a figure caption
  reads "ZVR Final – May 12, 2016", so the text may be older): "Volume matters on breakouts (or breakdowns) from a
  consolidation like a bull flag or cup and handle pattern." And: "When a fast moving stock rises on 200% of its average
  daily volume for example, I make sure it's on my watchlist!" His indicator is the "Zanger Volume Ratio (ZVR)"
  ([traderslog.com](https://www.traderslog.com/?p=27578), which redirects to /using-volume).
- No stop rule on the cup page.

### 3.3 Mark Minervini (originator of the 3-C and VCP)

His books (*Trade Like a Stock Market Wizard*, *Think & Trade Like a Champion*) were **not read**; I found no legal
readable copy. His own posts on X, read through X's public embed service:
- "My textbook $AAPL buy.  Classic Cup Completion Cheat entry, or what I call a 3-C." (2020-06-21,
  [x.com](https://x.com/markminervini/status/1274498666561187841))
- "It's a VCP, but not a 3-C.  The "cheat" area develops in the lower to middle third of the base. This is a handle in
  the upper third." (2020-05-13, [x.com](https://x.com/markminervini/status/1260379646165749762))
- "VCP - Volatility Contraction Pattern is not a separate pattern from a cup with handle, power play, inverse H&S, double
  bottom, cup completion cheat (3-C), etc... it's a characteristic of the patterns." (2020-07-21,
  [x.com](https://x.com/markminervini/status/1285646150733836293))
- "There's a little more to finding a stock under accumulation poised to breakout than just buying any name with a chart
  that resembles a cup with handle or VCP pattern." (2019-10-28, [x.com](https://x.com/markminervini/status/1188910654570356737))
- "Yes. Low cheat entries can be up to 8% below the 50 day." (2020-04-27, a reply; the question it answers was not
  visible, [x.com](https://x.com/markminervini/status/1254914208510218241))

What this adds: Minervini separates the "cheat" (an earlier buy that develops in the lower to middle third of the base)
from a handle, which in the 2020-05-13 post sits "in the upper third". That post describes one chart; it is not a stated
rule that every handle must be in the upper third, and I found no post that states one.

Not used: `api/services/screener/base_catalog.py` carries wording for the 3-C attributed to Minervini's book (source id
`minervini_ttlac_3c`: prior advance, 3 to 45 weeks, a 5% to 10% plateau, recouping a third to a half of the decline).
I could not check it against the book, so none of it is quoted or relied on here. It is a lead for whoever reads the book.

### 3.4 Thomas Bulkowski (thepatternsite.com; measured statistics)

**Notice:** Bulkowski's copyright notice says: "This website, in whole or in part, shall not be used to train
artificial intelligence (AI) systems," and goes on to name large language models and similar systems. The same notice
is on his glossary page. I read and cite it here with links and short quotes only, as allowed for this dossier, and flag the notice.
Page: [thepatternsite.com/cup.html](https://thepatternsite.com/cup.html) (updated 7/25/25 per the page).
- "Price rises into the start of the cup, but I don't pay much attention to this guideline."
- "The cup should be U-shaped, not V-shaped, but allow variations."
- Cup duration: "From 7 to 65 weeks (allow variations)."
- "The cup must have a handle on the right." Handle: "1 week minimum with no maximum, forming in the upper half of the
  cup."
- "Cup rims should be near the same price level but be flexible."
- Entry: "buy when price closes above the right cup rim (point A, and the top horizontal red line)." Early entry: "If
  possible, draw a down-sloping trendline along the handle peaks. A close above the trendline signals an early buy."
- Stop: "The handle low (point C) is a good place to put a stop. Raise the stop as price rises."
- Target: measure the cup's height from the right lip to the low and "multiply by the above 'percentage meeting price
  target.'" (61%), then add it to the breakout price.
- "Cups often form within cups (points 1 and 2), so trade the inner cup when price rises above the handle"
- "Throwbacks hurt performance."
- No volume rule.

### 3.5 StockCharts ChartSchool (established educator)

Saved copy of [ChartSchool: Cup With Handle](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns/cup-with-handle)
(the page's "Last updated" stamp is 2024-06-10; later timestamps in the page source are site metadata).
- "A V-shaped bottom would be considered too sharp of a reversal to qualify."
- Depth, measured against the prior advance, not the old high: "Ideally, the depth of the cup should retrace 1/3 or less
  of the previous advance." It allows 1/3 to 1/2 in volatile markets and up to 2/3 in extreme cases.
- Handle: "can retrace up to 1/3 of the cup's advance, but usually not more."
- "The cup can last from one to six months, sometimes longer on weekly charts. The handle can last from one week to many
  weeks and is ideally completed within one to four weeks."
- "There should be a substantial increase in volume on the breakout above the handle's resistance."
- Target: "measuring the distance from the right peak of the cup to the bottom of the cup."
- Prior trend: "Ideally, the trend should be a few months old." The FAQ says: "The trend should only be a couple of
  months old."
- "As with most chart patterns, capturing the pattern's essence is more important than the particulars."

### 3.6 AAII (Wayne A. Thorp, educator)

[AAII Journal, August 2001](https://www.aaii.com/journal/article/predicting-short-term-trends-the-cup-with-handle-pattern):
"there must be a trend in place to continue"; "The typical cup-with-handle chart pattern forms over three to six
months; the pattern can be up to 12 months in length during bear markets and as short as one month during bull
markets"; depth "ideally, the price should not retreat more than one-third from this
high." ("this high" is "the high that set the left side of the cup"); handle "Typically, the handle will form over a
period of about one to four weeks"; "the retracement that forms the handle should not be more than one-third of the
cup's depth, but at most, one-half"; position: "the handle should not extend into the lower half of the cup."; "The
breakout takes place when the price exceeds the highs of the left and right sides of the cup"; "most use the closing
price as the relevant price value"; "At breakout, the minimum volume typically looked for is that which is 50% above the
50-day average volume." No stop rule.

[AAII Journal, December 2015](https://www.aaii.com/journal/article/the-cup-with-handle-pattern): "prices should have
advanced at least 30% from the last intermediate low."; the trend ideally "a few months old, but not too mature."; the
handle falls "into the upper half or third of the cup."; "The handle, ideally, completes within one to four weeks." Its
depth rules follow the StockCharts wording (a fraction of the prior advance). No stop rule. Both AAII pages are member
pages; the rule sections were visible.

### 3.7 Pradeep Bonde (Stockbee), summarising O'Neil

[Stockbee, 2011-12-13](https://stockbee.blogspot.com/2011/12/william-oneil-setups.html): "Most commonly found setup in
stocks with momentum/growth". "For each element of the setup O'Neil has detailed guidelines. For example the first leg
should be up at least 30%." And: "During that period stock should have improved its relative strength v/s market and
should have substantial volume increase during the move compared to its average 50 day volume."

### 3.8 Not read, or nothing on the cup

- O'Neil, *How to Make Money in Stocks* (any edition): not read (see section 2).
- Minervini's books: not read.
- Bulkowski, *Encyclopedia of Chart Patterns*: not read. A copy of its cup chapter is posted on a forum site; it looks
  unauthorised, so I did not use it.
- Gregory Kuhn, "The Cup-with-Handle Pattern", *Technical Analysis of Stocks & Commodities* V.13:3 (pp. 107-111, per
  the publisher's store listing): paywalled, not read. His follow-up, "Trading with the Cup-with-Handle", V.13:07
  (pp. 292-297), also not read.
- Morales and Kacher, *Trade Like an O'Neil Disciple*: not read.
- TraderLion (403), MarketSmith India blog (no DNS answer), Investopedia (402): could not be read.
- Kristjan Kullamägi's "3 timeless setups" post (read): the words "cup" and "handle" do not appear in it.

### 3.9 Comparison table

| Source | Prior trend | Cup length | Cup depth | Shape | Handle length | Handle depth | Handle position | Volume | Averages | Trigger / entry | Stop | Target |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **IBD / O'Neil** | run-up of 30%+ | 7 to 65 weeks incl. handle (6 weeks in one column); most 3 to 6 months | 12% to 33%; up to 35%; 50% in bear markets; 1.5x to 2.5x the market's drop | smooth U, symmetric, no 10-15% weekly swings | 5 days minimum; should last more than 1 or 2 weeks; "several weeks" typical | usually 8% to 12% | upper half; handle midpoint above cup midpoint | eases in the base, dries up in the handle; breakout 40% to 50% above average | handle above the 50-day / 10-week line | highest price in the handle + $0.10; buy zone 5% | 7% to 8% below cost (4% in a weak market) | sell most at 20% to 25%; hold 8 weeks if up 20% in 1-3 weeks |
| **Zanger** | powerful 2 to 4 month move | 8 to 12 weeks | 20% to 35% | not stated | 4 days to 3 weeks | about 5% below the old high | near the old high | breakouts need volume (ZVR) | not stated | as it emerges to new highs at the top of the handle | not stated | not stated |
| **Minervini** | not in posts read | not in posts read | not in posts read | VCP traits | not in posts read | not in posts read | cheat in the lower to middle third; one post calls a handle in the upper third a handle (one chart, not a stated rule) | not in posts read | low cheat can be up to 8% under the 50-day (reply) | 3-C cheat as an earlier buy | not in posts read | not in posts read |
| **Bulkowski** | rise into the cup (little weight) | 7 to 65 weeks | not stated | U not V | 1 week minimum, no maximum; under 22 days did better | not stated | upper half of the cup | not stated | not stated | close above the right rim; early: close above a handle trendline | the handle low | 61% of cup height added to the breakout |
| **StockCharts** | trend a few months old (FAQ: a couple of months) | 1 to 6 months | 1/3 of the prior advance (to 1/2, extreme 2/3) | U not V | 1 week to many; ideally 1 to 4 weeks | up to 1/3 of the cup's advance | not stated | substantial rise on the breakout | not stated | break above handle resistance | not stated | cup height |
| **AAII 2001** | a trend to continue | 3 to 6 months (1 month in bull markets to 12 in bear markets) | ideally under 1/3 from the left-side high | rounded U | 1 to 4 weeks | under 1/3 of cup depth, at most 1/2 | not into the lower half | breakout 50% above the 50-day average | not stated | price above both rims, often on the close | not stated | cup height |
| **AAII 2015** | 30%+ from the last intermediate low | 1 to 6 months | as StockCharts | U not V | 1 to 4 weeks | up to 1/3 of the cup's advance | upper half or third | substantial rise on the breakout | not stated | break above the cup highs | not stated | cup height |
| **Stockbee (on O'Neil)** | first leg up 30%+, RS rising, volume up | not stated | not stated | not stated | not stated | not stated | not stated | heavy on the first leg | not stated | not stated | not stated | not stated |

### 3.10 Where the sources disagree

1. **Depth: from the high or from the advance?** IBD, Zanger and AAII 2001 measure the fall from the old high (12% to
   35%). StockCharts and AAII 2015 measure it as a share of the prior advance (a third). These are different numbers on
   the same chart.
2. **Depth ceiling.** IBD alone gives 33%, 35% and "30% or 35%" in different columns, plus 50% in bear markets. Zanger
   says 20% to 35%.
3. **Cup length.** IBD: 7 to 65 weeks (one column says 6). Zanger: 8 to 12 weeks. StockCharts: 1 to 6 months. AAII
   2001: 3 to 6 months typical, from one month in bull markets to 12 in bear markets.
4. **Handle depth.** IBD: usually 8% to 12%. Zanger: about 5% below the old high. AAII 2001: a third of the cup's depth,
   at most half. StockCharts: up to a third of the cup's advance. On a 30% cup, AAII allows 10% to 15%; Zanger about 5%.
5. **Handle position.** IBD and Bulkowski: upper half. AAII 2001: not into the lower half. AAII 2015: upper half or
   third. Minervini (one post): a handle sits in the upper third, the cheat lower; not stated as a rule.
6. **Handle length.** IBD: at least 5 days, and "more than one or two weeks". Bulkowski: at least 1 week, no maximum,
   shorter than his 22-day median did better. Zanger: 4 days to 3 weeks. AAII and StockCharts: 1 to 4 weeks.
7. **Trigger.** IBD and Zanger buy as price trades through the handle high (IBD adds 10 cents). Bulkowski and AAII use a
   close above the right rim or cup highs, which can be a higher level and a later moment.
8. **Volume baseline.** IBD: 40% to 50% above average. AAII: 50% above the 50-day average. IBD itself once called 38%
   "barely sufficient".
9. **Stop.** IBD: 7% to 8% below cost. Bulkowski: the handle low. Zanger, StockCharts and AAII give none.
10. **Exit.** IBD: most profit at 20% to 25%. Bulkowski: 61% of the cup's height. StockCharts and AAII: the full cup
    height.
11. **Early entries.** Minervini (3-C) and Bulkowski (handle trendline) buy before the pivot. IBD's handle articles
    buy at the pivot.

---

## 4. Measured evidence

**Bulkowski, "Cup with Handle: Important Bull Market Results"** (the page's heading; it does not say "upward
breakouts" there) ([cup.html](https://thepatternsite.com/cup.html)):
"Overall performance rank (1 is best): 3 out of 39"; "Break even failure rate: 5%"; "Average rise: 54%"; "Throwback
rate: 62%"; "Percentage meeting price target: 61%"; "The above numbers are based on 913 _perfect_ trades."

How he measures ([glossary](https://thepatternsite.com/glossary.html)):
- Break-even failure: "A measure of the number of patterns that fail to rise (upward breakout) or decline (downward
  breakout) by at least 5%."
- Average rise: "The average rise/decline measures from the opening price the day after the breakout to the ultimate high
  or ultimate low."
- Ultimate high: "The highest peak before price declines by at least 20%, measured from the high to the close."
- Throwback: "Price breaks out upward, climbs, and then returns to the breakout price within 30 days."

Limits:
- "Perfect" is not defined on the glossary page; the cup page sends readers there.
- The average rise runs to the ultimate high, the best possible exit in hindsight. No trader gets it.
- The page gives no date range for the 913 trades and no comparison against all stocks over the same period.
- His identification rules are looser than IBD's (no depth limit, no prior-trend requirement in practice).
- A 5% failure rate means only "did not rise 5%". It does not mean 95% of trades make money with a real stop.

**Bulkowski's own warning on the same page:** "I looked at 300 cup with handle patterns, stretching from 1990 to March
2024." "I found that 47% of the cup with handle patterns dropped substantially within two months of the breakout."
"Almost a quarter (23%) of cup with handles see price rise no more than 15% before dropping." And: "Stocks with handles
shorter than the median 22 days show superior post breakout performance."

**Bulkowski on fixed holding periods** ([BestPatterns.html](https://thepatternsite.com/BestPatterns.html)): "I scanned
my database of chart patterns (the popular ones) and found over 30,000 samples." "Then I measured the price move 1, 2, 3
and 6 months after the breakout." "Notice that the cup with handle doesn't appear in the list." "That's because
performance is poor -- it ranked 11th, so it didn't make the top 10." The page carries a "Note as of 9/20/21": "The
following statistics have not been updated with more recent information, so they are outdated." No cup numbers are
given, and the page does not say which horizon the "11th" refers to; it says its table ("upward breakouts (top half)
and downward breakouts (bottom half)") is sorted by the two-month performance column. So the same author ranks the cup 3rd of 39 on the hindsight measure and 11th in a table of fixed
holding periods (sorted by two-month performance).

**Bulkowski, inverted cup with handle (the short mirror), bull market** ([icup.html](https://thepatternsite.com/icup.html)):
"Overall performance rank (1 is best): 6 out of 36"; "Break even failure rate: 18%"; "Average decline: 17%"; "Pullback
rate: 67%"; "Percentage meeting price target: 62%"; "The above numbers are based on 556 perfect trades in a bull market."

**IBD.** IBD publishes no win rate, average gain or failure rate for the cup in anything I read. Its numbers are claims
without data: "IBD research on market winners going back to 1880 shows stocks that form correctly shaped bases" have the
best odds (2013-02-04), and "Research has shown that leading stocks, when purchased at the proper buy point, rarely fall
more than 8% from their entries." (2014-09-10). Its examples are single stocks.

**Academic work.** I found no peer-reviewed study of the cup with handle. Vendor and blog "win rates" (for example 85%
or 95%) name no study and are not used here.

**Our own app.** A comment in `api/services/screener/base_catalog.py` records that "`cup_handle_uct` shipped green and
fires on 2 of 2,890 symbols". That is a coverage count, not a performance figure. No cup performance has been measured on
our data. That would be the most useful statistic for the course (question 13).

---

## 5. Our app

### 5.1 What `cup_handle_uct.py` tests

File: `api/services/pattern_engine/detectors/uct/cup_handle_uct.py` ("Cup with Handle (UCT Strict)"). Bars are daily.
All tests are hard gates unless marked "scored".
1. **Context, at the last bar** (from `primitives/context.py`): `trend_stage == 2` (the last close is above the
   150-day SMA, and the last close is more than 2% above the close 49 bars earlier: `_slope_sign(closes, 50)` measures
   the price, not the average; with fewer than 200 bars it uses the 50-day SMA and a 20-bar window) and
   `ma_alignment == "stacked_bullish"` (close > 10-day > 20-day > 50-day > 200-day SMA; the 200-day is skipped when
   fewer than 200 bars exist).
2. **Rims:** two swing highs (3 bars each side) among the last 12 swing highs. The right rim may be at most 40 bars old.
   Rims within 5% of each other.
3. **Cup length:** 30 to 65 daily bars between the rims.
4. **Cup depth:** 12% to 35% from the left rim to the lowest low between the rims.
5. **Shape:** a fitted parabola through the closes must open upward, and at least 30% of the cup's bars must have their
   low in the bottom quarter of the cup (a U, not a V). Smoothness is scored.
6. **Handle:** the bars after the right rim, at most 15, at least 5. Handle low above the cup's midpoint. Handle depth,
   measured from the right rim, at least 2% and at most half the cup's depth. The handle's low must not be in the last
   30% of the handle window.
7. **Not yet broken out:** no two closes in a row above the right rim.
8. **Prior advance:** at least 30% from the lowest low of the 60 bars before the left rim up to the left rim.
9. **Volume:** handle average volume at most 0.70 of the cup's average volume.
10. **Score:** 40% geometry, 25% volume, 20% context, 15% a fixed 50. Must reach 50. Bonuses for rising "rs_trend",
    accumulation by close location, and a CAN SLIM grade.

Levels it returns: entry = the higher of the right rim and the handle high, times 1.001; **stop = handle low × 0.985**
("handle_low_minus_1.5pct"); target = right rim + the cup's depth in dollars; entry condition text
"close > {entry} on volume > 1.5x 20-bar avg". Its names: the detection's `pattern_name` is "Cup with Handle (UCT
Strict)", the patterns router lists it as "Cup-with-Handle (UCT Strict)", the vision rubric labels it "Cup with Handle",
and `setupTagMap.js` maps it to the Model Book's "Cup & Handle".

### 5.2 I ran it on synthetic bars

Script in the session scratchpad (`probe_cup2.py`), using the repo's own code, read-only. A 220-bar slow base, a 60-bar
+60% run, a smooth 25%-deep cup, and a 10-bar handle (6 bars down 6%, 4 bars back up 3%). With the context forced to
Stage 2 and stacked:
- Cups of 30 to 65 bars fire. **Cups of 66, 70, 90 and 130 bars do not.**
- Entry 95.87, stop 87.97: an **8.2% stop** for a 6.75% handle.
- A 30%-deep cup with a 14.7% handle fires, with a **16.1% stop**.
- Cup, handle, then 20 more bars falling 10%: it still fires, with the last close (83.12) already below its own stop
  (87.97). With the real context it does not fire, because the moving-average gate fails. The handle window simply
  never looks at bars after its first 15.
- With the real context computed from the bars, only the 30-bar cup fired. In the 40-bar case the stage gate said no
  (the context read Stage 3); in the 50 to 65-bar cases the stacked gate said no (the close sat below the 10-day or
  20-day average during the handle). (Re-run in checking: same numbers.)

### 5.3 What looks wrong

1. **The cup can be at most 13 weeks long.** The 65-bar cap is in daily bars. IBD's range is 7 to 65 **weeks**, and
   "Most outstanding cup patterns will last between three and six months." The scanner cannot see most of the cups IBD
   calls best. This may be weeks read as days; the code does not say.
2. **The stacked gate is stricter than any source.** IBD asks for the handle above the 50-day or 10-week line. The
   scanner asks the last close to be above the 10-day, which a handle dipping on light volume often is not. Together
   with item 1, this likely helps explain "fires on 2 of 2,890 symbols" (not measured; the probe in 5.2 only shows the
   mechanism).
3. **Handle depth is not capped at IBD's 8% to 12%.** Half of a 35% cup allows a 17.5% handle.
4. **The stop is far wider than the house stop** (section 7). Handle low minus 1.5% gave 8.2% and 16.1% in the probe.
5. **Bars after the 15-bar handle window are not checked.** A drop below the handle low there is not seen. The
   moving-average gate usually hides this, but the rule itself is wrong.
6. **Dead code.** The check `if handle_bars_count > _MAX_HANDLE_BARS` (reject a handle over 15 bars) can never be
   true, because the window is already cut at 15.
7. **The handle-low position test may reject good handles.** IBD praises a late shakeout ("prior lows in the handle are
   undercut"). The scanner rejects a handle whose low is in its last 30%.
8. **No wedging test.** IBD warns against handles that wedge up; the scanner does not check the slope of the handle's
   lows. (The screener's cup, 5.4, does.)
9. **"rs_trend" is not relative strength.** `context.py` says it is "Simplified to absolute trend (no SPY comparison in
   Phase 0)". The narrative still calls it "relative strength versus the broader market". House rule C31 wants RS 80+.
10. **The trigger is a close on 1.5x the 20-day volume.** IBD and Zanger buy as price trades through the pivot; the
    house buys with a market order (E57). IBD's volume line is 40% to 50% above average, on a 50-day base in AAII's
    version.
11. **The target.** Right rim + full cup depth. Bulkowski found only 61% reach the full measure, and the narrative calls
    it "conservative".
12. **Unsourced or wrong claims in the narrative text** (members read these):
    - Zanger "calls the cup-with-handle 'the highest-edge setup in growth stocks'". Not found on his site, which says
      "It is one of the best and most reliable formations to look for."
    - Zanger "specifically uses the Zanger Volume Indicator to time the breakout". His indicator is the "Zanger Volume
      Ratio"; I found no source for the trigger described.
    - Zanger's "1999-2000 record-setting returns were built almost entirely on this single pattern". No source found.
      His traderslog bio says only that he earned his record "by parlaying $11,000 into $18 million during an 18 month
      period"; it credits no single pattern.
    - "cups that are 18-28% deep over 30-50 bars produce the highest follow-through ratios in CAN SLIM historical
      studies". No source found.
    - "O'Neil teaches that clean cup-handle stops average 5-8% from the pivot". IBD's rule is a 7% to 8% maximum loss
      from cost, not an average stop.
    - "preceded the great winners of every market cycle since the 1960s". IBD's own claim is research "going back to
      1880".
    - "strong UCT cup-handles frequently extend 1.5x to 3x this projection over the 8-16 weeks". No source found.
    - The docstring: the UCT variant "catches only the patterns that historically deliver 25%+ moves". Never measured.
    - "The pattern's edge depends on the breakout working within 1-7 bars". No source found.

### 5.4 The app's other cup scanners

- **`detectors/classical/cup_handle.py`** (generic): cup 30 to 120 bars, depth 12% to 50%, handle 5 to 25 bars, no
  prior-advance gate; context is scored, not required. Stop: handle low minus 1%.
- **The screener's base catalog** (`screener/base_catalog.py` with `pattern_engine/primitives/cup.py`, id
  `bc:cup-with-handle`; its provenance is listed by the paid `/api/screener/structures` route, but its chart drawing was
  **withdrawn from members on 2026-10-24** by owner decision after a blind recertification scored it 1.98 against a 2.3
  bar on 20 charts: `auto_structures.py`, `MEMBER_CUP_TIER_ROUND = None`; admins still see it): the closest to IBD.
  Cup 35 to 325 bars (7 to 65 weeks); depth 12% to 33%; handle 5 to 25 bars (tested in steps of 5) ending at the last
  bar; handle at most 12% from its own high; the handle's lows must slope down; handle low above the cup's midpoint;
  handle high within 15% of the left rim; rims within about 3%; a minimum roundness (0.10 on its own scale); prior
  advance 30% within 120 bars (from the lowest low to the close at the cup's start); handle volume below the cup's
  average; pivot = handle high + $0.10. It sets no stop, no RS test and no 200-day test. Its code labels the 12% and 15% numbers `confidence="med"`
  from an "IBD handout, provenance unverified"; the 12% now has a verified IBD source (3.1.5, "8% to 12%"). The 15% does
  not. Two of its comments are now contradicted by IBD columns read here: "IBD publishes NO minimum handle length"
  (`cup.py`) and "No IBD source states a minimum handle duration" (`base_catalog.py`), against IBD's "Handles must be at
  least five days long" (2015-09-11) and "If it's shorter than five days, it's not a handle." (2015-09-24).
- **The cup tier** (`pattern_engine/cup_tier.py`), a display stamp on `bc:cup-with-handle` rows that scores the cup
  against a reference cup path (prior advance 30%+, cup 3 to 65 weeks, depth 12% to 55% in its envelope). Display only;
  it changes nothing the detector fires on, and it is the drawing that was withdrawn from members above.
- **Chart IQ** (`chart_iq/engine/v3_bases.py`), which built the Study bank's cup items. Its rule, as the bank's lesson
  text states it: "a U-shaped cup at least 30 sessions long and 15% to 50% deep, its low in the middle of the base and
  price recovering at least 60% of the way back, then a handle of 3 or more sessions, no deeper than 15%, in the upper
  half of the cup." No prior-advance test and no volume test. Its only trend filter (`downtrend()`) skips a stock that
  is under its 50-day and under a falling 200-day, or under a falling 50-day and under its 200-day, so a stock under its
  200-day can still pass. "Upper half" is tested on the right rim, not the handle low.
- **The vision rubric** (`pattern_vision/rubrics.py`) asks for a rounded U, a short drift lower after the right side
  recovers, the handle in the upper half and lighter volume in the handle. That matches IBD.

### 5.5 The Study bank, the Model Book card, the journal and the plans

- **Study bank** (`docs/study/bank/chart.bases.json`): **100 "Cup with handle" items, all in draft.** Measured from
  their stored facts: 40 have a handle shorter than 5 sessions (of the 95 whose handle length is recorded; 5 more read
  only "cup from the rim") (IBD: "If it's shorter than five days, it's not a handle."); 20 were below their 200-day at
  the breakout (house rule B26 is a hard rule); 9 are deeper than 33% and 7
  deeper than 35%; 5 are shorter than 35 sessions. They should not go live as cup examples without a re-check.
- **Model Book card** (`app/src/pages/modelbook/setupCatalog.js`): long only, family "Bases & Breakouts", glyph with the
  20 and 50-day lines and a pivot marked on the high of the last up candle before the two handle candles. Its words: "A rounded, multi-week base (the cup) recovers to its
  prior high, then drifts into a shallow, low-volume pullback (the handle)" and "the breakout above the handle high
  resumes the advance." This agrees with IBD.
- **Journal tags** (`app/src/constants/setupGroups.js`): no cup tag in the trade-labelling list. "Cup & Handle" exists
  as a tag only through the Model Book catalog (`setupTagMap.js`).
- **Study plans:** unit SET.09 (`docs/study/UNITS-method.md`) is planned on `cup_handle_uct` and notes it "fires on 2 of
  2,890 symbols". `docs/study/TRADE_PLANS.md` and `api/services/study_trade.py` have **no plan for the cup**.
- **Owner rulings:** none on the cup in `owner_verdicts.jsonl`. One ruling bears on it: on a launchpad candidate he said
  "Some of these will crossover with BaseBreakouts btw and that is fine".

---

## 6. UCT's own words

All from [unchartedterritoryy.substack.com](https://unchartedterritoryy.substack.com). I searched all 103 posts in the
sitemap (one is subscriber-only; its public part was searched). The word "cup" appears in the body of 39 of them (count
re-made in checking; the first draft said "about 45"), almost always as chart commentary. **No UCT post defines the setup's rules.** What follows is how UCT uses it.

### 6.1 TSDR (the owner's sections)

- BTSG (weekly), 2025-06-08: "3 weeks tight under the cup and handle pivot. $24.80 confirms Cup and Handle breakout and
  sends this into $30s. Ideally would love a 20 ema shakeout." ([post](https://unchartedterritoryy.substack.com/p/sunday-scans);
  the note sits under "BTSG (Weekly)", right after a PTON note; the first draft named PTON)
- BWXT, 2026-02-04: "Cup and handle forming with $220 as the pivot. Offering a mid range cheat entry here mid week. Might
  need a bit more time for weekly 9ema to catch up but think 205 good area to risk against."
  ([post](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-732))
- SOLS, 2026-04-14: "Now this little cup and handle forming here on the right side. Any strength above $85 likely rallies
  to $100. Want to see $75 hold or a minimum $72." And: "All it did was drift sideways and tapped the 50SMA while the QQQ
  lived below the 200SMA." ([post](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-c4d))
- ASML, 2025-11-30: "Cup and Handle on weekly with $1100 as the pivot for that. Moving average launchpad sitting right at
  $1,000, any pullbacks and area to risk off is worthy of a slap." ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-422))
- IREN, 2025-10-26: "Ideally gives us some sideways wiggle here or maybe mini cup and handle ish pattern at highs. Buying
  those shakeouts is the optimal RR." ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-13e))
- APLD, 2025-08-10: "Daily is ready to go for another leg and will be stalking to hourly timeframe for low risk entry
  spots." "Preferably get a gap down red to green move to show presence of buyers and clear area to risk against."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-f6f))
- ANET, 2025-08-24: "Inside day would be awesome to avoid wedging up behavior. Weekly may need some more consolidation to
  form classic handle pattern." ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-ffa))
- RDDT, 2025-09-01: "Weekly cup and handle coming into 3rd week of handle slightly off highs. All good things."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-4d1))
- MSOS, 2025-10-15: "we have double inside days within this flag and cup and handle build out here. The volume up the
  ride side of this move is impressive." ([post](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-39d))
- BIDU, 2026-01-11: "Has a chance to set up a cup and handle where if we break highs it can push another $40-$50."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-0b3))
- NBIS, 2026-03-22: "Bit of a cup and handle look here especially on the weekly. I expect $108 and $112 zone to hold and
  establish strong support." ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-cab))
- UMAC, 2026-08-23: "Cup and handle look on daily, a little loose but has a chance to base and build here against
  $25-$30 zone. Let it build and base, not a primary focus just observing."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-807))
- ANET, 2026-04-19: "A handle here would be ideal. Has been a leader of the entire bull run for years now."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-33a))
- CRCL, 2025-06-15: "would want to see an hourly handle or flag form here under IPO highs."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-744))
- RBRK, 2026-08-16: "For CANSLIM checks all the boxes." ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-da5))

### 6.2 Bracco

- ETH, 2025-07-27: "It is currently trying to emerge out of what appears to be a 4+ year long cup and handle base. The
  yellow line represents the lifetime anchored VWAP, which this supported at on the shakeout within the handle in April."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-63b))
- ETH, 2025-08-03: "If this can build out a new range/handle above $3,000 this looks like one of the better home run
  ideas into the end of the year. A push through $4,100 would trigger a massive 4+ year cup and handle breakout."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-726))
- RTY futures, 2025-08-17: "we potentially have a massive 4-year cup and handle base with a shakeout in the handle,
  similar to the ETH monthly chart we looked at a few weeks ago." ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-644))
- Leaders, 2025-10-26: "Could result in some nice short term cup with handle type patterns."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-13e))
- SIDU, 2026-04-12: "A handle below this $5 level would be textbook." ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-a43))
  Note: a $5 stock fails house rule B23 ($10 minimum).

### 6.3 Unsigned sections (index and ETF notes, openings)

- XLV, 2025-11-23: "The weekly is nearing it's ATHs from Sept 2024 at $160 where it either handles out or becomes a
  powerful cup without handle breakout." ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-56d))
- XLV, 2026-02-22: "Tightening up in Cup and Handle formation on the weekly. Taking a long time I do not like that and I
  would prefer to see a proliferation of setups within the group at the moment that are already leading."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-04c))
- ARKK, 2025-06-29: "Would be ideal on the weekly timeframe to see that classic cup and handle form out."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-d70))
- ITA, 2026-01-11: "Cup and Handle breakout with follow through from Friday's massive candle."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-0b3))
- XRT, 2026-01-11 (same post, added in checking): "Some volatility around the Cup and Handle breakout spot just below
  $90."
- IWM (weekly), 2025-11-23 (added in checking): "as long as $230 and $233 support this can still be viewed as tightening
  and consolidation on the 3rd tap of a breakout level. Cup and handle ish if you will."
  ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-56d))
- Opening essay, 2025-11-09: "Yes, the M in Canslim is critical. But that is not measured on a day to day or even week to
  week basis. It is a weight of the evidence." ([post](https://unchartedterritoryy.substack.com/p/sunday-scans-720))
- "Thoughts on the Market", 2026-01-07: "Nothing matters but your thesis and your stop. If you have an idea but no where
  to indicate you are wrong then you do not have a trade." ([post](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-3f0))

### 6.4 Contributors (lower weight; not the house voice)

- ChartMaster, LDOS, 2025-11-05: "Weekly cup and handle at ATH's. Put in a new ATH today on Earnings Beat and Raise. Daily
  showing a neat little handle testing resistance." ([post](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9))
- Manrav, TMDX, 2025-10-29: "has the look of a potential cup and handle (Unusually long handle) and is waiting for a
  catalyst for the move. They report 10/29 AH. 50 SMA must hold." ([post](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-757))
- Beebe, DASH, 2025-10-01: "Just breaking out of this cup & handle on the daily as well above the IPO pivot. Was buyable
  today off the 10 EMA." ([post](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week))

### 6.5 What UCT's usage adds up to

- **Weekly often.** Many of the owner's cups are read on the weekly chart (BTSG, RDDT, ASML, NBIS, ANET; the unsigned
  XLV and IWM notes too), with the entry worked on the daily or hourly; about as many are daily reads (BWXT, SOLS, APLD,
  BIDU, UMAC). That matches IBD's week counting for the bigger bases.
- **The owner prefers a low-risk spot inside or under the pivot** to a chase: "mid range cheat entry", "Buying those
  shakeouts is the optimal RR", "would love a 20 ema shakeout", "red to green move ... clear area to risk against". This
  is close to Minervini's 3-C and IBD's handle shakeout, and it fits the house ~3% stop.
- **The pivot is the confirmation**: "$24.80 confirms Cup and Handle breakout", "$220 as the pivot".
- **Tightness is the tell**: "3 weeks tight", "double inside days", "Inside day would be awesome to avoid wedging up
  behavior".
- **Leaders and groups**: ANET "a leader of the entire bull run", XLV judged by how many of its stocks are setting up.
- **Cup without handle is accepted**: "either handles out or becomes a powerful cup without handle breakout".
- **A "mini" cup and handle** on the daily or hourly is used loosely (IREN, Bracco's leaders). Those are shorter than
  IBD's 7-week minimum.

---

## 7. How it fits the account rulebook (section 9 of `docs/study/sizing_rule.md`)

| Rule | What it means for the cup | Conflict? |
|---|---|---|
| B26, the 200-day (hard rule) | A proper cup sits in an uptrend, so the long is normally above a rising 200-day. Deep cups can dip under it at the cup's low; the buy is in the handle, when price should be back above it. | None for proper cups. **20 of the 100 draft bank items were below their 200-day.** |
| A3, F62, A13: stop under the day's or prior day's low, within about 3% | The pattern's natural stop (handle low) is often 5% to 12% away (my estimate from the handle depths in 3.10, not measured); IBD allows 7% to 8%. | **Yes, the main conflict.** Only a tight handle or an in-handle entry gives a ~3% stop. See 8.3. |
| A5, A7: size from the stop, cap 40% | A wider structural stop means a smaller position. | No conflict, but A13 says "almost never" a loss over 3%. |
| E57: market orders | Buy at market as price trades through the pivot. | Conflicts with the scanner's close-based trigger and with Bulkowski's and AAII's close. Not with IBD or Zanger. |
| C28: no chasing past 4% | IBD's buy zone is 5%. | **Small conflict.** Ours is tighter; use 4%. |
| C29: skip if over 10% above the 10-day | A fresh breakout from a handle is usually near its 10-day. | Rarely matters; it catches late chases. |
| C31: RS 80+, strongest groups | IBD's "L" (leader). | The scanner has no RS test ("rs_trend" is absolute). |
| B23: $10 and $20M a day | Applies as written. | One Bracco idea (SIDU, "$5 level") would fail it. |
| D40: growing sales and earnings | IBD's CAN SLIM; the owner's "For CANSLIM checks all the boxes". | None. |
| B22: no new buys within 3 days of earnings | Applies. | None. |
| B19, E51, E52, F63: breakeven at 2R to 5R; a third at 3R, a third at 5R; trail the 10-day or 21-day | Replaces IBD's 20% to 25% profit rule and the scanner's measured-move target. | **Differs from IBD** (sell most at 20% to 25%; hold 8 weeks after a fast 20%). House rules win. |
| C33: time stop, under 1R after 10 trading days | IBD gives breakouts more time (its 8-week rule is for winners). | A slow first week is common after cup breakouts (Bulkowski: 62% throw back within 30 days). Owner question 9. |
| B20: gap through the stop | Applies as written. | None. |
| A4, the owner's "my stop is my stop" | The exit is the stop, not "fell back into the base". | Agrees with his 2026-11-09 ruling striking the half-cut rule. |
| D47: shorts are our longs reversed | The inverted cup with handle, below the 200-day only. | See 8.6. |
| E50: grading is discretionary | Section 9 lists cues, not a checklist. | None. |

---

## 8. Proposed rules for our course

### 8.1 What it is (all must be true at the buy)

| Item | Rule | Basis |
|---|---|---|
| Prior trend | The stock rose at least 30% from its lowest low of the prior 6 months (about 120 trading days) to the left-side high. | [originator] IBD 2015-09-11, 2015-03-11 (AAII 2015 and Stockbee repeat it, both citing O'Neil, so they are not independent); window [my proposal] (IBD gives none; the screener uses 120 bars) |
| Leadership | RS rating 80 or higher, in one of the strongest groups. | [house rule] C31 |
| Fundamentals | Growing sales and earnings preferred; the chart comes first. | [house rule] D40 |
| Base count | First or second base since the last real correction; third and later are graded down. | [originator] IBD 2015-06-16 |
| Chart | Find and measure the base on the weekly chart; time the buy on the daily. | [originator] IBD counts weeks ("In a weekly chart, look for..."); [UCT] the owner's weekly cups; the daily timing [my proposal] |
| Cup length | At least 7 weeks including the handle (35 trading days), at most 65 weeks. Best: 3 to 6 months. | [originator] IBD |
| Cup depth | 12% to 33% from the left-side high in a normal market. 33% to 35% is allowed but graded down. Up to 50% only for cups formed in a bear market. | [originator] IBD |
| Depth vs market | No more than about 2.5 times the index's decline over the same weeks. | [originator] IBD 2013-10-03 calls 1.5x to 2.5x the market's correction normal for growth stocks; using 2.5x as a ceiling is [my proposal] |
| Shape | Rounded U, not a V. No weekly swings of 10% to 15% or more. Down weeks on the left roughly match up weeks on the right. Measured as: at least 30% of the cup's bars have their low in the cup's bottom quarter (the UCT scanner's own U-vs-V test), and at most two weeks inside the cup with a high-to-low range of 10% or more (IBD says "many" such swings, not any). | [originator] IBD; [source consensus] Bulkowski, StockCharts, AAII (U not V); the measurement [my proposal] |
| Right side | Climbs back to within about 10% of the left-side high before the handle starts. | [my proposal]; IBD says "upper half"; Zanger says the handle sits about 5% below the old high |
| Handle length | At least 5 trading days. Usually 1 to 4 weeks. Over about 22 trading days is graded down. | [originator] IBD (5 days minimum; "should also last more than one or two weeks"); [source consensus] AAII, StockCharts, Zanger (1 to 4 weeks, or 4 days to 3 weeks); the 22-day grade-down leans on Bulkowski's measured median [my proposal] |
| Handle depth | At most 12% from the handle's own high; 8% or less is better; about 5% is best. | [originator] IBD "usually no more than 8% to 12%" for the 12% cap; the "8% or less" and "about 5%" grades are [my proposal], leaning on Zanger's "about 5% below the old high" |
| Handle position | The handle's midpoint is above the cup's midpoint. Upper third is better. | [originator] IBD 2015-09-11 for the midpoint test; "upper third is better" is [my proposal], leaning on AAII 2015 ("upper half or third") and Minervini's 2020-05-13 post |
| Handle drift | Lows drift sideways to down. A handle whose lows rise (wedges up) is not a handle. Measured as: a straight line fitted through the handle's daily lows slopes flat or down (the screener's test). | [originator] IBD; the measurement [my proposal] |
| Handle volume | The handle's average daily volume is below the cup's average daily volume. (Some very quiet days near the handle low is a grading cue, not a gate.) | [originator] IBD (direction only; IBD gives no number) |
| Handle and averages | The handle holds above the 50-day line: no daily close below the 50-day SMA during the handle. | [originator] IBD 2015-09-24 ("should generally form above the 50-day or 10-week moving averages"); the one-close test [my proposal] |
| Tightness | The last week or two of the handle trades tight. Measured as: the last 5 handle closes sit within about 3% of each other. | [originator] IBD ("areas of tight trading", no number); [UCT] "3 weeks tight", inside days; the 3% [my proposal] |
| 200-day | Price above the 200-day SMA at the buy. | [house rule] B26, hard rule |
| Liquidity | Price $10 or more; $20 million or more traded a day; position under 1% of daily volume. | [house rule] B23, D42 |
| Earnings | No new buy in the 3 days before a report. | [house rule] B22 |

### 8.2 The buy

**Two ways in. Both are taught; the owner picks the default (question 6).**

**A. The breakout (the textbook buy).**
- Pivot: the highest price in the handle. [originator] IBD, Zanger
- Trigger: price trades above the pivot during regular hours. [originator] IBD, Zanger; [house rule] E58
- Order: a market order the moment it trades through. [house rule] E57 (IBD adds 10 cents; the Kicker plan uses a cent;
  question 7.)
- Volume: on pace for at least 40% above the 50-day average by the close. [originator] IBD "at least 40% to 50% above
  average" (the column names no period; the 50-day is AAII 2001's baseline). If the day
  closes with less, it is a warning, not an exit. [my proposal]
- Chase limit: no buy more than 4% above the pivot. [house rule] C28. No buy more than 10% above the 10-day. [house rule] C29
- For a cup without a handle: the pivot is the left-side high, and heavy volume matters more. [originator] IBD 2013-10-03

**B. Inside the handle (the owner's lower-risk buy).**
- Buy a tight day, an inside day, or a shakeout that undercuts an earlier handle low and reclaims it (red to green),
  with all of 8.1 true. [UCT] "Buying those shakeouts is the optimal RR", "red to green move"; [originator] IBD on
  handle shakeouts
- The 3-C or "mid range cheat": an earlier buy on a pause in the lower to middle third of the base. [originator]
  Minervini's posts (the "cheat" area "develops in the lower to middle third of the base"; his book's fuller rules were
  not read); [UCT] the owner's BWXT "mid range cheat entry". This is an earlier, riskier read of the same
  base; if taught, it is a separate lesson.
- The pivot breakout still confirms the trade.

**My recommendation:** teach A as the definition and B as UCT's preferred execution, because B is what makes the house
stop (~3%) possible on this pattern.

### 8.3 The stop

- Default: a few cents under the low of the buy day, or of the prior day. [house rule] A3, F62
- It should sit within about 3% of the buy. [house rule] A13
- Never wider than a few cents under the handle low. Below the handle low the setup has failed. [originator] Bulkowski
  (stop at the handle low); [my proposal] as the outer limit
- If the honest stop is wider than about 3%: wait for a tighter spot (a quiet day near the pivot, or an in-handle
  shakeout), or size down from the stop (A5), or skip. Never move the stop closer to make it fit. [house rule] A3, A5
- For reference only: IBD's absolute maximum is 7% to 8% below cost. [originator]
- A gap below the stop: the first 30-minute low becomes the stop; out if that is past 2R. [house rule] B20
- The stop only moves up. [house rule] A4

**Options for the owner (question 8):** (a) house default only; (b) handle low as the stop, sized down; (c) house default
with the handle low as the outer limit. **I recommend (c).**

### 8.4 Trims and trail (house defaults)

- Stop to breakeven between 2R and 5R. [house rule] B19
- Sell a third at 3R, a third at 5R. If it opens above a trim level, trim at the open. [house rule] B19, E51, F63
- Trail the last third: a close under the 10-day for a fast mover, the 21-day for a steadier one. [house rule] E52
- Climax run: sell a big part into it. [house rule] C34
- Time stop: under 1R after 10 trading days, sell. [house rule] C33 (question 9)
- Hold through earnings only if up 5R. [house rule] B22
- Reference only, not our rule: IBD sells most at 20% to 25%; Bulkowski's target is 61% of the cup's height added to the
  breakout; the scanner's target is the full height.

### 8.5 What invalidates it

Before the buy (do not buy):
- The handle's midpoint (halfway between its high and low) sits below the cup's midpoint, or the handle falls more than
  12% from its own high. [originator] IBD 2015-09-11, 2014-02-06
- The handle's lows rise (wedging), or the handle is shorter than 5 days. [originator] IBD
- Volume rises through the handle. [originator] IBD
- A close below the 50-day during the handle. [originator] IBD ("should generally form above the 50-day"); treating
  one close as a disqualifier is [my proposal]
- The cup is a V, or deeper than 35% outside a bear market. [originator] IBD
- The market reading turns Red. [house rule] D46, F65
- The handle runs past about 6 weeks with no breakout: the base is getting stale. [my proposal]

After the buy:
- The stop. "my stop is my stop most of the time." [UCT] (owner, 2026-11-09) A close back into the handle is a warning,
  not an exit; his 2026-11-09 ruling struck the rule "cut at least half if the stock falls back into its base" (his
  words: "15, eh, my stop is my stop most of the time."). [UCT] owner verdict log

### 8.6 The short mirror

- The inverted cup with handle: a rounded top, a small weak bounce (the handle), and a break below the handle low. Our
  app has `detectors/classical/inverse_cup_handle.py`. [originator] Bulkowski; [house rule] D47
- Only below the 200-day SMA. [house rule] B26. Weakest stocks: RS 20 or less, weakest groups. [house rule] C31
- Trigger: trades below the handle low; stop a few cents above the day's high. [house rule] D47 mirror. (Bulkowski's
  own trigger differs: "When price closes below the right rim low, short the stock." He gives no stop level.)
- Evidence: Bulkowski's numbers are worse than for the long (18% break-even failure, 17% average decline, 556 trades, bull
  market). IBD teaches no short version in what I read.
- **My recommendation:** list it as the mirror, but do not build a lesson until the owner says so (question 11).

### 8.7 Best market conditions

- A Green market reading; Yellow at smaller size. [house rule] B18, F65
- Best at the start of a new market uptrend after a correction. [originator] Zanger ("at the beginning of a market move
  after a good market correction"). IBD: cups form "during intermediate declines in the general market".
- The group is leading, with several of its stocks setting up. [UCT] the XLV note

### 8.8 Common mistakes

1. Buying a V-shaped recovery and calling it a cup. [originator] IBD
2. Buying a handle in the lower half of the base. [originator] IBD
3. Buying a handle that wedges up. [originator] IBD; [UCT] "avoid wedging up behavior"
4. Calling a 2 or 3-day dip a handle (under 5 days). [originator] IBD
5. Chasing more than 4% past the pivot. [house rule] C28
6. Buying a breakout on weak volume and ignoring it. [originator] IBD
7. Trading a third or fourth-stage base like a first. [originator] IBD
8. Using the handle low as the stop at full size, then taking an 8% to 12% loss. [house rule] A13
9. Buying in a correction because "the chart looks great". [originator] Zanger; [house rule] F65
10. Holding a failed breakout and hoping, or widening the stop. [house rule] A4
11. Treating the measured-move target as a sure thing (Bulkowski: 61% reach it). [originator] Bulkowski's measured
    statistic (one source)
12. Calling an hourly "mini cup" the same setup as a 7-week weekly base. [my proposal]

---

## 9. Grading (observable cues from the sources; E50 says grading is his judgment, so this is not a checklist)

| Cue | Toward A+ | Toward B- | Source |
|---|---|---|---|
| Base count | First or second stage | Third or later | IBD |
| Prior run | 30% or more in a few months, on rising volume and RS | Barely 30%, slow | IBD, Stockbee, Zanger |
| Depth | 12% to 25%, under 2.5x the market's drop | 30% to 35% | IBD's 12% to 33% band (the 25% split inside it is mine) |
| Length | 7 weeks to 6 months, symmetric | Very long, lopsided | IBD |
| Shape | Smooth U, no 10% to 15% weekly swings | Jagged, V-ish | IBD |
| Handle position | Upper third, within about 5% of the old high | Just above the midpoint | Zanger (about 5% below the old high), IBD (upper half), AAII 2015 (upper half or third), Minervini's one post |
| Handle depth | About 5% to 8% | 10% to 12% | Zanger, IBD |
| Handle length | 1 to 3 weeks (under 22 days) | Over a month, or barely 5 days | Bulkowski (measured), Zanger; IBD wants more than one or two weeks |
| Handle action | Drifts down, a shakeout of an earlier low, tight closes at the end | Wedges up, loose, no shakeout | IBD; the owner's "3 weeks tight" |
| Handle volume | Dries up sharply | Stays heavy | IBD |
| Breakout volume | Well above 50% over average | About 40% or less | IBD |
| Leadership | RS 80+, leading group, growing sales and earnings | RS lower, lagging group | house C31, D40; IBD |
| Market | Green, early in a new uptrend | Yellow, late in a long run | Zanger; house F65 |
| Risk | Stop within about 3% | Honest stop wider than 3% | house A13 |

---

## 10. Questions for the owner

1. **Chart.** Do we define cups on the weekly chart (IBD's way, and most of your examples) and time on the daily?
   Options: weekly base + daily trigger (my recommendation) / daily only / both.
2. **Mini cups.** Do daily or hourly "mini cup and handle" patterns under 7 weeks count as this setup? Options: no, they
   are flags or tight ranges (my recommendation) / yes, as a separate "mini" lesson.
3. **Cup length.** Our scanner caps the cup at 13 weeks (65 daily bars). IBD allows 7 to 65 weeks. Options: lift to 65
   weeks (my recommendation) / cap at 26 weeks / keep 13.
4. **Depth.** Options: 12% to 33% normal, 50% only after a bear market (IBD, my recommendation) / 12% to 35% / Zanger's
   20% to 35%.
5. **Handle depth.** Options: at most 12% (IBD, my recommendation) / about 5% to 8% only (Zanger) / a third of the cup's
   depth (AAII).
6. **The buy.** Options: the breakout over the handle high only / the in-handle shakeout or "mid range cheat" only /
   both, breakout as the definition and the in-handle buy as our execution (my recommendation).
7. **The pivot price.** Options: a cent over the handle high (as in the Kicker plan) / IBD's 10 cents over / at market
   as soon as it trades through.
8. **The stop.** Options: house default only / handle low, sized down / house default with the handle low as the outer
   limit (my recommendation).
9. **Time stop.** C33 sells a trade under 1R after 10 days. Bulkowski found 62% of cup breakouts throw back within 30
   days. Keep C33 as is for cups, or give cups more time?
10. **Breakout volume.** Options: require 40% over the 50-day average (IBD) / a warning only (my recommendation, since
    we buy at market intraday) / no volume rule.
11. **Short mirror.** Teach the inverted cup with handle (below the 200-day only), or leave the cup long-only like the
    Model Book card?
12. **Cup without handle.** Same lesson as a variant (my recommendation), or its own setup?
13. **Measure it.** May we run the screener's IBD-style cup (`bc:cup-with-handle`) over the pod's history with the house
    trade plan, so the course can quote our own numbers instead of Bulkowski's?
14. **The 100 draft bank items.** 40 have handles under 5 days and 20 are under the 200-day. Rebuild them from the agreed
    rules before any go live?
15. **The scanner text.** Approve removing the unsourced claims listed in 5.3 item 12 (the Zanger quote, the "18-28%"
    claim, "since the 1960s", the "1.5x to 3x" claim and others)?
16. **The 10 model examples.** Candidates named in the sources (none checked on charts yet): from UCT: BTSG weekly
    2025-06 ($24.80 pivot), BWXT 2026-02 ($220), SOLS 2026-04 ($85), ASML weekly 2025-11 ($1,100), RDDT weekly 2025-09,
    XRT and ITA breakouts 2026-01, LDOS weekly 2025-11 (ChartMaster), XLV weekly 2025-11 to 2026-02 ($160). From
    outside: AAPL June 2020 (Minervini's "textbook" 3-C), Westlake Chemical June 2013 (IBD 2014-11-04: "In June 2013,
    Westlake Chemical (WLK) cleared a first-stage cup-with-handle pattern"), DISH 2011-2012 weekly (AAII 2015), EMC 2000
    (StockCharts), Liz Claiborne early 1980s (IBD 2015-02-25, "a new first-stage cup-with-proper-handle"). Which do you want, and do you have favourites of your own?

---

## 11. Sources

All read on 2026-11-09 unless marked. Reliability: **High** = the originator's own words or a primary data page;
**Medium** = an established educator; **Low** = used only as a lead.

| # | Source | Publisher | Author | Link | Reliability note |
|---|---|---|---|---|---|
| 1 | Looking At A Great Chart Base? Make Sure To Count The Weeks (2015-03-11) | IBD, via Yahoo Finance | IBD (no named author) | https://finance.yahoo.com/news/looking-great-chart-sure-count-203400677.html | High: originator's publication |
| 2 | What Qualities Should Investors Look For When Studying Bases? (2015-02-18) | IBD, via Yahoo | IBD | https://finance.yahoo.com/news/qualities-investors-look-studying-bases-224700851.html | High |
| 3 | Correctly Shaped Bases Create Winning Breakouts (2013-02-04) | IBD, via Yahoo | IBD | https://finance.yahoo.com/news/correctly-shaped-bases-create-winning-215900488.html | High |
| 4 | Cup With Handle Is Familiar, But Understand Key Nuances (2013-09-25) | IBD, via Yahoo | IBD | https://finance.yahoo.com/news/cup-handle-familiar-understand-key-203500768.html | High; some linked words dropped in Yahoo's copy |
| 5 | Cup Patterns Without Handles Can Still Go On To Be Winners (2013-10-03) | IBD, via Yahoo | IBD | https://finance.yahoo.com/news/cup-patterns-without-handles-still-182000010.html | High; some linked words dropped |
| 6 | How To Identify Good Qualities Of A Cup-With-Handle Pattern (2014-02-06) | IBD, via Yahoo | IBD | https://finance.yahoo.com/news/identify-good-qualities-cup-handle-233000441.html | High; some linked words dropped |
| 7 | A Chart Pattern With Star Power: A Simple Cup-With-Handle Base (2015-09-11) | IBD, via Yahoo | IBD | https://finance.yahoo.com/news/chart-pattern-star-power-simple-212700404.html | High |
| 8 | A Faulty Handle Spells Trouble; Is It Too Low? Does It Wedge Up? (2015-09-24) | IBD, via Yahoo | IBD | https://finance.yahoo.com/news/faulty-handle-spells-trouble-too-195200814.html | High |
| 9 | Why Look For A Proper Handle? It Often Appears In A Great Base (2015-02-25) | IBD, via Yahoo | IBD | https://finance.yahoo.com/news/why-look-proper-handle-often-220600578.html | High |
| 10 | Why Cutting Stock Losses Short Is The Most Important Sell Rule (2014-09-10) | IBD, via Yahoo | IBD | https://finance.yahoo.com/news/why-cutting-stock-losses-short-211000887.html | High |
| 11 | Take Stock Gains At 20%-25% And Build Long-Term Profits (2015-06-30) | IBD, via Yahoo | IBD | https://finance.yahoo.com/news/stock-gains-20-25-build-220800542.html | High |
| 12 | Base Your Stock Buys On Bases, And Things Will Work Better (2014-11-04) | IBD, via Yahoo | IBD | https://finance.yahoo.com/news/stock-buys-bases-things-better-221700195.html | High |
| 13 | Why Late-Stage Base Patterns Often Lead To A Timely Exit (2015-06-16) | IBD, via Yahoo | IBD | https://finance.yahoo.com/news/why-stage-patterns-often-lead-215800864.html | High |
| 14 | Everything You Need To Know About Handles In Bases (updated 2022-04-14) | investors.com | Michael Molinski | https://www.investors.com/how-to-invest/investors-corner/cup-with-handle-everything-you-need-to-know-about-handles-in-bases/ | High, but only the free first lines visible |
| 15 | How To Buy Stocks: Everything You Need To Know About Handles In Bases (2024-01-02, updated 2026-05-13) | investors.com | Kimberley Koenig, David Saito-Chung | https://www.investors.com/how-to-invest/investors-corner/everything-you-need-to-know-about-handles-how-to-spot-a-good-one/ | High, free lines only |
| 16 | Recognize The Proper—And Improper—Cup With Handle (2013-09-13, updated 2016-02-05) | investors.com | Donald H. Gold | https://www.investors.com/how-to-invest/investors-corner/cup-with-handle-base/ | High, free first lines only |
| 17 | The Cup & Handle Pattern (undated) | chartpattern.com | Dan Zanger | https://www.chartpattern.com/cup-handle.cfm | High: originator of his version; footer forbids redistribution, short quotes only |
| 18 | Chart patterns index (undated) | chartpattern.com | Dan Zanger | https://www.chartpattern.com/chart-patterns.cfm | High; context only |
| 19 | Using Volume to Make Better Trades (page metadata 2018-12-03; a figure is dated May 12, 2016) | traderslog.com | Dan Zanger | https://www.traderslog.com/?p=27578 | High for the ZVR; original date uncertain |
| 20 | X post: AAPL 3-C (2020-06-21) | X (via public embed) | Mark Minervini | https://x.com/markminervini/status/1274498666561187841 | High |
| 21 | X post: cheat area vs handle (2020-05-13) | X | Mark Minervini | https://x.com/markminervini/status/1260379646165749762 | High |
| 22 | X post: VCP is a characteristic (2020-07-21) | X | Mark Minervini | https://x.com/markminervini/status/1285646150733836293 | High |
| 23 | X post: more than a cup shape (2019-10-28) | X | Mark Minervini | https://x.com/markminervini/status/1188910654570356737 | High |
| 24 | X post: low cheat up to 8% below the 50-day (2020-04-27) | X | Mark Minervini | https://x.com/markminervini/status/1254914208510218241 | High, but a reply without its question |
| 25 | X post: why he developed VCP (2020-07-21) | X | Mark Minervini | https://x.com/markminervini/status/1285646820782288898 | High; context only |
| 26 | Bulkowski on the Cup with Handle (updated 7/25/25) | thepatternsite.com | Thomas N. Bulkowski | https://thepatternsite.com/cup.html | High for his measured data; **AI-training notice on the site, flagged** |
| 27 | Best patterns (note as of 9/20/21 says outdated) | thepatternsite.com | Thomas N. Bulkowski | https://thepatternsite.com/BestPatterns.html | Medium: he says it is outdated; AI notice applies |
| 28 | Glossary | thepatternsite.com | Thomas N. Bulkowski | https://thepatternsite.com/glossary.html | High for definitions; AI notice applies |
| 29 | Bulkowski on the Inverted Cup with Handle | thepatternsite.com | Thomas N. Bulkowski | https://thepatternsite.com/icup.html | High; AI notice applies |
| 30 | Cup With Handle (page says last updated 2024-06-10) | StockCharts ChartSchool | StockCharts | https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns/cup-with-handle | Medium: established educator |
| 31 | Predicting Short-Term Trends: The Cup-With-Handle Pattern (August 2001) | AAII Journal | Wayne A. Thorp | https://www.aaii.com/journal/article/predicting-short-term-trends-the-cup-with-handle-pattern | Medium; member page, rules visible |
| 32 | The Cup-With-Handle Pattern (December 2015) | AAII Journal | Wayne A. Thorp | https://www.aaii.com/journal/article/the-cup-with-handle-pattern | Medium; member page, rules visible |
| 33 | William O'Neil Setups (2011-12-13) | Stockbee | Pradeep Bonde | https://stockbee.blogspot.com/2011/12/william-oneil-setups.html | Medium: an originator summarising another |
| 34 | My 3 timeless setups | qullamaggie.com | Kristjan Kullamägi | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | High, but no cup definition (checked only for that) |
| 35 | Internet Archive catalogue, 1988 edition | archive.org | (catalogue record) | https://archive.org/details/howtomakemoneyin0000onei | Confirms the 1988 McGraw-Hill edition; book text not read |
| 36 | UCT Substack, all 103 posts in the sitemap (2025-06-01 to 2026-11) | unchartedterritoryy.substack.com | TSDR (owner), Bracco, unsigned sections, contributors | https://unchartedterritoryy.substack.com/sitemap.xml | High for "how we trade it"; 27 posts quoted in section 6 (recounted in checking; the draft said 29) |
| 37 | Account rulebook, section 9 | this repo | the owner (2026-11-09) | `docs/study/sizing_rule.md` | House rules |
| 38 | Owner verdict log | this repo | the owner | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | No cup ruling yet |
| 39 | Trade plans | this repo | | `docs/study/TRADE_PLANS.md`, `api/services/study_trade.py` | No cup plan |
| 40 | UCT cup scanner | this repo | | `api/services/pattern_engine/detectors/uct/cup_handle_uct.py` | Read in full; probed |
| 41 | Context, pivots | this repo | | `api/services/pattern_engine/primitives/context.py`, `primitives/pivots.py` | Read |
| 42 | Classical cup and inverted cup scanners | this repo | | `detectors/classical/cup_handle.py`, `detectors/classical/inverse_cup_handle.py` | Read (headers and levels) |
| 43 | Screener cup | this repo | | `api/services/screener/base_catalog.py`, `api/services/pattern_engine/primitives/cup.py` | Read |
| 44 | Chart IQ bases | this repo | | `api/services/chart_iq/engine/v3_bases.py` | Read (cup lines) |
| 45 | Study bank cup items | this repo | | `docs/study/bank/chart.bases.json` | 100 drafts measured |
| 46 | Model Book card, journal tags, tag map, vision rubric, router text | this repo | | `app/src/pages/modelbook/setupCatalog.js`, `app/src/constants/setupGroups.js`, `app/src/pages/journal-2-0/lib/setupTagMap.js`, `api/services/pattern_vision/rubrics.py`, `api/routers/patterns.py` | Read |
| 47 | Study unit plans | this repo | | `docs/study/UNITS-method.md`, `docs/study/skill_map.json`, `docs/curriculum/uct_method_chapters.json` | Read |
| 48 | Earlier in-repo base research | this repo | | `docs/superpowers/research/bases/01-*.md`, `02-*.md`, `14-*.md` | Low: used only as leads; every number above was re-read at its source |
| 49 | Cup chart drawing for members, cup tier | this repo | | `api/services/auto_structures.py` (`MEMBER_CUP_TIER_ROUND = None`, withdrawn 2026-10-24), `api/services/pattern_engine/cup_tier.py` | Read in checking |

**Tried and not read:** O'Neil's book text (Internet Archive lending copies and Google Books refused automated access);
Minervini's books; Bulkowski's *Encyclopedia of Chart Patterns* (an apparently unauthorised copy exists; not used);
Kuhn, TASC V.13:3 and V.13:07 (paywalled); Morales and Kacher; TraderLion (403); MarketSmith India blog (no DNS answer);
Investopedia (402); Nasdaq's IBD reprints (timed out); Zanger's "10 Golden Rules" page (rules not in the page text).

---

## Corrections and removals in checking (cold check, 2026-11-09)

**Corrected (the truth was found):**
1. UCT quote "3 weeks tight under the cup and handle pivot. $24.80 confirms..." (2025-06-08) is about **BTSG (weekly)**,
   not PTON: it sits under "BTSG (Weekly)", right after a PTON note. Fixed in 6.1 and question 16.
2. Our scanner's Stage 2 test was misdescribed as the 150-day average's own 50-bar slope. The code measures the
   **close** against the close 49 bars earlier (`_slope_sign(closes, 50)`), plus the close above the 150-day SMA.
   Fixed in 5.1.
3. The screener cup (`bc:cup-with-handle`) was called "shown to members". Its chart drawing was **withdrawn from
   members on 2026-10-24** (owner decision; `auto_structures.py`). Fixed in 5.4.
4. "Shown to members as 'Cup with Handle'" for `cup_handle_uct`: unverified where members see that label; replaced with
   the names the code actually uses (5.1).
5. Chart IQ was said to have "no 200-day test"; it has a `downtrend()` skip that uses the 200-day and 50-day (5.4).
6. The code comment was quoted as "medium confidence"; the code says `confidence="med"` (5.4).
7. Bulkowski's statistics heading is "Cup with Handle: Important Bull Market Results"; the page does not say "upward
   breakouts" there (section 4).
8. Bulkowski's "ranked 11th" was said to be on "1 to 3 month moves"; the page names no horizon for it and says its table
   is sorted by the two-month column (section 4).
9. StockCharts' date: the page's "Last updated" is 2024-06-10, not 2026-11-05 (3.5, source 30). StockCharts' main text
   also says the trend should "ideally" be "a few months old" (added beside the FAQ's "a couple of months").
10. Zanger's traderslog article: the page metadata says 2018-12-03; "about May 2016" was an inference from a figure
    caption (3.2, source 19).
11. The 2013 Donald H. Gold column was said to show "only its title and byline"; its free first lines are visible and
    its real title is "Recognize The Proper—And Improper—Cup With Handle" (3.1.9, source 16).
12. "investors.com blocks automated reading": a plain download works and returns the free lines (3.1).
13. The Internet Archive record confirms a 1988 McGraw-Hill edition but does not label it a "first edition" (section 2).
14. UCT post counts: the word "cup" appears in 39 posts, not "about 45"; 27 distinct posts are quoted in section 6, not 29.
15. "Most of the owner's cups are read on the weekly chart": about half are daily reads; reworded (6.5). The XLV notes
    named there are unsigned, not the owner's.
16. The 5.2 probe explanation: the 40-bar cup failed the stage gate (Stage 3), not the stacked gate (5.2).
17. Section 8.5 said "the handle undercuts the cup's midpoint", which contradicted 8.1's IBD midpoint test; aligned
    to IBD's wording (the handle's midpoint against the cup's midpoint).
18. Question 16: XLV dates are 2025-11 to 2026-02 (not 2025-12); Westlake now cites the IBD column it comes from
    (2014-11-04); DISH is the June 2011 to December 2012 weekly chart.

**Basis tags made honest (section 8, 9):** prior trend is [originator] IBD (AAII 2015 and Stockbee repeat O'Neil, so
they are not independent agreement); the 2.5x market ceiling, the "8% or less / about 5%" handle grades, "upper third
is better", the 22-day grade-down, the one-close 50-day test and every measurement added to make a rule testable are
[my proposal]; mistake 11 (one source) is [originator] Bulkowski, not [source consensus]; Minervini's "upper third"
is one post about one chart, not a stated rule.

**Rules made measurable (8.1):** Shape (bottom-quarter test, count of 10% weeks), Handle drift (slope of the lows),
Handle volume (averages only; quiet days moved to grading), Handle and averages (no close below the 50-day), Tightness
(last 5 closes within about 3%). The numbers are proposals for the owner.

**Added in checking (verified at the source):** IBD "It should also last more than one or two weeks." (handle length,
2015-09-24); IBD "In a weekly chart, look for ... a prior uptrend of at least 30% in price." (2015-03-11); IBD 2014-11-04
on Westlake; IBD 2015-02-25 on Liz Claiborne; AAII 2001 "the handle should not extend into the lower half of the cup.",
its 1-to-12-month range and its O'Neil credit; Zanger "The Cup & Handle is the corrective action after a powerful stock
advance." and his 200%-volume line; Bulkowski "Raise the stop as price rises." and his inverted-cup trigger; Gold's free
lines; the UCT XRT and IWM notes; the screener comments that IBD columns now contradict; the cup tier and its member
withdrawal; Kuhn's follow-up article (not read).

**Removed in checking:**
- "on a small tight pause" from the 3-C description (8.2): not in any Minervini text read; the book was not read.
- "Minervini places a proper handle in the upper third of the base" as a Minervini rule (3.3, 3.9, 3.10, 8.1, 9): the
  only source is one post describing one chart. Kept only as that.

Nothing else had to be removed: every other quote in this file was found word for word on its page, in context.

---

## 12. Examples (from our data)

**The scan's rule (section 8 made mechanical, plus the house rules).** Daily bars from the local sandbox (3,897 names,
1984-2026), scanned over the 2,630 names that ever met the house liquidity rule, trigger days from 2000-01-01 on. A hit
needs: a left-side high that is the highest high of the prior 120 sessions and at least 30% above the lowest low of
those 120 sessions (8.1 prior trend); a cup of 35 to 325 sessions (7 to 65 weeks) from that high to the trigger, 12% to
35% deep, with its low in the middle 60% of the cup, at least 30% of the cup's bars with lows in the bottom quarter (the
U-not-V test) and at most two 5-session blocks with a 10% or wider range; a right rim within 10% below (or 5% above) the
left-side high; a handle of 5 to 30 sessions whose highs all sit under the right rim, 3% to 12% deep, midpoint above the
cup's midpoint, a flat-or-down line through its lows, average volume below the cup's, and no close below the 50-day SMA;
the trigger is the first day the high trades above the handle high (the pivot) with the close above the 200-day SMA
(B26), price $10 or more and 50-day dollar volume $20M or more (B23); market-order fill at the pivot plus a cent, or at
the open when it gaps over the pivot (E57), no fill more than 4% over the pivot (C28) or more than 10% over the 10-day
SMA (C29); stop 5 cents under the lower of the trigger day's and the prior day's low, or under the trigger day's low
alone if that is wider than 3%, and skip if still wider than 3% (A13, F62); no trigger in the 3 sessions before an
earnings report (B22). The 3% minimum handle depth and the middle-60% cup-low test are the scanner's own additions (a
shallower dip is a flat shelf, not a handle). Not coded: base count, RS 80+ and group strength, the market reading,
the 2.5x-the-index depth ceiling, the bear-market 50% allowance. One hit per name per 30 sessions.

**Base rate (fixed stop, no trims, no breakeven move, no trail).** 2,630 of 2,630 liquid names scanned (full
coverage, about 4 minutes). 428 hits (first 2001-02-21, last 2026-11-02); 12 were ETFs and 13 more triggered on an
earnings-reaction day. Of the 403 stock hits not on an earnings-reaction day: **30.3% reached 3R and 22.6% reached 5R
before the stop** within 60 trading days; 85% touched the stop at some point in the 60 days (342 of 403), 197 of them
without ever reaching 1R; the median best excursion was 1.1R. All 416 stock hits: 30.8% / 23.1%. The 274 hits that
also passed the tightness proposal (last 5 handle closes within 3%) did a little better: 32.1% / 24.8%. Read these
numbers as a floor for the house trade: a stop this tight (median about 2.3%) is hit by normal noise, and the house
plan trims a third at 3R, a third at 5R and trails the rest, which the fixed-stop count does not credit; the count
also ignores RS, group, base count and market reading, which the owner reads before any buy.

**The 10 examples** (charts in `scratchpad/setups/04-cup-handle/final/`, one per name, ten different years; "best R"
is the highest excursion before the stop within 60 sessions; buy and stop in dollars; structure numbers from the scan):

| # | Ticker | Trigger | Cup (weeks / depth / prior run) | Handle (days / depth / vol vs cup) | Buy / stop (risk) | Breakout vol | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|
| 1 | GWW | 2004-09-29 | 10.4 wk / 14.6% / +31% | 7 d / 3.3% / 0.66x | 56.61 / 55.27 (2.4%) | 0.73x | 7.3R | A smooth U of the right depth after a 6-month run; a one-week handle that drifts down on light volume and holds the 50-day. The one flaw: breakout volume was below average, so it is the example for "weak volume is a warning, not an exit". |
| 2 | EFX | 2007-05-04 | 11.0 wk / 14.5% / +35% | 7 d / 3.0% / 0.85x | 40.98 / 40.25 (1.8%) | 0.78x | 7.3R | A textbook rounded bottom (two months of lows in the bottom quarter), a right side that climbs straight back to the rim, a shallow 7-day handle. Also a light-volume breakout that worked. |
| 3 | MCO | 2012-09-06 | 21.6 wk / 21.3% / +40% | 19 d / 6.7% / 0.77x | 40.76 / 39.73 (2.5%) | 1.6x | 8.5R | The long version: a 5-month cup with a 4-week handle. Shows that a handle can run almost a month and still work if its lows drift down, volume dries up and the 50-day holds. 3R in 4 sessions. |
| 4 | RRC | 2013-02-05 | 15.2 wk / 17.5% / +39% | 6 d / 4.6% / 0.97x | 69.20 / 67.35 (2.7%) | 1.3x | 7.5R | A rounded 15-week cup with its low near the middle; the handle forms just under the rim in the upper third of the base. Handle volume barely below the cup's (0.97x): the grading cue at its weakest acceptable. |
| 5 | FFIV | 2014-01-13 | 15.6 wk / 17.5% / +40% | 7 d / 4.2% / 0.74x | 91.29 / 90.67 (0.7%) | 2.71x | 41R | The cleanest of the ten: symmetric cup, quiet handle, breakout on 2.7x volume, 3R the next day. The 0.7% stop (a tight trigger day) makes the R count huge; the dollar move was about 20% in 6 weeks. |
| 6 | WB | 2017-05-08 | 10.4 wk / 19.4% / +47% | 6 d / 6.5% / 0.74x | 57.48 / 56.70 (1.4%) | 2.99x | 32R | A 10-week U above a rising 200-day, a 6-day handle, a 3x-volume breakout; the stock then gapped higher the next week. Shows why the house holds the last third through 5R. |
| 7 | CNC | 2018-04-16 | 10.6 wk / 13.2% / +39% | 6 d / 3.5% / 0.63x | 54.57 / 52.94 (3.0%) | 1.45x | 7.0R | The shallow version near the 12% floor: a 13%-deep cup in a steady uptrend, the driest handle of the ten (0.63x). The stop sits exactly at the 3% limit, so it is the example for "stop within about 3%" (A13). Slow mover: 3R took 29 sessions. |
| 8 | AAPL | 2021-11-17 | 10.2 wk / 12.1% / +32% | 7 d / 3.1% / 0.72x | 152.21 / 149.29 (1.9%) | 1.17x | 10.5R | A mega-cap cup a learner can check anywhere: 12% deep, handle under the rim, breakout on modest volume, 3R in two sessions. The 60-day window ends inside the January 2022 market break, which the fixed stop survived. |
| 9 | WPM | 2025-12-10 | 7.6 wk / 19.1% / +52% | 6 d / 6.4% / 0.75x | 111.61 / 108.76 (2.6%) | 1.08x | 19R | The short cup near the 7-week minimum, in a leader above a rising 200-day; handle lows drift down for 6 days. Volume at the breakout was only average: the move came in the following weeks. |
| 10 | AX | 2026-01-05 | 16.6 wk / 20.2% / +72% | 5 d / 4.9% / 0.89x | 89.22 / 86.95 (2.5%) | 1.48x | 5.6R | The most recent: a 4-month U after a 72% run, a 5-day handle (the IBD minimum), a 1.5x breakout. Reached 5R in about 7 weeks, then rolled over below the pivot: the example for trailing the last third under the 21-day. |

All ten reached 5R. Charts: `01_GWW_2004-09-29.png` to `10_AX_2026-01-05.png`, sheets `sheet_1-4.png`, `sheet_5-7.png`,
`sheet_8-10.png` (one column, phone size), `examples.json` (the numbers), `hits.json` (every hit with its outcome).

**Notable failures (all met every rule above):**
- **BX 2019-11-26.** A 10-week, 18%-deep cup, a 5-day handle, breakout on 4.9x volume, the heaviest of any winner or
  loser in the scan. It reached 2.4R on the second session, then a one-day dip on the fifth session touched the stop (1.2% under
  the buy) and the stock went on to make new highs without us. Lesson: a very tight trigger-day stop is cheap but fragile; the house
  answer is the breakeven move at 2R to 5R (B19), not a wider stop.
- **ULTA 2016-12-16.** A 16-week, 19%-deep cup after a 76% run with an 8-day handle: at a glance it looked like the
  FFIV chart. Inside the cup were two heavy-volume weeks (the two 10%-range weeks the rule allows), and the breakout
  faded within days to the stop with a best of 0.9R. Lesson: the "at most two wide weeks" ceiling is the maximum, not
  the grade; a cup with two violent weeks inside it is a B- base.
- **WDAY 2021-09-22.** A 30-week, 23%-deep cup with an 8-day handle sitting on the 50-day; the breakout day closed
  near its high, then the stock fell straight through the stop in the following sessions (best 0.0R). It later broke
  out again from a lower pivot and ran. Lesson: a cup over 6 months old with the handle resting on the 50-day (not
  well above it) is a late, tired base; the owner's base-count rule (first or second base) is the filter the scan
  cannot apply.
- Also seen in the hits: **SCHW 2024-11-06** and **KMI 2016-09-08** gapped over the pivot at the open, filled at the
  open and never traded above that fill on any later day in the window (best 0.0R). A gap-up through a cup pivot without follow-through is the
  pattern the chase limit (C28) and the 30-minute gap rule (B20) are there for.

**Limits.** Daily bars only; weeks counted as 5 sessions. No RS rating, group rank, base count or market reading in
the scan. Stops are evaluated on daily lows (a stop touched intraday counts as hit). Best R is the high before the stop,
not a realised trade. The scan ran once, in full, within its 420-second budget (about 240 seconds used); nothing was
charted from a partial scan. ARCB 2023-07-18 (18-week cup, 3.6x breakout, best 78R) was left out of the ten because its
trigger-day stop was 0.29% under the buy, which makes the R count meaningless for a learner.

## 13. Failures and near-misses (from our data)

Charts in `_study-resume/scratchpad/setups/04-cup-handle/final/`: `fail_1-4.png` (the four failures, one column),
`near_1-4.png` (the four near-misses), `pair_01-flat-base.png` (a cup above a flat base). Every chart carries the same
buy point, stop, 3R and 5R lines and the cup box the winners carry, so the eye can compare. Numbers are read off the
daily bars; "stopped N sessions after the buy" counts from the day after the entry day.

**Four failures (every rule above passed; the stop was hit before 3R).**

| # | Ticker | Trigger | Buy / stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|
| 1 | ULTA | 2016-12-16 | 260.96 / 257.75 (1.23%) | 4 sessions later, 2016-12-22, low 256.36 | 16-week, 19% cup after a 76% run, 8-day handle, 1.6x volume; the breakout day closed mid-range, the stock faded for four days and touched the stop at a best of 0.91R. The cup held a 10%-range week and heavy-volume days: a B- base. | ch.shape_no_wild_weeks (a grade cue here: 1 wide week, the ceiling is 2) |
| 2 | BX | 2019-11-26 | 53.11 / 52.49 (1.17%) | 4 sessions later, 2019-12-03, low 51.78 | 10-week, 18% cup, 5-day handle, 4.9x volume, closed near its high; reached 2.37R on the second session, then one dip took out the 1.2% stop and the stock went on without us. | ch.stop_width (a very tight trigger-day stop is fragile; the house answer is the breakeven move, B19) |
| 3 | WDAY | 2021-09-22 | 273.63 / 266.70 (2.53%) | the next session, 2021-09-23, low 264.55 | 30-week, 23% cup, 8-day handle resting on the 50-day; the breakout day closed in the lower third of its range (close 270.71 against a 273.63 buy) and the next day fell through the stop. Best 0.0R. | ch.base_count (a late, tired base; the scan cannot count bases) |
| 4 | SCHW | 2024-11-06 | 74.57 / 73.36 (1.62%) | the next session, 2024-11-07, low 72.90 | 23-week, 23% cup, 6-day handle; gapped over the 72.58 pivot at the open and filled 2.7% above it, closed near its high, then fell through the stop the next day without ever trading above the fill. Best 0.0R. The stock made new highs three weeks later. | ch.no_chase (inside the 4% limit, but a gap fill with no follow-through is what C28 and the 30-minute gap rule B20 are for) |

**Four near-misses (each looks like a cup with handle and fails exactly one gate of the card).**

| # | Ticker | Date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | PEP | 2009-10-02 | ch.cup_depth | cup 6.6% deep; the rule needs 12% to 35% | A shallow shelf, 8.4 weeks, 9-day handle, 2.25x volume: closer to a flat base (01) than a cup. Best 2.5R. |
| 2 | MPWR | 2023-06-28 | ch.cup_length_min | cup 20 sessions (4.0 weeks); the rule needs 35 sessions (7 weeks) | A four-week dip and recovery after a 64% run with a 7-day handle: too short to be a cup, a flag or a short base at best. Best 1.05R. |
| 3 | AAPL | 2021-04-29 | ch.handle_drift | handle lows rise +0.53 a day (a wedge); the rule needs flat or down | A 13-week, 20% cup, then six days of rising lows into the pivot: a wedging handle, no shakeout. Stopped at a best of 0.0R. |
| 4 | META | 2024-06-26 | ch.shape_u | 12% of the cup's bars have lows in the bottom quarter; the rule needs 30% | An 11-week, 22% drop and a straight climb back: a V, not a U; the 5-day handle sits on a V. Best 0.79R. |

**What the failures have in common.** None of the four was wrong on the rules; three of the four were weak on the day
of the buy. WDAY closed in the lower third of its breakout bar, SCHW gapped and could not add to its open, ULTA closed
mid-range on 1.6x volume, and all three were out within four sessions with a best of 0.91R or less. Three of the four
carried a stop under 1.7%, which is cheap but fragile: BX reached 2.37R before a one-day dip took it. The structure
cues the card already grades (a wide week in the cup, a handle on the 50-day, a base older than six months) were
present on ULTA and WDAY, and the scan's gates cannot see the base count or the market reading. The learner's read:
a valid cup gives no promise; what it gives is a close stop and a quick answer, and a breakout day that closes weak
or opens with a gap it cannot build on is the first sign the answer is no.

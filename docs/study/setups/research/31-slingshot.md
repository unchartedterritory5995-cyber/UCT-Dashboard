# Setup 31: Slingshot (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Where I could not
read a source, I say so and give no wording from it.

**How the quotes were checked.** Every quote is 40 words or fewer and copied from the page named next to it.
- **Checked word for word against a saved copy** (downloaded today and searched by a script): the originator's blog
  (educsos.blogspot.com, ten posts with their comments), the TradingView script pages (TaPlot, BigGuavaTrading,
  EltAlt), the Trade The System blog post, the two Stockbee posts, the TraderLion YouTube page's own description, the
  Podscan episode page, UCT's Substack (all 103 posts in its sitemap), and our own code and docs.
- **Spelling and punctuation are the source's.** Scot1and writes "then" for "than" and "Buy" for "By" in places; I keep
  them and do not add [sic] everywhere.
- **One quote comes from a machine transcript** (Podscan's automatic transcript of a 2026 TraderLion podcast). It is
  marked where used. Check it against the audio before it goes into a lesson.
- **My web search allowance ran out** after four searches (the allowance is shared with the other research runs in this
  session). I could still open pages whose address I had. I could not search for: Bulkowski, IBD, MarketSmith or
  StockCharts pages on this name; Scot1and's posts on X; TraderLion's written articles. Section 11 lists what I could
  not open.
- **Cold check (2026-11-09, a second reader).** Every quote was re-downloaded from its page and compared word for word;
  the scanner summary was re-read against the code; the test's numbers were re-read from its raw output and 25 tickers
  were re-run (identical trades). The cold check also ran the searches listed above and added what they found: Deepvue's
  knowledge-base entry (3.9b, a 5-day EMA), Chris Moody's 2014 script of the same name (section 2), a 20 Oct 2015
  Slingshot post, Scot1and's Stockbee membership and his own Fishhook claim. Everything changed or dropped is listed
  under "Removed in checking" at the end.

Tags used in section 8: **[source consensus]** at least two outside sources agree (the sources are named in the row); **[originator]** Scot1and, who named
the setup (his blog 2015-2018, his write-up as quoted by TaPlot, his TraderLion talks); **[UCT]** the owner's rulings,
UCT's team playbook and UCT traders; **[house rule]** the account rulebook, `docs/study/sizing_rule.md` section 9;
**[measured]** our own test in section 4.3; **[my proposal]** my recommendation, for the owner to accept or change.

Terms. **The line** or **E4H**: a 4-period exponential moving average of each day's HIGH (not the close). **Trigger
day**: the first close back above the line. **Pullback**: the run of closes under the line before the trigger.
**Drive**: the strong move before the pullback (an earnings gap, a big up day, or a fast rally). **PEG**: power
earnings gap. **DCR**: where the day closed inside its range (0 = at the low, 1 = at the high). **R**: the risk on the
trade (entry minus stop). **RVOL**: the day's volume divided by its 50-day average. **ATR**: average true range.
**EMA / SMA**: exponential / simple moving average.

---

## 1. What it is

A Slingshot is a strong stock that pauses for a few days, with its closes slipping under a fast average of its daily
highs, and then closes back above that average. The trade is buying that first close back above (or the break of it),
with a tight stop under the trigger day's low, to catch the next leg of a move that is already proven.

**Why it works (the psychology).** Each point names its source. None of it is a measured fact; section 4 has the
measurements.
- **Buy a proven stock after it has been stretched back, not at the breakout.** The originator: "The theory behind this
  setup is that we take a powerful stock and stretch it with pull back.  Then when momentum resumes we enter."
  ([Scot1and, 11 Oct 2016](http://educsos.blogspot.com/2016/10/slingshot-refresher.html)). He adds that it "gets you in
  power stocks sooner, with tighter stops then waiting for a breakout."
  ([17 Aug 2015](http://educsos.blogspot.com/2015/08/introducing-slingshot.html)).
- **Why the highs.** A close back over an average of the HIGHS is a harder test than a close over an average of closes.
  Scot1and, as quoted by TaPlot: "Buy using the highs instead of the closing price, I was able to find stocks that were
  powerful enough to break the short term downward pressure." ([TradingView, 2021](https://www.tradingview.com/script/JJtDhJFF-TAPLOT-SlingShot/)).
  In a 2026 podcast (machine transcript) he says the cross "told me that prices just climbed back over the average price
  of the, you know, the highest price of the last four days. And that seemed to align very, very well with the
  resumption of the trend." ([Podscan](https://podscan.fm/podcasts/the-traderlion-podcast/episodes/the-8-pivot-lessons-that-will-change-how-you-see-charts-forever-from-pro-trader-scot1and)).
- **The pause shows the sellers are spent.** Scot1and (via TaPlot): tight ranges before the trigger signal "that the
  selling pressure is waning and perhaps, more importantly, it permits very tight stops."
- **Who is buying, who is trapped.** My reasoning, not a source: after a drive (often an earnings gap), buyers who
  missed it wait for a pullback; holders who bought late are shaken out by the first red days; short-term shorts lean on
  the pullback. The first close back above the average of highs is the day the dip buyers win, so the shorts and the
  sellers who left are on the wrong side. This is the same "delayed reaction" idea UCT's Manrav uses (section 6.4).
- **Moves come in short bursts.** Not a Slingshot source, but the idea behind UCT's "trim into the next 3-5 day burst":
  Stockbee, "Stocks move in momentum bursts of 3 to 5 days" and "In 3 to 5 days they can go up 8 to 40%"
  ([Stockbee, 21 May 2015](https://stockbee.blogspot.com/2015/05/how-do-stock-move-on-3-to-5-day-time.html)).

## 2. Origin and naming

**Short answer: the Slingshot was named and published by the trader Scot1and (on X as @Scot1andT), on his blog
"Education of A Speculator", on 17 August 2015.** He says he worked it out with "a couple of my trader friends", so it
was a small-group invention that he wrote up. Two months later he switched the line from a plain 4-day EMA to a 4-day
EMA of the highs, which is the version his later posts, the TaPlot copy of his write-up, the BigGuava script and UCT use
(Deepvue's knowledge base describes a 5-day EMA instead, 3.9b). The earliest UCT record found is Manrav's scan of July
2025, and the Sunday Scans writer says he adopted Manrav's setups, the Slingshot among them (section 6).

| Date | Who | Where | What it adds |
|---|---|---|---|
| 17 Aug 2015 | Scot1and | ["Introducing the Slingshot"](http://educsos.blogspot.com/2015/08/introducing-slingshot.html) | The name. A stock after a "power move" pulls back under the "EMA 4" but no further than the "EMA 9"; buy when it comes back through the EMA 4; hourly chart for the entry; the EMA 4 is the trailing stop |
| 20 Oct 2015 | Scot1and | ["Slingshot setup"](http://educsos.blogspot.com/2015/10/slingshot-setup.html) | One line, "Here's a video of the setup I've been using successfully"; the embedded video (YouTube id 4vlukf0OD3I) no longer exists (YouTube's oEmbed answers 404) |
| 21 Oct 2015 | Scot1and | ["Thrust--"](http://educsos.blogspot.com/2015/10/thrust.html) | Refines the trigger with his Thrust indicator, "a 4EMA of the HIGHS" |
| 8 Nov 2015 | Scot1and | ["Slingshot Setup Described"](http://educsos.blogspot.com/2015/11/slingshot-setup-described.html) | "a range breakout following a pullback in power stocks"; the post is a video I could not play |
| 27 Nov 2015 | Scot1and | ["New Slingshot Anticipation Scan"](http://educsos.blogspot.com/2015/11/new-slingshot-anticipation-scan.html) | The exact rule: close over the 4-day EMA of highs after three closes under it, as a TC2000 formula |
| 3 Jun 2016 | Trade The System (anonymous blog) | ["Slingshot Setup"](https://tradethesystem.wordpress.com/2016/06/03/slingshot-setup/) | Shows the name spreading: "my trader friend used 4 EMA" on earnings stocks |
| 11 Oct 2016 | Scot1and | ["Slingshot Refresher."](http://educsos.blogspot.com/2016/10/slingshot-refresher.html) | Theory, "power" scans, trigger "the break of the 4EMA of the HIGHS"; exits in a comment reply |
| 10 May 2017 | Scot1and | ["Setups"](http://educsos.blogspot.com/2017/05/setups.html) | A half-hour or hourly Slingshot as an early trigger for his Fishhook setup |
| 29 Nov 2021 | TaPlot (TradingView script author) | ["TAPLOT SlingShot"](https://www.tradingview.com/script/JJtDhJFF-TAPLOT-SlingShot/) | "Slingshot concept was created by Scot1andT", then his full write-up: momentum first, consolidation, stop |
| 1 Nov 2022 | Scot1and at the TraderLion 2022 conference | [YouTube, TraderLion](https://www.youtube.com/watch?v=hqIIzNgbIEY), "The Fishhook and Slingshot Trading Setup \| How to Build an Edge" | A full talk (Slingshot at 49:31); YouTube lists an auto-generated caption track but refused to serve it (HTTP 404), so I have no wording from it |
| 3 Sep 2024 (updated 19 Jun 2026) | Deepvue Knowledge Base | ["Technical Patterns"](https://deepvue.com/knowledge-base/deepvue-custom-indicators-technical-patterns/) | Credits the setup to Scot1and but describes "the 5-day Exponential Moving Average"; adds a range break and a consolidation (3.9b) |
| 2 Nov 2025 | BigGuavaTrading (TradingView) | ["Launchpad & Slingshot"](https://www.tradingview.com/script/fXVC2e6a-Launchpad-Slingshot/) | Credits "Scot1and's bullish pattern"; adds a bearish mirror on a 4-day EMA of the lows |
| 2 Nov 2025 | UCT Sunday Scans | [sunday-scans-b99](https://unchartedterritoryy.substack.com/p/sunday-scans-b99) | Names the Slingshot among Manrav's daily setups |
| 2 May 2026 | Scot1and, TraderLion podcast (2025 conference session) | [Podscan episode page](https://podscan.fm/podcasts/the-traderlion-podcast/episodes/the-8-pivot-lessons-that-will-change-how-you-see-charts-forever-from-pro-trader-scot1and) | Restates the 4-EMA-of-highs crossover; says he has since moved toward price pivots |

**Other names.**
- **"Thrust"**: Scot1and's own name for the indicator line, "my "Thurst" indicator" [his spelling], in October 2015.
- **"SS"**: the short label in BigGuavaTrading's script.
- UCT uses only "Slingshot" (the journal tag, the Model Book card, the scanner).
- **Not the same setup, and older**: Chris Moody's "CM Sling Shot System" on TradingView is dated 8 Oct 2014, ten
  months before Scot1and's post, so the name was already in use for something else. Moody's page says he coded a
  system sold elsewhere and gives it away: "a system that consists of a couple of EMA's and a few Rules"
  ([TradingView, 2014](https://www.tradingview.com/script/GE7tSQK1-CM-Sling-Shot-System/)). It is a
  two-moving-average pullback system (fast MA over slow MA, a close back over the fast MA). EltAlt's page: "This
  indicator modifies the SlingShot System by Chris Moody"
  ([TradingView, 2022](https://www.tradingview.com/script/b6xaJlaf-AMASling-All-Moving-Average-Sling-Shot/)). Nothing
  I found says Scot1and took the name from it. Several forex pages also use "slingshot" for unrelated rules. A lesson
  should say which Slingshot it means.

**Sister setup.** Scot1and pairs the Slingshot with his **Fishhook**, his setup for the first week after a big
high-volume move. In his words: "The Fishhook was designed for Week 1 moves.   Power move rest two days and boom!" and
"The fishhook buys on confirmation when the first day high is taken out.  The Slingshot buys lower when the 4EMA is
reclaimed." ([17 Aug 2015](http://educsos.blogspot.com/2015/08/introducing-slingshot.html)). The Fishhook is his own:
"Last year I worked out a setup I call the fishhook, which is designed to catch the power moves off a significant
event." (["Review of Muathe .com"](http://educsos.blogspot.com/2018/01/review-of-muathe-com.html), dated 1 May 2017 on
the page). He ties it to earnings: "Then the fishhook, great for earnings plays."
([10 May 2017](http://educsos.blogspot.com/2017/05/setups.html)); and, in the 2026 podcast's machine transcript, "Fish
Hook is my, really my gap setup". This matters for UCT, because the owner uses the Slingshot mostly to enter power
earnings gaps (section 6.2), which is the Fishhook's ground in Scot1and's system. See 3.12.

**Who influenced Scot1and.** His blog labels include "Stock Bee", "Jesse Stine" and "Big Gain Hunting". He was a
paying Stockbee member: "I followed his free blog for over a year before taking the plunge and becoming a member."
(["Review of www.Stockbee.biz"](http://educsos.blogspot.com/2015/04/the-trading-websites-i-subscribe-to-and.html),
18 Apr 2015, four months before the Slingshot post). In a reply on a 2014 post he cites them: "Jesse Stine and StockBee
explained that some of their best trades came from stocks like BOOM" (his reply of 15 Sep 2014 under
["Fishhook Update"](http://educsos.blogspot.com/2014/09/fishhook-update.html), 14 Sep 2014). His "power" scan was a
3-year RSI high: "That is the Scan for the 3 year RSI high."
([5 May 2015](http://educsos.blogspot.com/2015/05/how-i-set-up-my-charts-and-momentum.html)).

## 3. Every definition, source by source

### 3.1 Scot1and, "Introducing the Slingshot" (17 Aug 2015): the first version

- **Origin**: "Over the weekend, I spent some productive time working out a new power setup with a couple of my trader
  friends." They were "fondly calling this setup the" Slingshot.
- **Prior trend and depth**: "This setup takes a stock that recently had a power move and has stretched back under the
  EMA 4 --- but not too far-- The EMA 9 should be the limit." He does not say whether this EMA 4 is of closes or highs.
  Two months later he moved to the highs (3.2), so this first version most likely used closes.
- **Trigger**: "When it gets pulled back through the green side of the EMA 4 it has accumulated power and is ready to
  go."
- **Entry timeframe**: "I'm a big fan of hourly charts. The weekly gives you the trend. The daily gives you the
  landscape, but it is the hourly that gives you the entry." He wants "a break of the downtrend channel" on the hourly,
  and admits a failed jumpy entry: "I'd be far better off waiting for 2 hour bars for confirmation."
- **Stop**: only that it is tighter than a breakout's ("tighter stops then waiting for a breakout").
- **Exit**: "After the Slingshot shoots, the EMA 4 should never be breached on a close.  Consider it the trailing stop
  on the position.  Of course, take profits on the way up."
- **Examples he names**: EFOI ("Only about 40% in the next 2 days"), TREE ("+20pt move and counting"), SPNS, EVHC.
  These are his anecdotes, not statistics.
- URL: http://educsos.blogspot.com/2015/08/introducing-slingshot.html

### 3.2 Scot1and, "Thrust--" (21 Oct 2015): the line moves to the highs

- "I'm working on refining the trigger for my slingshot setup." He combines it with his "Thurst" [sic] indicator: "-- a 4EMA
  of the HIGHS --".
- **Depth and length**: "This setup is to target a reversal of a shallow pull back.  I would consider any new thrust as
  anything more that 4 pull back bars." The second sentence is unclear (it may mean a cross after more than four pullback
  bars counts as a new thrust). I do not build a rule on it.
- URL: http://educsos.blogspot.com/2015/10/thrust.html

### 3.3 Scot1and, November 2015: "a range breakout" and the exact scan

- 8 Nov 2015: "It is a range breakout following a pullback in power stocks." The rest of the post is a video
  (YouTube id kyBfLsfFTbM) that YouTube now reports as unavailable.
- 27 Nov 2015, "New Slingshot Anticipation Scan", in TC2000 code (xavgh4 = the 4-period EMA of the high; c1, c2, c3 =
  the closes 1, 2 and 3 bars ago):
  - `"Slingshot =  c > xavgh4 and c1 < xavgh4.1 and c2 < xavgh4.2 and c3 < xavgh4.3"`. **This is the rule our scanner
    uses (S1 + S2 in section 5).** So the condition of three closes under the line is the originator's own, not a script
    writer's (an earlier house note, `docs/study/levels/external_research.md`, said it came from a script).
  - Liquidity: `"Liquidity is true = minv3.1 >=55000   -- Personal preference"` (the lowest volume of the last three
    bars, from one bar ago, at least 55,000 shares). Our scanner's S4 has the same shape with 100,000.
  - Compression before the trigger, from a friend: "We talked about combining a Slingshot in the current bar with a ROC
    of +/- 2 in the preceding bar." His version of the ROC: `"ROC (my work around TC2k Limitations) = ((C1/c6)-1) *100"`
    (the 5-bar rate of change, as of the prior bar).
  - A trend filter: "Wilder RSI > 51 weekly". His friend "also conditions a ROC of >15 in the prior 21 bars"; Scot1and
    says his coding knowledge was more limited, so he used the weekly RSI over 51 in its place.
- URLs: http://educsos.blogspot.com/2015/11/slingshot-setup-described.html ;
  http://educsos.blogspot.com/2015/11/new-slingshot-anticipation-scan.html

### 3.4 Scot1and, "Slingshot Refresher." (11 Oct 2016) and his exit reply

- **Theory**: "The theory behind this setup is that we take a powerful stock and stretch it with pull back.  Then when
  momentum resumes we enter."
- **Power (the prior trend)**: "Power can be found using a variety of scans.  52 Week high, RSI, High OBV, high Mdt.
  High RS compared to the S&P.  Feel free to use your favorite."
- **Trigger**: "The resumption of the momentum for the slingshot is triggered by the break of the 4EMA of the HIGHS."
  He says "break", not "close". Intraday or close is not stated in this post.
- **Exit** (his reply to a reader, 16 Oct 2016): "I like to sell a portion of my position early into the advance, which
  lets you hold the remainder longer. Then I use trendlines, as long as the market is not giving distribution days, I
  will hold the positions"
- URL: http://educsos.blogspot.com/2016/10/slingshot-refresher.html

### 3.5 Scot1and, "Setups" (10 May 2017): the intraday Slingshot

- "The fishhook can be used with a 1/2 or hour slingshot as a trigger for an earlier entry.  The shorter the timeframe
  the more false positives there will be."
- The same post: "Then the fishhook, great for earnings plays."
- So the same rule runs on 30-minute and hourly bars as an entry trigger inside a daily setup.
- URL: http://educsos.blogspot.com/2017/05/setups.html

### 3.6 Scot1and's write-up "THE SLINGSHOT", as quoted by TaPlot (TradingView, 29 Nov 2021)

TaPlot's script page says "Slingshot concept was created by Scot1andT" and "Below is HIS explanation". I could not find
where Scot1and first published this text (the cold check's searches for its opening sentence found only TaPlot's page
and its language mirrors), so it is a secondary copy of the originator's words.
- **The aim**: "Wouldn't it be great if you could buy a powerful stock after a pullback just as the downward momentum
  stops and the stock begins going back up?" (the page uses a curly apostrophe).
- **The line**: "My Slingshot indicator is simply a 4EMA of the highs."
- **Prior trend**: "First, there must be upward momentum. A pull back in a stock in a downtrend is merely an opportunity
  to sell into strength. That's not what we want to trade." And: "Ideally, we want to find a stock that has recently
  made a strong move. – often following an earnings gap."
- **Shape**: "Tight trading ranges before the trigger are ideal for two reasons. It signals that the selling pressure
  is waning and perhaps, more importantly, it permits very tight stops."
- **Stop**: "I typically place my stop at the low of the slingshot day. Or at most, the bottom of the consolidation
  period. Stops should be tight, much tighter than a breakout."
- **Why**: "The advantage of the setup is that it provides a low risk entry with a tight stop."
- No targets, no volume rule, no pullback length.
- URL: https://www.tradingview.com/script/JJtDhJFF-TAPLOT-SlingShot/

### 3.7 Scot1and at TraderLion (2022 talk; 2025 session, podcast 2026)

- **2022.** TraderLion's YouTube description: "In this presentation, Scot shares his Fishhook and Slingshot trading
  setups and how he developed these trading edges and entry tactics." Timestamp "49:31 Slingshot Setup". Published
  2022-11-01, 1 hour 26 minutes. The page lists an English auto-generated caption track, but the track's address
  answered HTTP 404 to a plain download, so I have no rule from the talk.
- **2026 podcast (2025 conference session).** The episode description (written by TraderLion) lists "entering pullbacks
  with low risk before the breakout" and "12:23 - The Slingshot formula". The machine transcript's opening, in his
  voice: "So the slingshot, the way I defined it was I was essentially looking for a crossover, the 4EM of the highs."
  ("4EM" is the transcript's spelling.) He also says "moving averages are overrated" and that his method has moved
  toward price pivots. Only the first 20 transcript lines are public; the full transcript needs an account. The
  description's timestamps also list "17:39 - Slingshot examples & what is NOT a slingshot" (not in the public lines)
  and "22:32 - The Fishhook setup — trading EPs without buying the top".
- URLs: https://www.youtube.com/watch?v=hqIIzNgbIEY ;
  https://podscan.fm/podcasts/the-traderlion-podcast/episodes/the-8-pivot-lessons-that-will-change-how-you-see-charts-forever-from-pro-trader-scot1and

### 3.8 BigGuavaTrading, "Launchpad & Slingshot" (TradingView, 2 Nov 2025): script level

- "Draws from Scot1and's bullish pattern, which looks for price to remain below a 4-period EMA of highs for three
  consecutive bars (signaling a controlled pullback), then close above it (indicating rebound momentum)."
- Short mirror (the author's own addition): "This script symmetrizes it for bearish cases using a separate 4-period EMA
  of lows".
- "No additional filters like volume or momentum jumps are applied". Suggests "above 200-day MA for longs".
- URL: https://www.tradingview.com/script/fXVC2e6a-Launchpad-Slingshot/

### 3.9 Trade The System, "Slingshot Setup" (3 Jun 2016): anonymous blog, low weight

- "This Slingshot setup requires patience and you will have to wait for prices to pullback to a fast rising MA. I used
  8SMa in my example and my trader friend used 4 EMA."
- It ties the setup to catalysts: "This setup works on all stocks that have momentum, triggered by some catalysts like
  earnings."
- Useful only as evidence that the name and the earnings link were in circulation in 2016. Not a source for rules.
- URL: https://tradethesystem.wordpress.com/2016/06/03/slingshot-setup/

### 3.9b Deepvue Knowledge Base, "Technical Patterns" (published 3 Sep 2024, updated 19 Jun 2026): a 5-day EMA

Deepvue is a charting and screening platform (an established data source, below the originator). Its knowledge-base
page on its "Technical Patterns" indicator has a "Slingshot Pattern" entry. Added in the cold check; the first draft
did not have it.
- **Credit**: "The Slingshot setup, developed by Scot1and, is a strategy designed to capitalize on entering powerful
  stocks immediately after a pullback."
- **The line, and it differs**: "This setup is characterized by the price crossing above the high of the 5-day
  Exponential Moving Average (EMA) from the period under analysis." That is a 5-period EMA, not 4, and the wording
  ("the high of the 5-day ... EMA") does not say clearly that the average is taken of the highs.
- **Extra conditions** it lists: "Pullback: Look for a significant pullback in a stock that is generally strong and
  trending upward."; "Range Break: The stock should break out of its established trading range, signaling a potential
  resumption of the prior upward trend."; "Consolidation: Before making an entry, seek a period of consolidation in the
  stock's price." (the page uses a curly apostrophe).
- No pullback length, no stop, no statistics. Its "significant pullback" also sits against Scot1and's own "shallow pull
  back" (3.2). I give it as a second reading that disagrees on the period; the originator's posts and scan outrank it.
- URL: https://deepvue.com/knowledge-base/deepvue-custom-indicators-technical-patterns/

### 3.10 Pradeep Bonde (Stockbee): not a Slingshot source, but the likely model for two of our numbers

Our scanner's "strength day" (S3) and UCT's "trim into the next 3-5 day burst" look like Stockbee ideas. I found no
source that says UCT took them from him, so this is a resemblance, not a proven lineage. Two facts make it likely:
Scot1and was a Stockbee member before he published the Slingshot (section 2), and Manrav, the first UCT trader on
record with the setup, says stocks move in 3-5 day bursts (KB 10985, per the levels dossier).
- His 4% breakout scan: `"c/c1>=1.04 and v>v1 and v>=100000"` ([18 Nov 2015](https://stockbee.blogspot.com/2015/11/how-to-use-4-breakout-scan-to-make-money.html)).
  Our S3 is a close more than 4% over the prior close on volume over its 50-day average, within 25 sessions.
- Bursts: "Stocks move in momentum bursts of 3 to 5 days" ([21 May 2015](https://stockbee.blogspot.com/2015/05/how-do-stock-move-on-3-to-5-day-time.html)).
- His stop for a 4% breakout is the entry day's low: "That logically makes our stop the low of entry day."
- UCT's Sunday Scans calls Manrav "cut from the same cloth as StockBee" (section 6.1).
- Scot1and's own summary of the Stockbee "Momo Burst" (18 Apr 2015) lists "(4) a 3-5 day move" and, for risk, "(1)
  stops generally placed at the low of the day".

### 3.11 Comparison table

"-" = the source says nothing. UCT columns are summarised from section 6; the scanner column from section 5.

| Criterion | Scot1and Aug-Oct 2015 (first posts) | Scot1and Nov 2015-2017 (scan, refresher, Setups) | Scot1andT write-up (via TaPlot, 2021) | BigGuava script (2025) | Deepvue KB (2024, upd. 2026) | UCT team playbook (KB 15877) | The owner (rulings 2026-10-24/25) | Our scanner (`uct_slingshot.py`) |
|---|---|---|---|---|---|---|---|---|
| Prior trend | a recent "power move" | "a powerful stock"; any power scan (52-week high, RSI, OBV, RS) | "upward momentum"; "often following an earnings gap"; not a downtrend | - | "a stock that is generally strong and trending upward" | a 4%+ day on above-average volume within about 25 sessions, or a fast 20%+ run; price above or near the 50 SMA | a drive: "mostly" a power earnings gap, sometimes a strong rally; the gap day is never the trigger | a >4% up close on volume over its 50-day average on the trigger session or the 25 before it, or a >20% five-session run on the trigger session or the 5 before it; close over the 50-day SMA |
| The line | "EMA 4" (Aug); "a 4EMA of the HIGHS" (Oct) | 4-period EMA of the highs | "a 4EMA of the highs" | 4-period EMA of highs (adjustable) | "the high of the 5-day Exponential Moving Average" (5, not 4) | 4-period EMA of the highs | the 4-day EMA of the highs, drawn on every chart | EMA(high, 4) |
| Pullback length | - (Oct: "more that 4 pull back bars", unclear) | scan: the 3 prior closes under the line | - | 3 bars (default, adjustable) | - | three or more days | 3 to 7 sessions | the 3 prior closes under the line; no maximum |
| Depth | "not too far"; "The EMA 9 should be the limit" (Aug); "a shallow pull back" (Oct) | - | - | - | "a significant pullback" | - | about 5-12% (lesson) or 5-9% (rule record) | none |
| Shape | - | ROC +/- 2 on the bar before (compression) | "Tight trading ranges before the trigger are ideal" | - | "a period of consolidation" before entry | a tight pullback | tight and orderly, no outsized red bar, no volume spike | none (a "tight" label only) |
| Volume | - | liquidity: 3-day minimum volume 55,000+ | - | none | - | - | ordinary on the trigger (0.9-1.4x on his greats) | liquidity: 3-day minimum volume >100,000 |
| Trigger | price "pulled back through the green side of the EMA 4"; hourly channel break | scan: the close; prose: "the break" of the line; "a range breakout" | - | the close | "price crossing above"; then a "Range Break" | the close back above the line | the first close back above the line, decisive, near the high, no gap | the close above the line |
| Entry | hourly, as it comes back through | intraday "break" or on the scan's close | - | the close | - | often intraday on the trigger day | not ruled | the trigger close |
| Stop | tighter than a breakout | - | "the low of the slingshot day. Or at most, the bottom of the consolidation period" | suggests testing "stops below recent lows" | - | prior-day low, low of day, or the bottom of the consolidation | not ruled | the trigger day's low (prior-day low as the alternative) |
| Targets / exit | trail: no close under the EMA 4; take profits on the way up | sell a portion early; trendlines while no distribution days | - | - | - | trim into the next 3-5 day burst | not ruled | 2R and 3R; trail under the 10-day or each higher low (narrative) |
| Timeframe | daily setup, hourly entry | daily; half-hour or hourly as an early trigger | - (not stated) | daily or intraday ("Default settings suit daily/intraday charts") | - | daily | daily | daily |
| Short version | - | - | - | yes (4-EMA of lows) | - | - | - | none |

### 3.12 Where they disagree

1. **The line itself.** Scot1and's first post (Aug 2015) used an "EMA 4" with the "EMA 9" as the depth limit. From Oct
   2015 on, Scot1and's own posts, scan and podcast, the TaPlot copy, the BigGuava script and UCT all use the 4-period
   EMA of the HIGHS. Two outside pages differ: Trade The System's friend used a "4 EMA" (of what, not said), and
   Deepvue's knowledge base describes a 5-day EMA (3.9b). The originator's 4-period EMA of the highs is the one to
   teach.
2. **Close or intraday break.** Scot1and's own scan uses the close (c > xavgh4); his prose says "break" and "range
   breakout", and he entered on hourly bars. UCT's team playbook says it is often entered intraday on the trigger day;
   Manrav's summary slide (per the levels dossier) wants a range break after the cross, and Deepvue lists a "Range
   Break" among its conditions. The owner's definition and our scanner use the close.
3. **How long the pullback is.** The scan needs at least three closes under the line and sets no maximum. The owner's
   best charts had 3 to 8 by a strict count (VRT 8); his rule says 3 to 7. Scot1and's October 2015 line on "4 pull back bars" is unclear.
4. **How deep.** Scot1and 2015: no deeper than the 9-day EMA, "a shallow pull back". Deepvue: "a significant
   pullback". The owner's lesson text: about 5-12%; the owner-rule record (`spot.fixtures.jsonl` #23): 5-9%. Our
   scanner: no limit.
5. **What counts as "power".** Scot1and: any strength scan (new highs, RSI, RS). The TaPlot write-up: "often following
   an earnings gap". The owner: mostly a power earnings gap. Our scanner: a 4% day on volume or a 20% run.
6. **Earnings gaps: Slingshot or Fishhook?** In Scot1and's system the first days after a big gap belong to the
   Fishhook (bought over the first day's high after a two-day rest; "great for earnings plays", 2017; "really my gap
   setup", 2026 transcript); the Slingshot is the lower entry on a later pullback. The owner calls the Slingshot "mostly" the way into a PEG after its first pause. They meet in the middle:
   with three closes under the line required, a two-day rest cannot be a Slingshot.
7. **The stop.** Trigger-day low (Scot1and via TaPlot, our scanner) versus the prior-day low or the pullback low (UCT
   playbook; Scot1and's "at most"). Section 4.3 measures all three.
8. **Selling.** Scot1and 2015: trail on any close under the 4-day EMA; Scot1and 2016: sell a portion early, then
   trendlines; UCT playbook: trim into the next 3-5 day burst; the house rulebook: thirds at 3R and 5R, trail the rest
   under the 10-day or 21-day. These are different holding periods.
9. **Liquidity.** Scot1and 55,000 shares (2015, "personal preference"); our scanner 100,000 shares and $5; the house
   rule $10 and $20 million a day (B23).

## 4. Measured evidence

### 4.1 Published statistics: none found

- **The originator published no statistics.** His posts give anecdotes: EFOI "Only about 40% in the next 2 days" and
  TREE "+20pt move and counting" (17 Aug 2015). These are chosen winners, not a test.
- **The script pages publish none.** TaPlot and BigGuavaTrading describe the rule only. BigGuava suggests the reader
  "backtest entries with stops below recent lows" and reports no result.
- **No educator or data source I could reach has measured the "Slingshot".** The cold check searched: a search for
  thepatternsite.com and "slingshot" returned no page from that site, and Bulkowski's home page lists no Slingshot
  (its footer carries a notice against using the site to train AI systems; it was read through a fetch tool only,
  because the site refuses plain downloads, so I do not quote the notice word for word); a
  search restricted to investors.com and StockCharts ChartSchool returned nothing from either; no TraderLion written
  article on the setup turned up. Deepvue's knowledge base describes it but gives no numbers (3.9b). MarketSmith was
  not searched. An earlier house sweep reached the same answer: Slingshot is listed among "Setups with no published
  number at all" (`docs/superpowers/research/setups/g1-setup-research-report.md`).
- **The nearest published number is not about this setup**: Stockbee's momentum bursts, "In 3 to 5 days they can go up
  8 to 40%" ([21 May 2015](https://stockbee.blogspot.com/2015/05/how-do-stock-move-on-3-to-5-day-time.html)), describes
  momentum bursts that start with a range expansion, the move his 4% breakout scan is built to catch. It is a range,
  not a measured average.

### 4.2 Our earlier replays on chosen charts (house files)

`docs/study/levels/evidence.md` (40 bank examples: 16 kept, 10 cut, 14 unreviewed, per the levels dossier) and `docs/study/levels/evidence_kept.md` (the 16
the owner kept). Entry at the trigger close, stop at the trigger day's low:
- All 40: median risk 4.9%; the first stop was hit at some point in 60 sessions on 45%; 2R was reached first on 78%,
  3R on 72%; median +12.0% after 20 sessions.
- The 16 kept: risk 4.8%; stop hit 31%; 2R 94%; 3R 94%; median +9.7% after 20 sessions.
- **Limit, stated in those files**: the examples were chosen to work (the levels dossier: "no close under the trigger
  day's low within 20 sessions"; the finder's current version is stricter, the next 20 sessions' lows staying at least
  2% above the trigger low), and `evidence_kept.md` says: "They were still chosen to work, so a stop at the setup day's
  own low looks good partly by construction." These numbers describe the teaching gallery, not the setup.

### 4.3 Our own test on every firing (new, for this dossier; not a published statistic)

**What I did.** A script in my scratch folder (not in the repo) ran the app's own rule, `uct_slingshot.evaluate`, on
every daily bar of the sandbox bars database (3,727 tickers with at least 400 daily bars at the time of the run,
split-adjusted, data to 2026-11-06, read only), for trigger dates 2010-01-04 to 2026-07-15. (Cold check: the same
database has since been refreshed, 3,874 tickers with 400+ bars and data to 2026-11-09, so a full re-run today would
differ slightly; a re-run of the script on its first 40 tickers gave 966 firings on 25 tickers, every one identical to
the original output, trade by trade.) It kept the house universe (B23: close $10 or more
and a 50-day median dollar volume of $20 million or more): **86,512 firings in 2,357 tickers.** On each it played the
house trade:
- **Entry**: the trigger day's close (a market order near the close, E57).
- **Stop**: 3 cents under the trigger day's low (F62). A gap open under the stop exits at the open (daily bars cannot
  apply B20's 30-minute rule). A bar that touches both the stop and a target counts as the stop.
- **Management**: stop to breakeven once 2R is touched (B19); a third at 3R and a third at 5R, at the open if it gaps
  past (E51, F63); the last third out on the first close under the 21-day EMA, **a trail that only starts once 5R has
  been reached** (E52, steadier; a 10-day EMA version was also computed and averaged within 0.02R of it on every Table A
  group, scratch output only); before 5R the remaining shares stay on the stop or the breakeven stop; under 1R at the 10th
  session's close with no trim, sell (C33); 120-session cap, then out at that close.
- **Baseline**: one in 25 of all days on which a stock in the same universe closed up, in the upper half of its
  range, over its 50-day and 200-day SMAs, traded the same way with a stop under that day's low. It shows what the
  same trade mechanics earn without the setup.
- **The owner's shape** (group C) = the firing is over the 200-day SMA; the pullback had 3 to 7 closes under the line
  and was 5-12% deep (from the highest high of the pullback and the 3 bars before it, to the lowest low through the
  trigger); the trigger opened less than 2% over the prior close and closed in the top 30% of its range; a strength
  day came before the pullback began; and the trigger day was not an earnings gap day.
- **Earnings-gap drive** (group D) = an open 5% or more over the prior close on a report date (or the session after)
  in the 25 sessions before the trigger, using `docs/study/setups/earnings_dates_cache.json` (the cache lists 992
  tickers; 983 of the 2,421 tickers that gave a firing or a baseline day are covered; report timing before or after
  the bell is not recorded, so both days count).

**Limits, read these first.** The tickers are names in the database today, so stocks that died are under-represented
(survivorship); the baseline has the same bias, which is why it is there. No commissions or slippage. Daily bars only:
no intraday entry, no B20. No RS filter (C31) and no market reading (F65) were applied, because the database has no
point-in-time RS rank; those two house rules would remove some of these trades. Trades overlap in time, so the
95% ranges below are month-clustered bootstrap ranges (400 draws), which are wider and more honest than plain ones.
One run, no out-of-sample split. Treat every number as a rough guide for the owner's decisions, not a lesson fact.

**Table A. Entry at the trigger close, stop 3 cents under the trigger day's low.** **Stop hit** = the first stop was
traded at some point in 60 sessions (even after a gain). **2R, 3R, 5R** = reached that multiple before the stop. **Mean R** =
the average result per trade under the house management above, in R; **95% range** = month-clustered bootstrap.

| Group | Events | Median stop | Stop within 3% | Stop hit | 2R | 3R | 5R | Mean R | 95% range | Winners |
|---|---|---|---|---|---|---|---|---|---|---|
| A. Every detector firing (house universe) | 86,512 | 3.0% | 49% | 83% | 31% | 21% | 13% | +0.05 | -0.02 to +0.11 | 30% |
| B. A, over the 200-day SMA (B26) | 65,946 | 3.0% | 51% | 83% | 31% | 21% | 13% | +0.05 | -0.02 to +0.11 | 30% |
| C. B + the owner's shape | 14,963 | 3.2% | 45% | 84% | 30% | 20% | 12% | +0.02 | -0.05 to +0.10 | 29% |
| D. C + an earnings-gap drive | 1,357 | 3.0% | 50% | 85% | 28% | 18% | 12% | +0.05 | -0.09 to +0.18 | 29% |
| E. C, covered names, no earnings drive | 8,273 | 3.2% | 46% | 83% | 30% | 20% | 12% | +0.05 | -0.02 to +0.12 | 30% |
| F1. C, stop within 3% | 6,728 | 2.2% | 100% | 88% | 33% | 22% | 13% | -0.03 | -0.11 to +0.06 | 25% |
| F2. C, stop wider than 3% | 8,235 | 4.3% | 0% | 81% | 29% | 19% | 11% | +0.07 | -0.01 to +0.14 | 33% |
| G. B, no pullback close under the 9-day EMA (my reading of Scot1and's 2015 depth limit) | 18,439 | 2.5% | 62% | 85% | 31% | 21% | 13% | +0.02 | not run | 28% |
| B, trigger day up 6% or more | 11,903 | 6.2% | 10% | 76% | 27% | 18% | 12% | +0.11 | +0.03 to +0.18 | 35% |
| B, trigger day up less than 3% | 30,859 | 2.0% | 85% | 88% | 33% | 22% | 13% | +0.00 | -0.06 to +0.06 | 26% |
| Baseline: up days over the 50 and 200 | 31,795 | 1.5% | 85% | 88% | 32% | 22% | 14% | +0.00 | -0.06 to +0.05 | 26% |

Across all firings the average winner was +2.3R and the average loser -0.9R. How the 86,512 trades ended: the first
stop 49% (41,961 trades, 48.5%), breakeven 15%, the 10-day time stop 14%, the trail 11%, a gap through the stop 11%,
the 120-session cap 0.3% (recounted from the raw output in the cold check).

**Table B. The entry and the stop, on group C.**

| Entry, stop | Trades | Median stop | Stop within 3% | Stop hit | 2R | 3R | Mean R |
|---|---|---|---|---|---|---|---|
| Trigger close, trigger day's low | 14,963 | 3.2% | 45% | 84% | 30% | 20% | +0.02 |
| Trigger close, the lower of the trigger and prior day's lows | 14,963 | 4.7% | 14% | 77% | 24% | 16% | +0.04 |
| Trigger close, the pullback's low | 14,963 | 6.0% | 2% | 72% | 18% | 12% | +0.05 |
| Next 3 sessions, a cent over the trigger day's high, trigger day's low | 11,701 | 4.0% | 28% | 81% | 28% | 18% | +0.04 |
| Same entry, the lower of the two lows | 11,701 | not kept | - | 74% | 21% | 14% | +0.05 |

The next-day entry filled on 11,701 of 14,963 (78%); 131 were skipped as a chase of more than 4% (C28); the rest never
traded over the high within 3 sessions, or broke the stop first.

**Other cuts on group C** (full tables in the scratch output): by pullback length, 3 closes +0.03R, 4-5 closes +0.03R,
6-7 closes +0.02R; by depth, 5-8% -0.01R, 8-12% +0.08R; by market, SPY over its 50-day and 200-day +0.02R (11,320
trades), SPY under its 50-day +0.10R (2,729); by period, 2010-14 -0.03R, 2015-19 +0.02R, 2020-22 +0.02R, 2023-26
+0.05R. None of these differences is outside the noise.

**What the test says.**
1. **The mechanical rule, traded the house way, is about break-even before costs**: +0.05R a trade, with a 95% range
   that includes zero, against +0.00R for the plain up-day baseline. The firings beat the baseline by a few hundredths
   of an R, not a meaningful edge.
2. **The owner's shape filter does not raise the average** (+0.02R), and the earnings-gap drive does not beat the
   rally drive (+0.05R each). His gallery charts were chosen for how they look and for what happened after; the test
   cannot see what made him pick them, and it has no RS or market filter.
3. **Tight stops are not better here.** Firings whose trigger-low stop was within 3% did slightly worse (-0.03R) than
   wider ones (+0.07R), and were stopped more often (88% vs 81%). Neither is clearly different from zero.
4. **Strong trigger days did best**: a trigger day up 6% or more averaged +0.11R, the only group whose range stays
   above zero. That is the opposite of the owner's taste for quiet triggers (he graded APP's +13% day "good" and
   PAAS's +11% day "okay"). One test, so a question for him, not a rule (section 10).
5. **Most trades never reach a trim**: 3R came first on about 20%, 5R on about 12%. With the house plan the result is
   driven by many small losses and a few large winners (average winner +2.3R). Because the trail starts only at 5R,
   a trade that reached 3R but not 5R kept two thirds on a breakeven stop; a different trail would change these
   averages.

**Scripts and outputs** (scratch, not in the repo): `setups/31-slingshot/scripts/measure_sling.py`,
`analyze_sling.py`, `ci_sling.py`, `owner_examples.py`; outputs `setups/31-slingshot/out/analysis.md`, `ci.txt`,
`owner_examples.md`.

## 5. Our app

### 5.1 The scanner: `api/services/pattern_engine/detectors/uct/uct_slingshot.py`

Pattern id `uct_slingshot`, name "UCT Slingshot", long only. Its helpers are in `uct_setups_common.py`, whose docstring
calls these detectors "ports of an offline lab study"; the slingshot's own docstring says the rules are "the scan kept
after blind adjudication" and credits S5 to "the blind review: 52% -> 94% precision". That lab study is not in this
repo, so I cannot check its numbers.

**It fires on session i when all of these hold** (variant `v1_strength_day` if S3 holds, else `v2_run_20in5`):
- **S1**: close > E4H, where E4H = EMA(high, 4), seeded on the first bar (`U.series`).
- **S2**: each of the three prior closes was below its own E4H. Nothing is checked before that, so a pullback of 3,
  8 or 20 closes all qualify, as long as session i is the first close back above.
- **S3** (or S3b): a "strength day" on session i **itself** or any of the 25 sessions before it: a close more than 4%
  over the prior close, on volume above its 50-day average (a simple average that includes that day). **S3b**: on
  session i or any of the 5 before it, a close more than 20% over the close five sessions earlier, price over $5, and
  the lowest volume of that day and the two before it over 300,000 shares. The constant is named `_SLING_GAP`, but it
  tests a close-to-close gain, not an opening gap.
- **S4** (liquidity): close > $5 and the lowest volume of the three prior sessions > 100,000 shares. The engine-wide
  `liquidity_floor` adds price >= $2 and a 20-day average dollar volume >= $10,000.
- **S5**: close > the 50-day SMA (the code flag `SLING_REQUIRE_ABOVE_SMA50 = True`). **There is no 200-day test.**
- It examines the latest session and the two before it (`MAX_TRIGGER_AGE = 3`, offsets 0 to 2), reports the newest
  that qualifies, and skips one that a later bar has already traded under its stop.
  The confidence floor (50) can never bind here: the lowest possible score is 55.5 (geometry at least 75, because the
  `trend` extra is always true; volume and context floored at 40; history fixed at 50).

**Labels only** (never a reason to fire): `tight_pullback` (the three prior sessions' range within 1.5 ATR),
`stack_kicker` (a Kicker on the same session), `stack_hve_close` (a high-volume-edge close within 1 ATR below price in
the last 25 sessions), `v2_run_20in5`, `cross_only`.

**The trade it hands out**: entry = the trigger close; stop = the trigger session's low, exactly (the prior session's
low is recorded as `alt_stop_prev_day_low`); targets at 2R and 3R (`U.make_levels`). The narrative tells the member to
expect follow-through "within one to three sessions", to trail "under the 10-day average or under each higher low",
and not to re-enter the same pullback repeatedly.

**Other app surfaces with their own Slingshot rule.**
- **The member setup tag** (`api/services/setup_tags.py` + `api/services/pattern_engine/tag_textbook.py`): the tag
  text says "The first close above the 4-day EMA of the highs after three or more closes below it, in a stock above its
  50-day average." The textbook check then keeps the tag only if the close is over a rising 50-day SMA that is itself
  over the 200-day SMA, and the day closes green (close > open). Its docstring reports a blind-judged score of 2.86 for
  the Slingshot tag (round 1). **So the member tag already demands the 50 over the 200; the detector does not.**
- **The Study trade plan** (`api/services/study_trade.py`, mirrored in `docs/study/TRADE_PLANS.md`): entry "the close
  back over the 4-day average of the highs", stop "the trigger day's low (the day before's low is the wider choice)",
  trail "under the 10-day average, or under each higher low", trims at 2R and 3R.
- **The example finder** (`scripts/study/find_slingshot_examples.py`): the detector as a gate, then the owner's
  definition scored on top ("gallery score v3"), a $10 and $20 million liquidity floor, and a must-work filter that
  looks at the next 20 sessions (every low at least 2% above the trigger low, at least +8% at the best, +3% after five
  sessions, and higher than the trigger close after 10 and after 20 sessions). The
  must-work filter is right for choosing teaching charts and wrong for measuring the setup (it removes the losers).
- **The chart overlay** (`app/src/pages/study/slingshotOverlay.js`, per `docs/study/RESUME.md`): the E4H drawn in
  translucent gold on every Slingshot item, as the owner asked.

### 5.2 Where the app disagrees with the sources or looks wrong

Numbers in brackets come from the test in section 4.3 (share of all detector firings in the house universe).
1. **The trigger day can be its own strength day.** S3's window ends at session i, so a 4% earnings-gap day that also
   closes back over the line passes. The owner ruled "And no an earnings gap does not count btw" and cut MSFT and GOOGL
   2022-07-27 for exactly this. [13% of firings have no strength day other than the trigger.]
2. **Five of the six "positive" test fixtures are charts the owner rejected.** `tests/fixtures/uct_slingshot/pos_1`
   (AAPL 2022-11-30), `pos_2` (MSFT 2022-07-27), `pos_3` (NVDA 2022-07-27), `pos_5` (META 2022-08-10) and `pos_6`
   (GOOGL 2022-07-27) are all listed as "Cut" in `docs/study/corrections/spot.fixtures.jsonl` line 7 (downtrend
   bounces, or the earnings gap day as the trigger). Only `pos_4` (AMZN 2022-08-10) was kept, provisionally. The tests
   therefore lock in behaviour the owner ruled out.
3. **No 200-day rule**, against the hard house rule B26. [24% of firings were under the 200-day SMA.] The
   member tag (5.1) is stricter than the detector here.
4. **No maximum pullback length, no depth limit, no tightness rule.** The originator wanted a "shallow" pullback, no
   deeper than the 9-day EMA (2015) and tight ranges (TaPlot copy); the owner wants 3 to 7 sessions and about 5-12%.
   [34% of firings came after more than 7 closes under the line; 23% after a pullback deeper than 12%.]
5. **Nothing about the trigger day's quality.** The owner's best triggers closed near the high with no gap; the
   detector accepts a gap and a weak close. [20% gapped up 2% or more; 17% closed in the lower 70%
   of the day's range.]
6. **Liquidity is far below the house floor**: $5 and 100,000 shares, against B23's $10 and $20 million a day. (The
   finder adds the house floor; the detector, and so the live scan, does not.)
7. **The stop sits exactly on the low**, not a few cents under it (F62). **The targets are 2R and 3R**, not the
   house's thirds at 3R and 5R (B19, E51). `sizing_rule.md` §9 B19 already says the rulebook replaces the setup
   plans' 2R/3R.
8. **Dead labels.** `cross_only` is documented as "first close over E4H after a single close below it", but it is
   computed only after S2 has passed, so it is set on every firing and means nothing. The `trend` extra is always true
   (S5 already requires close > SMA50), so the +5 it adds to the geometry score is a constant. `intraday_trigger` is
   documented as a label that "never fires here". Harmless to members, misleading to a reader of the code.
9. **Unsourced narrative claims.** "Follow-through should come within one to three sessions" has no source I could
   find (the closest is Stockbee's 3-5 day burst, which is about breakouts, not Slingshots).
10. **The originator's scan is the rule, and the house record says otherwise.** `docs/study/levels/external_research.md`
    says the three-closes condition "comes from a script, not the originator". Scot1and's own 27 Nov 2015 TC2000 scan
    has it (3.3). That note should be corrected.
11. **The Model Book glyph draws the wrong line.** `setupCatalog.js` gives the Slingshot card `ema: 3`, and
    `SetupsView.jsx` draws that as a 3-period EMA of the CLOSES (`v = d.c * k + ...`), not the 4-period EMA of the
    highs the card's own text names. An earlier sweep (`docs/superpowers/research/setups/setup_criteria.json`) read the
    3 and the 4 as a disagreement about the window; it is a drawing shortcut, but a member sees the wrong line.

### 5.3 The Model Book card, the playbook and the journal tag

- **Card** (`app/src/pages/modelbook/setupCatalog.js`), family "Reversals & Reclaims", long: "An earnings gapper or
  strong rally, a tight pullback with the closes under the 4-EMA of the highs, then the first close back over it. The
  gap day is never the trigger." This matches the owner's rulings. The glyph's ten candles are four up days, three red
  days, a small up day, a wide +5% day and a final +3% day (the file's convention makes the last candle the trigger);
  no candle has a gap, so it shows no gap drive. The family label "Reversals & Reclaims" is arguable: the sources
  describe a continuation (Scot1and: "when momentum resumes"; Deepvue: "a potential resumption of the prior upward
  trend"), and the scanner narrative says "The setup is a continuation trade".
- **Playbook** (`app/src/pages/modelbook/setupPlaybooks.js`, the "Slingshot" entry): written from the owner's rulings.
  It says "The 200-day is not required; a recovery off a long downtrend can qualify", which now conflicts with B26
  (section 7). Its stop is "The trigger session's low". Its exit section has no trims or trail. Its mistakes list
  includes "Buying the earnings gap day itself as the Slingshot" and "Buying a trigger day that gaps up 2 or 3 percent".
- **Journal tag** (`app/src/constants/setupGroups.js`): "Slingshot" in the Swing group, one tag, no variants. A trade
  cannot be tagged PEG-driven or rally-driven, which matters if the owner wants to compare them (section 10).
- **Bank lesson text** (`docs/study/bank/spot.setups.json`): "a tight orderly pullback of three to seven sessions, about
  5-12% deep" and "the 200-day is not required (owner rulings 2026-10-24/25)". The owner-rule record
  (`spot.fixtures.jsonl` line 23) says "a tight 3-7 session pullback of 5-9%". The two house texts disagree on depth.

## 6. UCT's own words

### 6.1 The Substack

I downloaded all 103 posts in the sitemap (`https://unchartedterritoryy.substack.com/sitemap.xml`, read 2026-11-09) and
searched their text for "sling". **One post mentions it**: Sunday Scans, 2 Nov 2025, in the shout-out to Manrav
([sunday-scans-b99](https://unchartedterritoryy.substack.com/p/sunday-scans-b99)):
- "He practices what he preaches and trades extremely repeatable trading setups on a daily basis. If there is a
  Launchpad, Slingshot, HVC edge, or Oops Reversal he will be slapping it."
- "These setups I have adopted and use consistently in my trading and the results have shown."
- "He is a student of the market that is cut from the same cloth as StockBee, Mike Webster, and Ameet Rai."

The post's byline is "Uncharted Territory"; the writer says "We have been trading together since 2022" but does not
sign the section. The byline's own profile text, on the post page, names Manrav as one of the room's four runners: "A
live trading room on Discord, run by Patrick (TSDR), Bracco, EliteSwingTraders, & Manrav." Bracco's "The Parabolic
Short" does not mention the Slingshot. The scans are mostly images; a Slingshot drawn on a chart image would not show up
in a text search. One post (`sunday-scans-bf1`, 18 Oct 2026) is for subscribers only, so only its public part was
searched. (Cold check: all 103 posts re-downloaded and searched again for "sling", "4EMA", "4 EMA", "EMA of the high",
"Scot1and" and "Fishhook": the same single hit.)

### 6.2 The owner's rulings

From `docs/study/audits/2026-10-24/owner_verdicts.jsonl` (passes 1 and 2, 2026-10-24/25) and
`docs/study/corrections/spot.fixtures.jsonl` (lines 7, 8 and 23). Exact words:
- **What it is for**: "Yeah so a slingshot is supposed to be used for an earnings gapper, strong stock, or
  consolidation after a nice uptrend" and "And no an earnings gap does not count btw" (on the MSFT and GOOGL gap days).
- **The order**: "Yeah these are not slingshots.. it should be after a good rally to the upside and consolidation or
  after an earnings gapper and consolidation"
- **PEGs**: "Meant to be used to enter PEGS mostly but not", then, on the same chart (COIN 2023-11-15, a rally, cut):
  "Not exclusively to PEGs but still good, I don’t want to keep this"
- **The line on the chart**: "Perfect. Btw for these I want the 4EMA on the chart so we can see exactly where and when
  the slingshot triggered and why." (VRT 2023-08-21) and "Good, but make the 4EMA a little more opaque vs so solid and
  dominate the chart." (APP 2024-09-11)
- **The bar for the gallery**: "Pass I want them to look like the ones I labeled perfect or beautiful" (RTX) and "I
  mean, these are slingshots so I can’t say no, but I think they can look prettier" (XOM).
- **His models**: SMCI 2023-05-16 "A+, perfect example here"; VRT 2023-08-21 "Perfect."; PLTR 2024-10-03 "Beautiful,
  yes."; NVDA 2024-03-01 "This one is very good yes"; NFLX, SOFI and QCOM "Keep, great".
- **Under the 200-day**: HAE 2026-06-04, "Yes I like this one". The reviewer's note says the trigger was under the
  200-day; see 6.3, the sandbox bars disagree.
- **Not yet ruled**: the entry (close, intraday or next day), the stop, the trims, the trail. The levels dossier
  (`docs/study/levels/dossiers/slingshot.md`) lists these as open.

### 6.3 His graded charts, measured

My script (scratch, read-only on the sandbox bars) on each chart he graded. "Stop" = the distance from the trigger close
to 3 cents under the low, as a share of the close. "n/a" = the sandbox lacks 200 sessions of history before that date.

| Chart (trigger day) | His grade | Closes under the line | Depth | Trigger day | Open gap | Close in range | Stop, trigger low | Stop, lower of the two lows | Over the 200-day SMA |
|---|---|---|---|---|---|---|---|---|---|
| SMCI 2023-05-16 | great ("A+") | 5 | 8.7% | +5.8% | 0.0% | 0.83 | 5.9% | 7.3% | yes, rising |
| VRT 2023-08-21 | great ("Perfect") | 8 | 11.7% | +3.2% | +0.7% | 0.89 | 4.1% | 7.8% | yes, rising |
| PLTR 2024-10-03 | great ("Beautiful") | 7 | 5.6% | +4.7% | -0.1% | 0.97 | 4.8% | 8.0% | yes, rising |
| NVDA 2024-03-01 | great ("very good") | 3 | 6.4% | +4.0% | +1.1% | 0.99 | 3.5% | 4.8% | yes, rising |
| NFLX 2023-05-26 | great | 4 | 5.7% | +5.5% | +0.6% | 0.82 | 6.1% | 6.1% | yes, rising |
| SOFI 2024-11-05 | great | 3 | 7.6% | +4.7% | +0.5% | 0.78 | 4.4% | 7.2% | yes, rising |
| QCOM 2021-11-15 | great | 3 | 6.2% | +2.2% | +0.9% | 0.65 | 1.6% | 2.5% | yes, falling |
| APP 2024-09-11 | good | 6 | 11.9% | +13.2% | +1.5% | 0.95 | 10.7% | 12.7% | yes, rising |
| TXN 2026-04-30 | good | 3 | 8.2% | +4.4% | +0.4% | 0.95 | 5.3% | 5.3% | yes, rising |
| HAE 2026-06-04 | good | 3 | 5.2% | +6.0% | +1.7% | 0.96 | 4.9% | 6.9% | yes, falling |
| SLB 2022-10-13 | good | 3 | 4.7% | +5.2% | -0.5% | 0.95 | 5.5% | 6.8% | yes, rising |
| DECK 2024-11-21 | good | 6 | 5.4% | +3.1% | +0.2% | 0.99 | 3.7% | 4.2% | yes, rising |
| PAAS 2025-12-09 | okay | 5 | 6.8% | +11.2% | +1.5% | 0.92 | 9.1% | 10.4% | n/a |
| BLDR 2021-11-16 | okay | 4 | 3.8% | +3.0% | +0.8% | 0.83 | 2.7% | 3.4% | yes, rising |
| XOM 2022-01-25 | okay ("can look prettier") | 3 | 6.1% | +2.9% | -0.3% | 0.92 | 4.8% | 6.9% | n/a |
| PANW 2024-02-02 | okay ("B-") | 3 | 4.3% | +1.5% | -0.1% | 0.82 | 1.8% | 2.8% | yes, rising |
| DUOL 2023-05-18 | cut | 4 | 7.9% | +6.7% | 0.0% | 1.00 | 6.3% | 7.2% | yes, rising |
| TCOM 2022-12-27 | cut ("Bad example") | 7 | 7.1% | +4.3% | +2.7% | 0.91 | 4.1% | 4.7% | n/a |
| COIN 2023-11-15 | cut (a rally, not a PEG) | 3 | 11.2% | +6.6% | +2.0% | 0.72 | 5.2% | 8.5% | n/a |
| BBWI 2024-01-02 | cut | 5 | 4.2% | +3.7% | -1.3% | 0.90 | 4.9% | 4.9% | yes, rising |
| CBZ 2021-12-22 | cut | 3 | 4.9% | +2.0% | -0.5% | 0.99 | 2.7% | 3.1% | n/a |
| RTX 2022-02-25 | cut | 10 | 7.9% | +4.1% | +0.1% | 0.96 | 4.0% | 9.0% | yes, rising |
| TEAM 2022-03-28 | cut | 3 | 10.4% | +6.4% | +0.9% | 0.93 | 5.2% | 9.1% | NO, rising |
| HAS 2023-02-02 | cut | 7 | 11.4% | +5.0% | +1.0% | 0.81 | 5.0% | 8.2% | NO, falling |
| FIGS 2023-01-03 | cut ($7 stock) | 19 | 27.1% | +7.7% | +2.2% | 0.71 | 5.5% | 9.7% | NO, falling |
| INTA 2023-03-06 | cut ("Eh") | 6 | 6.3% | +4.8% | 0.0% | 0.72 | 5.2% | 5.2% | yes, rising |

What this shows:
- **His greats are not tight-stop trades by the 3% house measure.** The trigger-day-low stop on VRT, NFLX, NVDA, SOFI,
  PLTR and SMCI was 3.5% to 6.1%; only QCOM (1.6%) was inside 3%. The prior-day-low stop is wider still (4.8% to 8.0%
  on the six). Section 7 takes this up.
- **Pullbacks of 3 to 8 closes, 5.6% to 11.7% deep** on the greats; VRT had 8 closes under the line, one more than the
  "3-7" in the house texts.
- **Every graded chart fires the detector**, cuts included. The detector cannot tell his greats from his cuts; the
  differences are the drive, the trigger day's quality and the follow-through (`docs/study/analysis/2026-10-25-setup-differentiation.md`).
- **HAE 2026-06-04 was over its 200-day SMA on these bars** (close 69.85, 200-day SMA 62.74, falling), not under it as
  the verdict note says. Either the note or these bars are wrong. Check on the pod's chart before B26 is applied to it.
  QCOM's 200-day was also falling. (Cold check, same bars: HAE close 69.85, 200-day SMA 62.74, 63.26 twenty sessions
  earlier; confirmed.)
- **TEAM 2022-03-28 was under its 200-day, but the 200-day was still rising** on these bars (close 302.31, 200-day
  340.47, up from 335.57 twenty sessions earlier; the 50-day was falling). The verdict note calls it "a bear-market
  bounce under a falling 200-day". HAS 2023-02-02 was under a falling 200-day, but its 50-day was rising slightly
  (61.44, from 60.94 ten sessions earlier). Both are under the 200-day, which is what B26 tests.

### 6.4 UCT traders (the brain's summaries, from the public KB extract and the levels dossier)

The UCT brain holds chat summaries from UCT's trader archive. The brain database itself is private; the rows below are
in the public extract `docs/study/levels/brain_kb_2026-11-06.json` (tracked in the repo) and the public levels dossier
(`docs/study/levels/dossiers/slingshot.md`, section 3). The cold check re-read each cited row in the extract.
- **Manrav's scan** (KB 11544, 2025-07-13/14): a 4% gap on above-average volume within the last 25 days, then a close
  over the 4-day average of the highs after three closes under it, "basically a delayed-reaction or pullback-buy setup".
  His summary slide adds confirmation as a range break after the cross, ideally after tightness. This scan appears
  to be the source of the scanner's S3 and its 25-session window (the scanner reads it as a 4% up close, not a gap).
  The row records his ThinkorSwim scan in the same notation as Scot1and's 2015 TC2000 scan (`c > xavgh4 and c[1] <`
  ...), so the three-closes rule reached UCT unchanged.
- **The TaPlot indicator in UCT** (KB 13266, AtTheAsk, 2025-09-11): another trader in the archive scanned for
  Slingshots with TaPlot's TradingView indicator ("TAPLOT SlingShot", filter Slingshot = True) and summarised the
  trigger as the close crossing above the 4-EMA of the highs after a tight pullback.
- **Wait for the cross** (KB 11964, 2025-10-05): he shared Scot1and's video: wait for price to trade back above the line
  rather than buying the first pullback day.
- **Stops** (UCT team playbook, KB 15877): the prior day's low or the day's low, or the bottom of the consolidation.
  Manrav (KB 12088, 2025-11-26): RUN and GEV with yesterday's low as the stop, about 9%.
- **Management** (KB 15877): trim into the next 3-5 day burst. **Adds** (KB 11726, 12088): with the 50-day SMA overhead,
  start on the Slingshot and add on the 50-day reclaim, or add on a pullback that holds the 50-day.
- **Stacking**: the playbook says it stacks with a launch pad, a high-volume close or a kicker; Manrav's chart notes
  pair it with a launch pad and with a Wedge Pop (KB 13488, 15454). The playbook row (KB 15877) also asks for "price
  above or near the 50 SMA".

These are machine summaries of chat, not the traders' own words. They rank below the owner's rulings.

## 7. How it fits the owner's account rulebook (section 9)

| Rule | What it says | Fit with the Slingshot |
|---|---|---|
| **B26** (hard) | no longs under the 200-day SMA, except a parabolic long | **Conflict with an earlier ruling.** The bank lesson and the playbook say "the 200-day is not required" (from HAE, 2026-10-25). B26 came later (2026-11-09) and is a hard rule; a Slingshot is not a parabolic long. I would apply B26 and fix those two texts, but it is his call (section 10). The detector has no 200-day test; the member tag does. [24% of detector firings were under the 200-day.] |
| **A13** | the stop usually within about 3% of the buy | **Natural conflict.** The originator's stop (the trigger day's low) was 3.5-6.1% on all six of his pass-2 greats (VRT, NFLX, NVDA, SOFI, PLTR, SMCI; only QCOM, a pass-1 "great", was inside 3%, at 1.6%; 6.3), and 51% of all firings had a trigger-low stop wider than 3%. A13 says "usually", not always, and A5 already shrinks the size for a wider stop. Options in section 10. |
| **A3, F62** | stop first, a few cents under the day's low or the prior day's low | Fits: the trigger day's low is the originator's stop. The detector should put it a few cents under. |
| **A4** | the stop only moves up | Fits. Scot1and's own trail (a close under the 4-day EMA) only moves up. |
| **E57** | market orders | Fits: buy at the market near the close on the trigger day, or with a market order when price takes out the trigger day's high the next day (a buy-stop that becomes a market order). |
| **C28** | no chasing more than 4% past the buy point | Matters for the next-day entry: skip if it opens more than 4% over the trigger day's high. With the close entry, the trigger close is the buy point. |
| **C29** | skip a long more than 10% above its 10-day average | Rarely binds: a Slingshot comes out of a pullback. [4% of firings.] It can bind after an explosive PEG whose pullback was shallow (my reading). |
| **B23** | $10 and $20 million a day | The detector's floor ($5, 100,000 shares) is far lower; the house floor must be added in the course rule. |
| **C31** | RS 80+ leaders | Fits the originator ("High RS compared to the S&P" is one of his power scans). The detector has no RS test. |
| **B19, E51, E52** | breakeven at 2R-5R; a third at 3R, a third at 5R, trail the rest under the 10-day or 21-day | Fits as the default. It differs from the originator (sell a portion early, then trendlines) and from UCT's playbook (trim into the next 3-5 day burst). B19 also records that the hard rule is a third at 3R but in practice he "mostly wait[s] for 5R". Section 4.3 measures how often 3R and 5R come. |
| **B20** | a gap through the stop: the first 30-minute low is the new stop; out past 2R | Applies as written. Daily bars cannot test it. |
| **B21, E56** | re-buy only on a new trigger; at most 3 tries a week, 6 a month | Fits the detector's narrative ("do not re-enter the same pullback repeatedly"). A failed Slingshot needs a new run of three closes under the line before it can trigger again. |
| **B22** | no new buys in the 3 days before earnings; hold through a report only if up 5R | Matters for rally Slingshots near a report. A PEG Slingshot is usually weeks from the next report. |
| **C33** | under 1R after 10 days, sell | Fits the playbook's "A trigger that fades to flat by day 20 was not a Slingshot worth keeping." |
| **D47** | shorts are the long setups reversed; only under the 200-day | A mirror exists in one script (BigGuava, a 4-day EMA of the LOWS). See 8.6. |
| **F65, B18** | the market reading sets how much to trade: Green full, Yellow smaller and fewer, Orange only A+, Red mostly cash and shorts | Fits Scot1and's own condition: hold "as long as the market is not giving distribution days". |
| **E50** | grading is discretionary | Section 9 gives observable cues only as a guide. |

## 8. Proposed rules for our course

Each line is measurable on a daily chart unless it says otherwise. Basis tags as defined at the top. Where sources
disagree I give the options and recommend one; every recommendation is for the owner to accept or change.

### 8.1 What it is

| # | Rule | Basis |
|---|---|---|
| 1 | **The line** is the 4-period EMA of the daily HIGHS, drawn on the chart. Not an EMA of closes, not a simple average. | [originator] (Oct 2015 post, Nov 2015 scan, Oct 2016 post, TaPlot copy) [source consensus] (the BigGuava script agrees; Deepvue's 5-day EMA dissents, 3.9b) [UCT] |
| 2 | **The drive comes first**: within the 25 sessions before the trigger, and before the pullback began, at least one of: (a) an earnings gap, the open 5% or more over the prior close on the report day or the session after, closing in the upper half of its range on volume above its 50-day average (a PEG); (b) a close more than 4% over the prior close on volume above its 50-day average; (c) a gain of more than 20% in five sessions. (a) is the main case; (b) and (c) are allowed. | [UCT] the owner: "mostly" PEGs, "not exclusively"; (b) is the scanner's S3 (Manrav's scan, KB 11544, and the UCT team playbook, KB 15877); (c) is S3b (the playbook's "fast 20%+ run"); the 5% gap floor is [my proposal] (5 of his 6 pass-2 greats had an earnings-style gap drive, days of +11% to +29%, per `2026-10-25-setup-differentiation.md`) |
| 3 | **The drive day is never the trigger.** If the only qualifying drive day is the trigger day itself, it is not a Slingshot. | [UCT] the owner: "And no an earnings gap does not count btw" |
| 4 | **The pullback**: at least 3 consecutive daily closes under the line, and at most 7. | 3 = [originator] (his 2015 scan) [source consensus] (the BigGuava script's default; UCT's playbook says "three or more"); 7 = [UCT] the lesson text's "three to seven sessions" (from his rulings). VRT, his "Perfect" chart, had 8 by this count (section 6.3): see question 4 |
| 5 | **Depth**: from the highest high of the drive leg to the lowest low of the pullback, 5% to 12%. | [UCT] lesson text "about 5-12%"; his greats measured 5.6-11.7%. The rule record says 5-9% (question 5) |
| 6 | **Orderly**: the pullback's total high-to-low range at most about 1.6 ATR(14); no single red body bigger than about 3.5% of price; no down day on volume above its 50-day average. | [UCT] the measured signature of his greats (1.0-1.6 ATR, worst red body 0.9-3.3%); Scot1and: "Tight trading ranges before the trigger are ideal" [originator]. The exact numbers are [my proposal] |
| 7 | **Location at the trigger**: close over the 50-day SMA AND over the 200-day SMA. Prefer the 50-day over the 200-day and rising (the member tag's test). | 50 = scanner S5 [UCT]; 200 = B26 [house rule] (a hard rule; see question 2); the preference = [my proposal], from `tag_textbook.py` |
| 8 | **A leader**: RS rating 80 or more, in a strong group. | C31 [house rule]; Scot1and lists "High RS compared to the S&P" among his power scans [originator] |
| 9 | **Liquidity**: price $10 or more and $20 million or more traded a day; own no more than 1% of average daily volume. | B23, D42 [house rule] |
| 10 | **Not within 3 sessions before an earnings report.** | B22 [house rule] |

### 8.2 The buy

| # | Rule | Basis |
|---|---|---|
| 11 | **The trigger** is the first daily close above the line after the pullback in 8.1. | [originator] (his scan: c > xavgh4) [UCT] [source consensus] (the scan and the BigGuava script use the close; his prose says "break" and Deepvue "crossing above", see 3.12 point 2) |
| 12 | **A decisive trigger day**: it closes in the top 30% of its range (DCR 0.7 or more) and opens less than 2% over the prior close. | [UCT] the lesson text (from his rulings): "a decisive day that closes near its high and needs no gap"; playbook mistake: "Buying a trigger day that gaps up 2 or 3 percent". The 0.7 is [my proposal]; his greats were 0.78-0.99, except QCOM at 0.65 |
| 13 | **The order**, three options. **A** (recommended): a market order in the last minutes of the trigger day, once the close above the line is clear (E57). **B**: in the next 1-3 sessions, a market order as price trades a cent over the trigger day's high; skip if the first price is more than 4% over that high (C28). **C**: intraday on the trigger day as price crosses the line (the line moves with the day's own high, so this cannot be checked on daily bars). | A = the owner's definition and the scanner [UCT]; B = Manrav's range break after the cross, Scot1and's "range breakout" and Deepvue's "Range Break" [UCT] [originator]; C = the UCT team playbook and Scot1and's hourly entries [UCT] [originator]. I recommend A: it is the definition, it keeps the stop smallest (median 3.2% against 4.0% for B, Table B), and in the test the two ended about the same (+0.02R against +0.04R, inside the noise). The levels dossier recommended B, to match the Kicker ruling: his call (question 3) |
| 14 | **No chasing**: never more than 4% over the buy point; skip if more than 10% over the 10-day average. | C28, C29 [house rule] |

### 8.3 The stop

| # | Rule | Basis |
|---|---|---|
| 15 | **Default**: a few cents under the trigger day's low, as a real stop order with the broker. | [originator] "I typically place my stop at the low of the slingshot day"; F62, D41 [house rule]; the scanner [UCT] |
| 16 | **Wider choice**: a few cents under the lower of the trigger day's and the prior day's lows. Never wider than the bottom of the pullback. | the UCT team playbook and Manrav [UCT]; Scot1and: "Or at most, the bottom of the consolidation period" [originator] |
| 17 | **When the default stop is wider than 3%** (half of all firings; all six of his pass-2 greats): take it, and let the size shrink (A5). If it is wider than about 6.5% (wider than any of his greats; usually a news-like trigger day), skip it or look for an hourly entry. | A13: the stop "usually sits within about 3% of the buy"; A5 sizes from the stop [house rule]. The 6.5% cut-off is [my proposal]. The test found wider-stop trades no worse (section 4.3, point 3). Question 6 |
| 18 | **A gap through the stop**: the low of the first 30 minutes is the new stop; out if that is more than 2R of loss. | B20 [house rule] |

### 8.4 Trims and trail

| # | Rule | Basis |
|---|---|---|
| 19 | **Breakeven** once the trade is 2R up (anywhere from 2R to 5R is allowed). | B19 [house rule] |
| 20 | **First trim** a third at 3R; **second** a third at 5R; at the open if it gaps past the level. | B19, E51, F63 [house rule] |
| 21 | **Trail the last third**: sell on a close under the 10-day EMA for fast movers, the 21-day for steadier ones. | E52 [house rule]. Other views: Scot1and 2015, no close under the 4-day EMA [originator]; Manrav's RBLX note, a run that "rides 8 and 21 EMAs" (levels dossier) [UCT] |
| 22 | **Time stop**: under 1R after 10 trading days, sell. | C33 [house rule]; playbook: a trigger that fades to flat by day 20 was not worth keeping [UCT] |
| 23 | **A climax run** in the position (Bracco's parabolic burst): sell a big part into it, a judgement call. | C34 [house rule] |
| 24 | **A note on the house trims**: in the test, 3R came first on about 20% of trades and 5R on about 12%. UCT's team playbook trims into the next 3-5 day burst, and Scot1and sold "a portion of my position early into the advance". The house plan stays the default; whether a Slingshot gets an earlier first trim is question 7. | [measured] [UCT] [originator] |

### 8.5 What invalidates it

| # | Rule | Basis |
|---|---|---|
| 25 | Before entry: a pullback that runs past 7 closes or deeper than 12% is no longer a Slingshot (it is becoming a base; judge it as a base or a Launchpad). | [UCT] the owner's ranges |
| 26 | Before entry: the trigger close is under the 200-day SMA; or, above it, the 50-day and 200-day are both falling (a bounce in a downtrend). | Under the 200 = B26 [house rule]; the owner's cuts TEAM and HAS were both under it [UCT] (on our bars TEAM's 200-day was still rising and HAS's 50-day was rising, 6.3); the both-falling clause is [my proposal]; the TaPlot copy: "A pull back in a stock in a downtrend is merely an opportunity to sell into strength." [originator] |
| 27 | After entry: a trade under the stop ends it. No widening. | A4 [house rule] [originator] |
| 28 | After entry: a close back under the line on the next session is a warning, not an exit; the stop decides. | the scanner narrative [UCT] |
| 29 | Re-entry only on a new Slingshot: a new run of at least 3 closes under the line, then a new close over it, with its own stop; at most 3 tries a week and 6 a month on one stock. | B21, E56 [house rule]; the scanner narrative [UCT] |

### 8.6 The short mirror

- **Shape**: our long reversed (D47). A stock under its 200-day SMA (B26), RS 20 or less (the C31 mirror), after a
  breakdown drive (an earnings gap down, or a 4%+ down day on volume); a bounce of 3 to 7 closes ABOVE the 4-period EMA
  of the daily LOWS; the trigger is the first close back under that line, near the day's low; the stop a few cents over
  the trigger day's high.
- **Source**: only BigGuavaTrading's script builds this ("a separate 4-period EMA of lows"). No short version appears in
  Scot1and's blog posts, the TaPlot copy of his write-up or the public podcast lines (his posts on X were not searched),
  and none of the owner's rulings mention one. It is untested here.
- **Recommendation** [my proposal]: do not teach it as a named setup until the owner rules (question 9). If it is
  taught, call it our mirror, not Scot1and's.

### 8.7 Best market conditions

- **A Green market reading** at full size; Yellow smaller and fewer; Orange only A+ setups; Red mostly cash, plus shorts
  below the 200-day (F65, D46) [house rule].
- Scot1and holds his Slingshots "as long as the market is not giving distribution days" [originator].
- Earnings seasons in a healthy market give the most PEG Slingshots, because many leaders gap and pause at once [my
  proposal; untested].
- **Evidence limit**: the test (4.3) found no better average when SPY was over its 50-day and 200-day (+0.02R) than
  when it was under its 50-day (+0.10R); both are inside the noise. The market rule is a house rule, not something this
  test shows.

### 8.8 Common mistakes

1. Buying the earnings gap day (or the rally day) as the Slingshot. It is never the trigger. [UCT]
2. Buying a trigger day that gaps up 2% or more. [UCT]
3. Buying the first red day of the pullback instead of waiting for the close back over the line. [UCT] (Manrav, per the
   levels dossier) [originator] ("Then when momentum resumes we enter.")
4. Taking a bounce under the 200-day as a Slingshot, falling or not (B26). [UCT] [house rule]
5. Drawing the wrong line: a 4-day EMA of closes, or Chris Moody's two-average "SlingShot System". [originator]
6. Trading a pullback that is too long (8 or more closes) or too deep (more than 12%). [UCT]
7. Widening the stop, or re-buying the same pullback again and again. [house rule] [UCT]
8. Thin or cheap names (FIGS, a $7 stock, was cut; the reviewer's notes call CBZ and INTA thin). [UCT] [house rule]
9. Holding a rally Slingshot into an earnings report just after it triggers. [house rule]

## 9. Grading

The rulebook says grading "is discretionary and hard to define" (E50) and sets the size by the grade (D38, E49). These
are observable cues from his own grades (section 6.3 and `docs/study/analysis/2026-10-25-setup-differentiation.md`) and
from the originator, offered as a guide, not a checklist.

| Cue | A+ (his SMCI, VRT, PLTR, NVDA) | A or B (his goods: TXN, SLB, DECK, HAE, APP) | B- or cut (his okays and cuts) |
|---|---|---|---|
| The drive | an earnings gap, a +11% to +29% day (5 of the 6 pass-2 greats) [UCT] | an earnings gap or a strong rally | a rally only (COIN, cut), or no earnings drive and no follow-through (BBWI, CBZ) |
| The stock | a leader, RS 80+ [house rule, C31; not measured on his charts], over a rising 50-day and 200-day (all six pass-2 greats) | over both averages | under the 200-day (TEAM, HAS, FIGS: cut); under $10 (FIGS); thin (CBZ, INTA) |
| The pullback | 3-7 closes under the line (VRT 8), 5-12% deep, range 1.0-1.6 ATR, small red bodies, quiet volume [UCT]; tight ranges [originator] | the same, a little looser | choppy (TCOM, 1.85 ATR, cut); a long base (RTX, 10 closes, cut) |
| The trigger day | +3% to +6%, closes at 78-99% of its range, no gap (under about 1.2%), ordinary volume (0.9-1.4x on the six) [UCT] | a bigger, news-like day (APP +13% on 2.4x volume, "good") | a gap of 2% or more (TCOM, COIN), a weak close (COIN and INTA at 0.72), a tiny day (PANW +1.5%, "B-") |
| The stop | the trigger low about 3.5-6% away | up to about 11% (APP 10.7%) | - |
| What came next (his "must work") | never near the trigger low; +6% to +21% in five days [UCT] | a solid move | flat by day 20 (DUOL), or under the trigger low (TCOM) |
| The market | a Green reading [house rule] | Green or Yellow | Orange: A+ setups only; Red: mostly cash and shorts (F65) |

Two cautions. (1) The "What came next" row is hindsight: it explains why a gallery chart was kept, and it cannot grade a live
trade. (2) The test (4.3) found that bigger trigger days did better on average, while he grades quiet triggers higher.
His grades may be about how teachable a chart looks. That is worth asking (question 8).

## 10. Questions for the owner

1. **PEG only, or PEG mostly?** (a) Teach the Slingshot only as the way into a power earnings gap; (b) PEG mostly, a
   strong rally allowed (your COIN words: "Not exclusively to PEGs but still good"); (c) any strong stock, as Scot1and
   does. I recommend (b). The test found no difference between the two kinds of drive.
2. **The 200-day.** Your 2026-10-25 lesson says "the 200-day is not required" (HAE); your 2026-11-09 hard rule B26 says
   no longs under it. (a) B26 applies to the Slingshot, and the lesson and the playbook are corrected (recommended);
   (b) the Slingshot is an exception. Also: the sandbox bars show HAE's trigger close over its (falling) 200-day SMA,
   not under it. Can someone check HAE on the live chart?
3. **The buy.** (a) A market order near the close on the trigger day (recommended; it is your definition); (b) the next
   day, over the trigger day's high, as Manrav confirms and as your Kicker ruling does; (c) intraday as it crosses the
   line.
4. **Pullback length.** (a) 3-7 closes under the line, as written; (b) 3-8, so that VRT ("Perfect", 8 by a strict
   count) fits; (c) no upper limit, as the scanner has it.
5. **Depth.** (a) 5-12% (the lesson text; your greats measured 5.6-11.7%; recommended); (b) 5-9% (the rule record);
   (c) Scot1and's "The EMA 9 should be the limit".
6. **The stop and the 3% rule.** All six of your pass-2 greats (VRT, NFLX, NVDA, SOFI, PLTR, SMCI) had a trigger-low
   stop of 3.5-6.1%; only QCOM (pass 1, "Keep, great") was inside 3%. (a) Keep the trigger
   day's low and let the size shrink, skip above about 6.5% (recommended); (b) skip any Slingshot whose stop is over
   3%; (c) use the prior day's low (wider; Manrav used about 9% on RUN and GEV).
7. **The first trim.** (a) The house plan, a third at 3R (recommended as the default); (b) an earlier partial into the
   next 3-5 day burst, as UCT's team playbook says, or "early into the advance", as Scot1and does.
8. **Quiet or strong trigger days?** You graded +11% to +13% trigger days lower ("good", "okay") than +3% to +6% days.
   The test found the strong days did better. Should the course prefer quiet triggers (cleaner to teach), strong ones,
   or neither?
9. **A short Slingshot?** (a) Teach the mirror (the 4-day EMA of the lows, under the 200-day); (b) leave it out
   (recommended until you have seen examples).
10. **The scanner.** Should it be brought into line with your rulings? The changes would be: the strength day must come
    before the pullback; a 200-day test; the $10 and $20 million floor; a 7-close and 12% cap; the trigger's gap and
    close; the stop a few cents under the low; and the five test fixtures you ruled out replaced.
11. **Hourly Slingshots.** Scot1and uses a half-hour or hourly Slingshot as an early entry into his Fishhook (a gap
    setup). Do you want that taught, for example as an entry into a PEG in its first days?
12. **Credit.** Should the lesson name Scot1and as the setup's originator (he named it in 2015)?
13. **The Model Book.** The card's little chart draws a 3-day average of closes, not the 4-day average of the highs,
    and the card sits under "Reversals & Reclaims" though the sources describe a continuation. Fix both?

## 11. Sources

All read on 2026-11-09. "Saved" = downloaded and checked by a script.

**The originator: Scot1and, blog "Education of A Speculator" (educsos.blogspot.com), saved**
- "Introducing the Slingshot", 17 Aug 2015, http://educsos.blogspot.com/2015/08/introducing-slingshot.html . The name
  and the first rule; anecdotal examples.
- "Slingshot setup", 20 Oct 2015, http://educsos.blogspot.com/2015/10/slingshot-setup.html . One line and a video
  (YouTube 4vlukf0OD3I) that no longer exists (oEmbed 404). Found in the cold check.
- "Thrust--", 21 Oct 2015, http://educsos.blogspot.com/2015/10/thrust.html . The 4-period EMA of the highs.
- "Slingshot Setup Described", 8 Nov 2015, http://educsos.blogspot.com/2015/11/slingshot-setup-described.html . One
  sentence; the embedded video (YouTube kyBfLsfFTbM) no longer plays (YouTube's oEmbed answers 404 for it).
- "New Slingshot Anticipation Scan", 27 Nov 2015,
  http://educsos.blogspot.com/2015/11/new-slingshot-anticipation-scan.html . The exact TC2000 rule: the strongest
  source for the trigger.
- "Slingshot Refresher.", 11 Oct 2016, with his reply of 16 Oct 2016,
  http://educsos.blogspot.com/2016/10/slingshot-refresher.html .
- "Setups", 10 May 2017, http://educsos.blogspot.com/2017/05/setups.html .
- Context: "Fishhook Update", 14 Sep 2014, with his reply of 15 Sep 2014,
  http://educsos.blogspot.com/2014/09/fishhook-update.html ; "Review of www.Stockbee.biz", 18 Apr 2015,
  http://educsos.blogspot.com/2015/04/the-trading-websites-i-subscribe-to-and.html ; "Review of Muathe .com", dated
  1 May 2017 on the page, http://educsos.blogspot.com/2018/01/review-of-muathe-com.html (his Fishhook claim); "How I set Up My
  Charts and Momentum Scans", 5 May 2015, http://educsos.blogspot.com/2015/05/how-i-set-up-my-charts-and-momentum.html ;
  "2018 Review", 30 Dec 2018, http://educsos.blogspot.com/2018/12/2018-review.html (no Slingshot rules); the label pages
  http://educsos.blogspot.com/search/label/Slingshot and http://educsos.blogspot.com/search/label/Setups .
- Reliability: the personal blog of the person who named the setup. Short posts, mostly charts, no statistics. The
  highest-ranking outside source for this setup.

**Scot1and at TraderLion**
- TraderLion (YouTube), "The Fishhook and Slingshot Trading Setup | How to Build an Edge", published 2022-11-01,
  https://www.youtube.com/watch?v=hqIIzNgbIEY . Saved page; the description and timestamps only (the listed
  auto-generated caption track answered HTTP 404).
- Podscan.fm page for The TraderLion Podcast episode with Scot1and (TraderLion 2025 conference session), published
  2 May 2026,
  https://podscan.fm/podcasts/the-traderlion-podcast/episodes/the-8-pivot-lessons-that-will-change-how-you-see-charts-forever-from-pro-trader-scot1and .
  Saved. The description is TraderLion's; the transcript is automatic (first 20 lines public). Check against the audio.

**Secondary copies and scripts (TradingView), saved**
- TaPlot, "TAPLOT SlingShot", 29 Nov 2021 (updated 9 Jan 2022),
  https://www.tradingview.com/script/JJtDhJFF-TAPLOT-SlingShot/ . Quotes Scot1andT's write-up in full; where he first
  published it is unknown. A secondary copy of the originator.
- BigGuavaTrading, "Launchpad & Slingshot", 2 Nov 2025, https://www.tradingview.com/script/fXVC2e6a-Launchpad-Slingshot/ .
  A script author; the bear mirror is his own. Forum level.
- EltAlt, "AMASling - All Moving Average Sling Shot", 20 May 2022,
  https://www.tradingview.com/script/b6xaJlaf-AMASling-All-Moving-Average-Sling-Shot/ , and the tag page
  https://www.tradingview.com/scripts/slingshot/ . Used only to show the name clash with Chris Moody's "SlingShot
  System".
- ChrisMoody, "CM Sling Shot System", 8 Oct 2014, https://www.tradingview.com/script/GE7tSQK1-CM-Sling-Shot-System/ .
  A different, older system with the same name (two EMAs). Found in the cold check.

**Other outside pages, saved**
- Deepvue Knowledge Base, "Technical Patterns" ("Slingshot Pattern" entry), published 3 Sep 2024, updated 19 Jun
  2026, https://deepvue.com/knowledge-base/deepvue-custom-indicators-technical-patterns/ . A charting platform's own
  documentation: credits Scot1and, describes a 5-day EMA and a range break; no statistics. Found in the cold check.
- Trade The System, "Slingshot Setup", 3 Jun 2016, https://tradethesystem.wordpress.com/2016/06/03/slingshot-setup/ .
  An anonymous blog; used only as a date marker, never for rules.
- Pradeep Bonde (Stockbee), "How to use the 4% breakout scan to make money", 18 Nov 2015,
  https://stockbee.blogspot.com/2015/11/how-to-use-4-breakout-scan-to-make-money.html , and "How do stock move on 3 to 5
  day time frame", 21 May 2015, https://stockbee.blogspot.com/2015/05/how-do-stock-move-on-3-to-5-day-time.html . The
  originator of the 4% breakout and of momentum bursts; not a Slingshot source.

**UCT**
- The Uncharted Territory Substack: all 103 posts in https://unchartedterritoryy.substack.com/sitemap.xml , saved. The
  one mention: "Sunday Scans", 2 Nov 2025, https://unchartedterritoryy.substack.com/p/sunday-scans-b99 . Bracco, "The
  Parabolic Short", https://unchartedterritoryy.substack.com/p/the-parabolic-short (no Slingshot content).
- The owner's rulings: `docs/study/audits/2026-10-24/owner_verdicts.jsonl` (lines 154-181, and the 2026-11-09 rulebook
  lines at the end); `docs/study/corrections/spot.fixtures.jsonl` (lines 7, 8 and 23).
- `docs/study/sizing_rule.md` §9 (the account rulebook); `docs/study/TRADE_PLANS.md`.
- `docs/study/levels/dossiers/slingshot.md`, `docs/study/levels/external_research.md` (§5), `docs/study/levels/evidence.md`,
  `docs/study/levels/evidence_kept.md`, `docs/study/analysis/2026-10-25-setup-differentiation.md`,
  `docs/study/bank/spot.setups.json`, `docs/study/setups/setup_examples.json`, `docs/study/RESUME.md`.
- Brain KB rows 11544, 11726, 11964, 12088, 13266, 13488, 15454 and 15877, as stored in the public extract
  `docs/study/levels/brain_kb_2026-11-06.json` (tracked in the repo; re-read in the cold check), and KB 10985 as the
  levels dossier summarises it. They are machine summaries of chat; the brain database itself is private and was not
  opened.

**Our code**
- `api/services/pattern_engine/detectors/uct/uct_slingshot.py`, `uct_setups_common.py`,
  `api/services/pattern_engine/primitives/liquidity.py`; `api/services/setup_tags.py`;
  `api/services/pattern_engine/tag_textbook.py`; `api/services/study_trade.py`; `scripts/study/find_slingshot_examples.py`;
  `tests/fixtures/uct_slingshot/`, `tests/fixtures/_gen_uct_setups.py`; `app/src/pages/modelbook/setupCatalog.js`,
  `setupPlaybooks.js`, `SetupsView.jsx`; `app/src/constants/setupGroups.js`;
  `app/src/components/chart/engine/ast/starterScans.json`; `docs/superpowers/research/setups/setup_criteria.json`,
  `SETUP_NOTES.md`, `g1-setup-research-report.md`.

**Data**: the sandbox daily bars database (read only; 3,727 tickers with 400 or more daily bars, data to 2026-11-06, at
the time of the run; since refreshed) and `docs/study/setups/earnings_dates_cache.json` (992 tickers listed, 983 of the
run's tickers covered; its source and report timing are not documented).

**Tried and not read.** analyzingalpha.com/scot1and (404); thestocktails.com/the-slingshot (the site did not resolve);
podtail.com's 2023 episode page (403); traderlion.com (403); the 2015 video (unavailable); the 2022 TraderLion talk's
captions (none served to a plain download); the full Podscan transcript (needs an account); a Scribd document titled
"The Slingshot Trading Method" (not opened; it may be a different method); thepatternsite.com (refuses plain
downloads, HTTP 406; its home page was read through a fetch tool and lists no Slingshot). **Searched in the cold check,
nothing found**: Bulkowski (thepatternsite.com), investors.com and StockCharts ChartSchool (one site-restricted search),
TraderLion written articles, and where Scot1and first published the write-up TaPlot copies. **Found in the cold check**:
an earlier use of the name, Chris Moody's 2014 script (section 2), and Deepvue's entry (3.9b). **Still not searched**:
MarketSmith, Scot1and's posts on X.

## Removed in checking

Cold check of 2026-11-09 (a second reader, working from fresh downloads of every page and from the code). Every quote
in this file was found word for word on its page; none had to be removed for being misquoted. What was wrong, unproven
or missing, and what was done:

**Corrected (the claim was wrong as written)**
1. "Five of his six greats" had a trigger-low stop wider than 3% (sections 7, 8.3 rule 17, 10 question 6). On the
   dossier's own table it is **all six** pass-2 greats (3.5-6.1%); only QCOM, a pass-1 "great", was inside 3%.
2. The test's management (4.3) left out that **the trail only starts once 5R is reached**; before that the last shares
   sit on the stop or the breakeven stop. Added, with a note on what it does to the averages.
3. "Every later source uses" the 4-period EMA of the highs (sections 2 and 3.12). Trade The System's friend used a
   "4 EMA" (of what, not said) and Deepvue's knowledge base describes a 5-day EMA. Narrowed to the sources that do.
4. "It reached UCT through the trader Manrav" was stated as a fact. Replaced with what the record shows: Manrav's July
   2025 scan is the earliest UCT record found, and the Sunday Scans writer says he adopted Manrav's setups.
5. The BOOM quote was dated 14 Sep 2014; it is Scot1and's **reply of 15 Sep 2014** under the 14 Sep post.
6. "The friend instead used" a ROC over 15: the page says the friend "also conditions" it; Scot1and swapped in a weekly
   RSI. Reworded.
7. Comparison table (3.11): the column "Scot1and 2016-17" held the Nov 2015 scan items, and "a shallow pull back"
   (Oct 2015) sat in it. Columns relabelled (Aug-Oct 2015; Nov 2015-2017) and the quote moved. The TaPlot copy's
   timeframe "daily" was removed (the copy names none); BigGuava's "any" became the page's "daily/intraday".
8. Scanner summary (5.1): it examines the latest session and the two before it, not "up to 3 sessions back"; S3's
   window is the trigger session and the 25 before it (26 sessions), S3b's the trigger session and the 5 before it; the
   "offline lab study" wording is in `uct_setups_common.py`'s docstring, not the slingshot module's.
9. Model Book glyph (5.3): the wide candle is the ninth of ten, not the trigger; the file's convention makes the final
   +3% candle the trigger.
10. Rule 26 cited TEAM and HAS as cuts where "the 50-day and 200-day are both falling". On our bars TEAM's 200-day was
    still rising and HAS's 50-day was rising slightly; both were under the 200-day. Reworded; the both-falling clause
    is now tagged [my proposal]. Section 9 and mistake 4 changed from "under a falling 200-day" to "under the 200-day".
11. Rule 2's basis said (b) and (c) both come from Manrav's scan; the 20%-in-5 run (S3b) is in the UCT team playbook
    (KB 15877), not Manrav's scan (KB 11544). "His greats had drive days of +11% to +29%": the source says 5 of the 6.
12. Market wording (8.7, 9): "Red no new longs" and "Orange or Red: A+ only or no longs" are not F65's words; F65 says
    Orange only A+ setups, Red mostly cash and shorts. Replaced.
13. Section 9: "closes in the top 20% of its range" (SOFI closed at 0.78) became "78-99%"; APP's stop "about 10%"
    became 10.7%.
14. 4.2: the "by construction" quote is in `evidence_kept.md`, and the finder's must-work rule in code is stricter than
    "no close under the trigger low" (every low at least 2% above it). Both stated as they are.
15. 4.3 counts: the trades' end states were recounted from the raw output (first stop 48.5%, so 49%, plus a 0.3% cap
    exit the draft left out); the earnings cache lists 992 tickers, 983 of the run's tickers covered (the draft said
    980); "US" dropped from "3,727 US tickers" (not checkable); the database has since been refreshed.
16. 6.4 said the KB rows were used "only as far as the levels dossier already summarises them", yet cited stacking and
    a Wedge Pop that the levels dossier does not mention. Those rows are in the public extract
    `brain_kb_2026-11-06.json`; the provenance line now says so, and each cited row was re-read there.
17. 3.10's heading called Stockbee "the root of two of our numbers" while its text said "a resemblance, not a lineage".
    Heading softened; the two facts that make the link likely were added.
18. 4.1 said Stockbee's 3-5 day burst range "describes his 4% breakouts"; the post describes momentum bursts in
    general (the 4% scan is built to catch them).
19. 8.6 said "Scot1and never published a short version"; his posts on X were never searched, so it now says what was
    checked.
20. "No captions were served" for the 2022 talk: the page lists an auto-generated track; its download answered 404.

**Removed (no source found)**
- Section 9, A+ drive: "on heavy volume". Neither the setup-differentiation analysis nor the finder states the drive
  day's volume.
- Section 11: the quoted YouTube message "Video unavailable" for the 2015 video; it could not be re-seen with a plain
  download. Replaced by what was checked (YouTube's oEmbed answers 404 for that id).
- Section 4.1: the draft's line that Bulkowski, IBD and StockCharts could not be searched (they now have been; nothing
  found). A quotation of Bulkowski's AI notice was not added, because the site refuses plain downloads and the wording
  could only be read through a fetch tool.

**Added (missing from the draft)**
- Deepvue's knowledge-base entry (3.9b): credits Scot1and, but a 5-day EMA, a "significant" pullback and a range break.
- Chris Moody's "CM Sling Shot System", dated 8 Oct 2014: the name was in use for a different two-EMA system ten months
  before Scot1and's post.
- Scot1and's 20 Oct 2015 "Slingshot setup" post (a video, now gone).
- Scot1and's Stockbee membership (18 Apr 2015), his claim to the Fishhook ("Last year I worked out a setup I call the
  fishhook"), "great for earnings plays" (2017) and "really my gap setup" (2026 transcript).
- KB 13266: a UCT-archive trader scanning with TaPlot's indicator; KB 11544's scan in Scot1and's own notation; the team
  playbook's "price above or near the 50 SMA".
- The Substack byline profile naming Manrav as one of the room's runners; one subscriber-only post noted as only partly
  searchable.
- On our bars: HAE confirmed over its (falling) 200-day; TEAM under a still-rising 200-day.
- Reproducibility: the measurement script re-run on its first 40 tickers gave 966 firings on 25 tickers, identical
  trade by trade to the original output.

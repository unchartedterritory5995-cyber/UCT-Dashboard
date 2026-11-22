# Setup 22: News/Earnings Gapper (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Where I could not
read a source, I say so and give no wording from it.

**How the quotes were checked.** Every quote is 40 words or fewer and copied from the page or file named next to it.
- **Checked word for word by a script against saved copies** (downloaded today): all 103 posts in UCT's Substack sitemap
  (102 public; one subscribers-only post, 2026-10-18, was not read past its preview), stockbee.blogspot.com,
  qullamaggie.com, virtueofselfishinvesting.com, morpheustrading.com, chartschool.stockcharts.com,
  smbtraining.com, ideas.repec.org, the investors.com teaser, and our own code and docs.
- **Read through the WebFetch page-reading tool**, because the site refuses a plain download (HTTP 406): Thomas
  Bulkowski's thepatternsite.com. The sentences I quote are the tool's verbatim extracts. They should be checked against
  the live page before a quote goes into a lesson. His site carries a notice against AI training (section 11).
- **My web search allowance ran out early in this run.** I reached sources through links already recorded in the repo's
  research files and through the authors' own pages. I could not search for IBD's own gap-up columns (the one I found is
  paywalled past its teaser), TraderLion's pages (they refuse plain downloads with HTTP 403), or the abstract of Chan
  (2003). Section 11 lists what I could not open.
- **Cold check, 2026-11-09 (a second reader).** Every quote below was matched again, word for word, against fresh
  downloads (the 103 Substack posts, the Stockbee, Qullamaggie, VoSI, Morpheus, ChartSchool, SMB, RePEc and IBD pages)
  and against the repo files; each Bulkowski sentence was re-confirmed one at a time through WebFetch, page by page.
  TraderLion also refuses WebFetch (HTTP 403). RePEc carries no abstract for Bernard and Thomas (1989) or Chan (2003).
  What was corrected or removed is listed at the end, under "Removed in checking".
- **Cold check 2, 2026-11-09 evening (a third reader, working from its own downloads, not the writer's).** All 103
  Substack posts, the 12 Stockbee posts, both Qullamaggie posts, the 11 VoSI pages, Morpheus, ChartSchool, SMB, the IBD
  teaser, the Yahoo reprint, Wiley, RePEc and alphatrends were downloaded again and every one of the 529 double-quoted
  spans in this file was matched word for word against them and the repo files (0 misses). Each Substack quote was then
  matched inside the post its row links, the row's date against the post's own `datePublished`, and the section heading
  above it against the "where" column (all 61 rows agree). Each Bonde, Kullamägi and Morales/Kacher quote was matched
  inside the post or FAQ the text dates it to, and the Stockbee comment quotes to their commenter and date. The nine
  Bulkowski pages were re-read one at a time through WebFetch. The scanner, Chart IQ, screener and catalyst summaries of
  section 5 were re-read against the code. Twelve of the eighteen gaps in 6.7 were recomputed from the bars database
  (the writer had checked five). The whole of section 4.3 was re-run from the scripts; every statistic reproduced within
  rounding except the random-day baseline, which is a different random sample on the grown database and came out higher
  (section 4.3). The few wording changes are listed under "Removed in checking", at the end.
- **Substack dates** are the dates Substack prints on each post, which are UTC. Eight of the posts cited here went out
  on the evening before in US Eastern time (for example the post dated 2026-02-16 went out on Sunday 2026-02-15 at
  9:35 pm ET; the 2025-06-20 "Market Update and Watchlist" went out on 2025-06-19 at 9:53 pm ET).

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the trader who named or
codified the idea (here mainly Pradeep Bonde, Kristjan Kullamägi, Gil Morales and Chris Kacher); **[UCT]** the owner,
Bracco, the Substack or our own app; **[house rule]** the account rulebook, `docs/study/sizing_rule.md` section 9;
**[measured]** our own test in section 4.3; **[my proposal]** my recommendation, for the owner to accept or change.

Words used below. **Gap**: how far the open is above the prior close, in percent. **True gap**: the day's low stays above
the prior day's high (StockCharts' definition). **Gap day**: the first regular session after the news (the same day for
news before the open, the next day for news after the close). **Gap-day low**: the lowest price of the gap day.
**Gap fill**: price trades back down to the prior day's close. **ORH**: opening range high, the high of the first 1, 5,
30 or 60 minutes. **RVOL**: the day's volume divided by the 50-day average volume. **R**: the risk on the trade (entry
minus stop); 3R is a gain of three times that risk. **EP**: episodic pivot. **PEG**: Power Earnings Gap (UCT also
writes "Post Earnings Gap"). **BGU**: buyable gap-up. **PEAD**: post-earnings-announcement drift. **HVC / HVE**: high
volume close / highest volume ever. **AVWAP**: anchored volume-weighted average price.

---

## 1. What it is

**In two sentences.** A stock opens sharply higher on news the market did not expect, most often an earnings report,
trades several times its normal volume, and holds the gap instead of giving it back. You buy it on the gap day above the
opening range with the stop under the day's low, or on its first pullback that holds the gap and turns back up, and ride
the repricing for days to weeks.

**Why it works (the psychology).** These points are reasoning from the sources, not measured facts. Section 4 shows how
much of it survives a test.
- **New information forces a repricing.** Kullamägi: "The fundamental logic for an EP is news that catches the market
  off guard and forces a revaluation of the stock." ChartSchool gives the mechanics: "if an unexpectedly strong earnings
  report comes out after the market has closed, a lot of buying interest will be generated overnight."
- **Big buyers cannot finish in one day.** Kullamägi: "Remember, when institutions buy, they don't buy in one day. It
  can take many months for them to get to their desired allocation." That unfinished buying is what a pullback that
  holds the gap is supposed to show.
- **The market under-reacts at first (the drift).** Bonde built the Episodic Pivot on the academic drift: "If a company
  announces a big earnings surprize and if it is not currently priced in to the stock it will go up. This phenomenon is
  called PEAD or Post Earnings Announcement Drift." Frazzini (2006) names one cause, holders with gains selling too
  soon ("the tendency of investors to ride losses and realize gains"), and reports an event strategy that "yields
  monthly alphas of over 200 basis points."
- **Who is trapped or forced.** Shorts and sellers from before the news are on the wrong side of a gap and must buy it
  back higher. Underweight funds chase. Bracco on the April 2026 semiconductor move: "To me this move felt more like a
  ton of participants underexposed and trying to get positioned. You had huge power earnings gaps and EP's on some
  semiconductor names that have been dormant for years".
- **Attention.** Gervais, Kaniel and Mingelgrin (2001) found that "stocks experiencing unusually high (low) trading
  volume over a day or a week tend to appreciate (depreciate) over the course of the following month", and argue that
  volume shocks "affect its visibility, and in turn the subsequent demand and price for that stock."
- **The house's own reason.** "It is without question that new high quality winners will establish themselves and
  start as earnings gappers." (Sunday Scans, 2026-01-25, in the earnings calendar section, which carries no name; its
  first-person voice reads like the owner's, but the byline does not prove it.)

**Why it often fails.** Most gaps are not this setup. Adam Grimes's gap study ends: "Opening gaps tend to fail." The
same study found the big ones behave differently: "Large gaps (>5% or <-5%) close only 9.6% of the time. (N=279)".
Bulkowski on the good earnings surprise: "Almost half (48%) rise just 10% before tumbling and that occurs in less than
2 weeks." On broker upgrades: "For upward breakouts, price rises, rounds over, and then declines." The edge, if any, is
in choosing the right gaps and the right entries, which is what the rest of this file is about.

---

## 2. Origin and naming

**No one person named "news gapper" or "earnings gapper".** They are trader shorthand. The idea has several roots:

| year | who | what | source read |
|---|---|---|---|
| (classical) | chart-analysis tradition | the gap types: common, breakaway, runaway (measuring), exhaustion | StockCharts ChartSchool, "Gaps and Gap Analysis" |
| 1968, 1989 | Ball and Brown; Bernard and Thomas | the academic post-earnings drift | Ball and Brown (1968) named by Bonde (2007, 2010); Bernard and Thomas added here as the classic drift paper (Bonde does not name it); its citation checked on RePEc, no abstract there |
| 2006 (22 Nov) | Pradeep Bonde | in his replies under "Gaps and traps": he trades runaway gaps on earnings and investigates "20% plus gaps" | stockbee.blogspot.com |
| 2007 (Jan to Apr) | Pradeep Bonde, Stockbee | "Trading Earnings Breakouts", "How to trade earnings" (the main post, Part 2 and Part 3), "Earnings and Bulkowski" | stockbee.blogspot.com |
| 2007 (15 and 26 Feb) | Pradeep Bonde | the **Episodic Pivot**: the term is already in his 2007-02-15 post ("Up stocks and down stocks"); on 2007-02-26 he explains where the idea came from: "The basic idea is to study large one day move to find stock likely to go up." | "Up stocks and down stocks"; *Episodic Pivots and "Idea Pickle"* |
| late 1990s, fall 2003 | Thomas Bulkowski | the **earnings flag** ("Discovered by Thomas Bulkowski in the late 1990s.") and the **good earnings surprise** ("Discovered by Thomas Bulkowski in the fall of 2003.") event patterns | thepatternsite.com (WebFetch) |
| 2010 | Gil Morales and Chris Kacher | the **buyable gap-up (BGU)**: their FAQ (2010-10-24) quotes "Rule #2" from "page 171 of our book (hardcover 1st edition)"; the FAQ does not name the book, but their book of that year is *Trade Like an O'Neil Disciple* (Wiley, 1st edition September 2010, per Wiley's page, whose contents list "Dr. K's Laboratory: Buying Gap-Ups in Leading Stocks"); also *Trading gaps with the most potential*, *Active Trader*, December 2010 (as Bulkowski cites it) | virtueofselfishinvesting.com FAQs; wiley-vch.de; thepatternsite.com |
| 2010 (12 Feb) | Pradeep Bonde | "What are Episodic Pivots and how to find them", with a scan and twenty-odd catalyst types | stockbee.blogspot.com |
| 2014 (30 Jul) | Pradeep Bonde | "My process flow for Episodic Pivots (EP)": a 4% scan and buying in pre-market | stockbee.blogspot.com |
| 2018 | Deron Wagner, Morpheus Trading | "How To Trade Breakaway Gaps For Huge Stock Gains" | morpheustrading.com |
| 2021 | Kristjan Kullamägi | EP as one of his three setups; his own 10% definition | qullamaggie.com |
| 2024 (15 May), 2025 (1 Sep) | Pradeep Bonde | the **delayed reaction** EP: a post titled "Delayed reaction Episodic Pivots" (a video only, no text) and "Scans used in Marketsurge to find growth or turnaround stocks for Episodic Pivots, delayed reaction entries." | stockbee.blogspot.com |
| 2025 to 2026 | UCT (the owner, Bracco, the team) | "earnings gapper", "ER gapper", "news gapper", "PR gapper", "catalyst gappers", "PEG", "PEG list", "delayed reaction" | UCT Substack |

**Bonde's own account of where the EP came from** (2007-02-26): he studied stocks that doubled and found most "had one
day 10% or plus move within first 20 to 25% of their 100% or more growth in 260 days." He then borrowed a price and
volume system from Jon Markman's book *Swing Trading* (George Fontanills's system) and Mark Minervini's posted trade
list: "After close xamination [sic] I found that most of them were triggered by news pivots and the entries were post
such high volume spikes." Kullamägi says he learned the EP from Bonde: "a setup I learned from Pradeep Bonde
(Stockbee)".

**Other names for the same family.** Earnings breakout (Bonde, 2007); Episodic Pivot or EP (Bonde; Kullamägi); buyable
gap-up or BGU (Morales and Kacher); breakaway gap (ChartSchool; Wagner; IBD); earnings flag and earnings surprise
(Bulkowski's event patterns); Power Earnings Gap or PEG (UCT and others; the origin of this name is not settled, see the
setup 21 dossier); delayed reaction (UCT; Bonde uses the same words, "Delayed reaction Episodic Pivots", 2024, and
earlier wrote of a "monthly EP scan to find stocks that breakout later after earnings", 2010).

**UCT's own names.** The Model Book card is "News/Earnings Gapper" (`app/src/pages/modelbook/setupCatalog.js`). The
journal tag is "News Gappers" (`app/src/constants/setupGroups.js`), mapped to the card by
`app/src/pages/journal-2-0/lib/setupTagMap.js`. An older card name, "News/Catalyst Gapper", is renamed on startup
(`api/services/modelbook_service.py`). In UCT's writing "earnings gapper" is the everyday word (43 uses across the 103
Substack posts, all sections and writers counted), "PEG" is used both for the earnings gap and for the setup that forms
after it, and the owner writes it out both ways:
"PEG (Power Earnings Gap)" (2025-09-21, 2026-08-23) and "PEG (Post Earnings Gap)" (2025-11-09).

---

## 3. Every definition I could find, source by source

### 3.1 The owner (UCT; the primary source for how we trade it)

His verdict log (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`) and his Sunday Scans and Rest of the Week
sections (quoted in full in section 6) give these working criteria. Each line names where it comes from.
- **The catalyst is the point.** Earnings first, then news, press releases, partnerships and government stakes: "Pay
  attention to ER and PR gappers!" (2026-02-04). An earnings-day gap is an earnings gapper by default, not a Kicker
  (verdict lines 3 to 5).
- **Two ways in.** Day one: "I love trading earnings gappers on day one." (2025-11-09). Or later: "I personally prefer
  letting the earnings gappers build out for a few days or weeks" (2025-08-10).
- **Day-one entry and stop.** The opening range break with the stop at the day's low: "Can enter there and place a stop
  at LOD and see how far it goes." (GRRR, 2025-06-20). On OKTA: "Should have kept ER day low as a stop that was a
  mistake I think." (2026-09-06).
- **Volume matters.** "Would prefer higher volume on Day 1 move." (RMBS, 2025-08-03; that day was 3.8 times the 50-day
  average on our bars, section 6.7). On the open itself (GRRR, 2025-06-20, his watchlist): "Look for relatively high
  volume in the first 1-2-3 minutes of the session. If it trades it’s average daily volume (2 million shares) in the
  first 5 minutes then press the gas".
- **The later setup (his "classic PEG").** "Classic PEG set up. Makes a 4 to 5 day move following a notable earnings gap
  up. Pulls back, consolidates, holds the moving averages and actually it held the earnings day close perfectly."
  (TWLO, 2026-05-24).
- **Levels he watches after the gap.** The gap-up low ("Earnings gapper consolidating below $100 and above the gap up
  low.", GH, 2025-11-16), the earnings-day close, the earnings-day HVC, the AVWAP from earnings, and the 9 and 20-day
  EMAs.
- **Keep the gap open.** "We want to see bull gaps stay open because it shows who is in control of the strength."
  (TSLA, 2025-11-02). His Gap Support ruling says the same: "Prefer holding open gap vs filling gap btw" (verdict lines
  225 and 227).
- **Track them.** A quarterly list: "Make sure to track ER GAPPERS for the quarter and make your PEG list!" (his
  section, 2026-07-12). The calendar section of 2026-01-25 (no byline) adds: "Making and tracking a “PEG list” is
  critical to keeping organized the notable earnings gappers for the quarter."
- **Not under the 200-day.** His hard rule B26. The Index and ETF section of 2026-05-24 (no byline), on software: "Cannot
  justify stocks below 200SMA with so many other things acting properly right now at highs."

### 3.2 The Model Book card (UCT, `app/src/pages/modelbook/setupCatalog.js`)

- Essence: "A headline-driven gap that holds its range — traded off the first pullback and reclaim." (The dash is in
  the card's own text.)
- Family "Gaps & Catalysts", direction long.
- The mini-chart (glyph): five quiet days, a 9% up day, two down days, one small up day, then a trigger day that closes
  at its high. The dashed trigger line is the gap day's high (`pivot: { idx: 5, side: 'h' }`). Worked through the
  glyph code (`buildCandles` in `app/src/pages/modelbook/SetupsView.jsx`), the pullback holds the upper half of the gap
  day's range and the trigger closes above the gap day's high.
- There is no playbook write-up for this card in `app/src/pages/modelbook/setupPlaybooks.js`, so the setups page shows
  its "being authored" placeholder. There is no row for it in `docs/study/TRADE_PLANS.md`.

### 3.3 Pradeep Bonde (Stockbee; originator of the Episodic Pivot)

Read: "Gaps and traps" (2006-11-22, his replies to a reader), "Trading Earnings Breakouts" (2007-01-06), "Up stocks and
down stocks" (2007-02-15), *Episodic Pivots and "Idea Pickle"* (2007-02-26), "How to trade earnings" (2007-03-30), "How
to trade earnings Part 2" (2007-03-31), "How to trade earnings Part3" (2007-04-01), "Earnings and Bulkowski"
(2007-04-04), "What are Episodic Pivots and how to find them" (2010-02-12, with his replies in the comments), "My process
flow for Episodic Pivots (EP)" (2014-07-30, with his replies), "Delayed reaction Episodic Pivots" (2024-05-15, a video
with no text) and "Scans Irun in Marketsurge to find Delayed Reactions Episodic Pivots (EP)" (2025-09-01). (Part 2 lives
at `/2007/03/how-to-trade-earnings-part-2.html`; the `/2007/04/` address tried first does not exist.)

- **Catalyst, earnings.** "I only track companies whose earnings are up 100% or more quarter over quarter and the
  earnings should be at least 5 cents. Sales/revenue should be up 5% or more." (2007-03-30). Part 2 adds a sales-only
  route: "I track companies which had a 100% plus sales/revenue growth and recent quarter sales/revenue are above 10
  million." (2007-03-31). Part 3 sets the floor while he keeps 100% to cut the list: "Anything less than 25% is not
  worthwhile." For EP candidates he checks: "Context of the earnings. Is this a first major earnings acceleration."
  (2010).
- **Catalyst, news.** "Earnings is not the only catalyst which can move a stock big, many other catalyst can lead to big
  moves." (2010). His 2010 list of "Different Type of Episodic Pivots" includes new orders or contracts, buyouts and
  mergers, new products, regulatory changes, drug approvals, shortages, analyst upgrades and media mentions. But not all
  news is equal (2007-02-26): "Earnings, new product, analyst earnings change, increased earnings guidance, sector moves
  etc have high probability to trigger multi month rallies." And: "James Crammer, Barron's, WSJ, and other publication
  mentions, analyst upgrade etc. have a low probability of follow through."
- **Size of the move.** In 2006 he looked at gaps: "So I always investigate 20% plus gaps on both side to see
  opportunities." and "I look at 20% plus 1 million volume." His later published scans measure the CLOSE against the
  prior close, not the open (2007-02-26, 2010, and the 2014 in-session scan), while his 2014 routine starts from moves
  made before the open: "Analyse all after hours movers up 4% plus on 50k volume". 2010:
  `((C - C1) >= 5 AND V > 10000 AND C >= 62.50 AND V > V1) OR ((( 100 * (C - C1) / C1) >= 8 AND V > 3000 AND (100 * V / AVGV100) >= 300) AND C > 1)`
  (an 8% up day on 300% of the 100-day average volume, or a 5-point day for stocks above $62.50). 2014: "During the day
  Run EP scan c/c1>1.04 and v>3*avgv50.1 and v>=300000 multiple times , see if there is stock with neglect+ game
  changing earnings". Asked why 8%: "Going by past experience and research typically a stock which makes 85 [sic] plus
  kind of move on earnings tend to do well." He uses the scan as a starting list only: "I buy less than 1% stocks from
  that scan."
- **Volume.** "If volume is very high, you can assume move has legs." Big winners "will have huge volume surge,
  typically of 10 times or more compared to average volume." And: "In many cases the volume on earnings day might be
  the highest volume in the history of the stock or multi year high volume." (all 2010).
- **Prior trend (neglect).** "I am looking for stocks which have not rallied in anticipation of earnings." He measures
  it as "how much they are up in last 65 days or so" (2007-03-30). Widely followed names do worse: "Earnings breakout on
  companies with significant analyst coverage do not do as well as the first kinds." (2010).
- **The late gap he avoids** (2006, on exhaustion gaps): "The stock gaps up like HANS but by that time it was up more
  than 800% say in a year, so when the grandma in Timbuktu gets excited about it, it is exhaustion gap." And on reading
  any gap: "One has to look at catalyst plus the magnitude of gap."
- **Float.** "Float below 25 million is ideal for this. The best moves happen on float below 10 million." (2010).
- **Entry.** Day one, early: "Most of the time I will enter in the morning and add to position later if the volume
  climbs above average volume." and "So if you don't enter on the earnings day you will be just a observer."
  (2007-03-30). 2014: "If I find a good EP I buy immediately in pre or post market." and "Most EP where I made big money
  I bought in pre market." Asked whether he buys at the market or with a limit, he answered "ATM" (2021 comment). He
  accepts a later entry as a second way: "Buying after the bull flag is formed is another way to play the earnings."
  (2007-04-04).
- **Stop.** "Stops: I put stops 1 dollar below the gap low if it is gap up or at 2 days low and trail with stop."
  (2007-03-30). 2010 comment: "In such cases the stop is the low of last 2 days before entry." 2017 comment: "Yes. It
  is normally low of the EP day."
- **Exits.** "In these trades I move my stops quickly once it makes 20% move." (2007). "The exits are in 4 parts with
  profit target of 20% plus." (2010 comment). Expected path: "Most of these breakouts will have minor pullback at best
  and just go up for 2 to 6 weeks before having a reaction." (2007).
- **Watch list.** "I maintain a watch list of stocks which respond with a high breakout on earnings day of 4% plus for
  next one year." (2007-03-30). And a "monthly EP scan to find stocks that breakout later after earnings" (2010 comment).
  By 2024 he names this the delayed reaction EP (a 2024-05-15 video post, "Delayed reaction Episodic Pivots"); his
  2025-09-01 post lists Marketsurge scans for "delayed reaction entries" (screens shown as images, not read here).
- **Three outcomes after earnings** (2007-04-01): "1) immediate breakout 2) no reaction stock continues in range (this
  might breakout later closer to next earnings)" and a third, "reversal ( this typically happens after a string of
  earning surprises and significant price growth)."

### 3.4 Kristjan Kullamägi (Qullamaggie)

Read: "3 TIMELESS setups that have made me TENS OF MILLIONS!" (2021-01-08, updated 2021-04-28) and "How to master a
setup: Episodic Pivots" (2021-11-02).
- **Catalyst.** "When unexpected good news hits a stock, especially if that stock is neglected, that can trigger
  multi-month, and multi-year moves." Types: earnings and guidance, political and regulatory, FDA and biotech, contracts
  and partnerships, and the "sector EP (when you have a sector that is red hot, the stocks in that sector can move in
  gaps and make big moves without any specific news)". His preference: "I have personally found most success in
  earnings EP as they are easy to find and easy to understand. Biotech EPs are the most difficult".
- **Gap.** "My definition (this may differ from Pradeeps) is a gap up of 10% or more." And: "An EP needs to be a gap of
  10%+ and big volume should be there, if not in pre-market then the first 5-10 minutes after the open." A small gap
  that sells off: "the stock gapped up slightly but sold off. This is not an EP."
- **Volume.** "There has to be massive volume near the open, ideally the stock should trade the average daily volume the
  first 15-20 minutes or even quicker." And: "Volume is the #1 thing to focus on."
- **Prior trend.** "The best EPs are on stocks ones [sic] that have gone sideways for 3-6 months or more." A second EP
  after a big run: "these can work but the failure rate is higher and the move probably won't be as big." And: "It's
  best if the stock has not rallied over the past 3-6 months."
- **Fundamentals.** "Ideally triple digit year over year (YoY) earnings and sales growth but mid/high double digits works
  really well too." Plus "a big analyst beat" and "a big guidance higher".
- **Entry.** "Enter opening range highs. ORH can be the highs of the first 1-, 5-, or 60-minute candle. The stop is at
  the lows of the day." He waits for the open: "I rarely trade in extended hours but prefer to wait for the opening range
  highs". And: "No need to be first in."
- **Stop.** "Stop is always at the lows of the day." With a size limit: "Make sure your stop is no more than 1x, or
  maximum 1.5x the average daily range or the average true range."
- **Trail.** "Trail your stop with the 10- or 20-day moving average once they surpass your initial stop." In the same
  post: "You can trail these with the 20- or 50-day moving average, or whatever you find to work the best."
- **Position cap.** "I don't believe you should ever have more than 30% of your account over night in any stock or
  ETF." (A general rule in the introduction of the 2021-01-08 post, before the three setups; not written for the EP
  alone.)
- Note: his "sell 1/3 to 1/2 of the position after 3-5 days" rule is written for his Breakout setup, not for the EP.
  The ORH entry, the day's-low stop and the 10- or 20-day trail above sit under the post's "Episodic Pivot (EP)" heading;
  the 1 to 1.5 times ADR/ATR cap, "No need to be first in." and "Volume is the #1 thing to focus on." are from the
  2021-11-02 post.

### 3.5 Gil Morales and Chris Kacher (the buyable gap-up)

Read: their FAQ answers and two reports on virtueofselfishinvesting.com (dates in section 11), and Bulkowski's summary
of their *Active Trader* article (via WebFetch).
- **What makes a gap buyable** (FAQ, 2010, updated 2012): "A stock gapping up is buyable if it is showing top quality
  fundamentals (excellent earnings, sales, return on equity, pretax margins, industry group, institutional support,
  etc) as well as top quality technicals".
- **Size and volume, as Bulkowski reads their 2010 article:** "Find up gaps in stocks that are at least 75% of the 40-day
  average true range (ATR)." and "Volume on the day price gaps higher must be at least 1.5 times the 50-day average."
  The repo's screener notes that a second phrasing of the volume rule exists and refuses to implement it until the
  book is read (`api/services/screener/base_catalog.py`).
- **Prior trend.** Bulkowski's reading: "The stock must be trending upward, or breaking out of a consolidation area
  several days or weeks long." Their FAQ (2013): "A stock should normally have doubled before a BGU to make the BGU more
  likely to succeed." But a gap after a long run is "extended" (FAQ, 2010): "the LVS gap up strikes us as extended
  because it occurred after a nearly 4-month uptrend in the stock."
- **Entry.** There are "indeed no hard and fast rules that govern when to buy gap ups" (FAQ, 2010). The trade-off (FAQ,
  2012, updated 2025): "The risk in not buying at the open is that you have a runaway gap where the stock continues
  higher, putting it out of reach" and "The risk in buying at the open is that the stock closes the gap or the stock
  does not trade sufficient volume to qualify as a BGU." Their split: "we have suggested one buy a half position at the
  open, and the other half later in the day, or in ensuing days if the stock has had a runaway gap." Later is fine:
  "once the gap-up day occurs, it is buyable anywhere near or within that first-day's trading range." (report,
  2011-02-12).
- **Stop.** Book Rule #2, page 171, as their FAQ quotes it: "In the days following the gap-up, sell if the stock trades
  below the intraday low of the gap-up day." And: "One can allow the stock to close first before deciding whether to
  sell on an intraday move below the gap-up day's intraday low." Room under the low: "A 1-2% undercut can be permitted
  in some cases." Another FAQ (2025) gives "perhaps a 2-3% undercut of the low of the gap day as wiggle room". After the
  fifth day: "the porosity which is the amount of room given for the stock to undercut the low of the gap up day should
  be minimal to zero" (the 6-day rule, 2013). Their risk cap comes first: "If your maximum risk is 7-8%, then you adhere
  to that rule first, and perhaps not buy that gap up because it is beyond your risk level."
- **The gap must not close.** "truly powerful buyable gap ups do not close their gap but continue higher from the gap up
  point." (report, 2011-11-03). And (FAQ, 2012): "If the stock continues lower after closing the gap, it is generally
  best to sell since buyable gap ups do not close their gaps."
- **Hold and sell (Bulkowski's reading of their 2010 article, his words, confirmed by WebFetch).** "Sell if price
  violates a 10-day SMA providing the trade has lasted at least 7 weeks. If less than 7 weeks, look for a violation of
  the 50-day SMA." A violation "is defined as price closing below the simple moving average (SMA) and the coming day(s)
  sees price make a lower low". His reading of the stop: "Sell if price closes below the low posted on the day price
  gaps up." I did not read the authors' own wording of the moving-average rule (it is not in the FAQs read).
- **Market.** "Performance is highly dependent on the health of the general market." (FAQ, 2014, updated 2022).

### 3.6 Thomas Bulkowski (event patterns, thepatternsite.com, read via WebFetch)

Definition of the family: "Event patterns are price patterns caused by significant events that affect securities."
Warning: "Event patterns have failure rates that are often significantly higher than your average chart pattern."
- **Earnings flag.** Trend: "Performs best in an upward price trend." Event: "When the company announces earnings, the
  stock makes a large move up or price gaps upward the next day". Shape: "Look for a near vertical price run, preferably
  lasting several days." then "Near the top of the flagpole, price consolidates and usually trends downward." Best:
  "The best performers are tight congestion patterns, not loose price structures with the stock meandering up and
  down." Buy: "Buy when price pierces a flag or pennant trendline (D in the figure to the right)", and the same sentence
  goes on "or rises above the event pattern's high (A)". Location: "The best
  performers occur in a price uptrend but they are within a third of the yearly low." Exit: "If price shows weakness in
  the first week, consider selling."
- **Good earnings surprise.** "This event pattern works best in a bull market." The day: "Look for announcements in
  which price makes a large intraday price swing" of "2 or 3 times the average daily intraday price range over the last
  month." Volume: "Select patterns with heavy announcement day volume, above the 30-day average." Location: "For best
  performance, select announcements that occur within a third of the yearly low". The trigger: "A breakout occurs when
  price closes above the high posted on the announcement day." Patience: "Wait for price to confirm the pattern because
  traders may push price down instead."
- **FDA approvals and broker upgrades** use the same trigger (a close above the announcement day's high). For FDA
  approvals the best location is the opposite end: "For best performance after an upward breakout, select announcements
  that occur within a third of the yearly high."

### 3.7 Deron Wagner, Morpheus Trading (breakaway gaps, 2018-09-06, modified 2022)

- Base: "Breakaway gaps should occur following a valid basing pattern of at least four to five weeks in length."
- Volume: "On the day of the gap, volume should be at least three times greater than the 50-day volume average."
- The day: "The stock should be up more than 5%, and as much as 20-25%, by the end of day. Any stock that fills the
  opening gap should be avoided."
- Fundamentals: "In general, we aim to stick with stocks that have strong earnings and revenue growth."
- Entries, in order: day one ("The most aggressive buy: Buy after the first one or two minutes of trading (to make sure
  the stock doesn't sell off immediately on the open)." with "a stop 5-10% below the entry"); an inside day ("Wait for a
  tight-ranged inside day on lighter volume to print within a few days of the gap."); the 10-day line ("the first test
  of the 10-day moving average (MA) can serve as a low-risk entry point."); then the 20-day EMA and 50-day line with a
  reversal candle, "as long as the gap was not filled."
- Stop in his worked trade: "we followed our trade plan and stuck to the original stop price (below the low of the
  gap)."

### 3.8 StockCharts ChartSchool ("Gaps and Gap Analysis")

- A true gap: "For an up gap to form, the low price after the market closes must be higher than the high price of the
  previous day."
- Volume: gaps "are considered significant when accompanied by above average volume."
- Breakaway gaps are not quickly filled: "Avoid falling into the trap of thinking this type of gap, if associated with
  good volume, will be filled soon."
- The danger at the end of a run: "Exhaustion gaps happen near the end of a good up or downtrend."

### 3.9 Investor's Business Daily (teaser only)

"The Breakaway Gap: How To Buy Strength While Managing Your Risk", by Rachel Fox, published 2026-05-28 (page metadata).
The body is paywalled. The free teaser says: "You've just witnessed the breakaway gap, which might seem like a missed
opportunity." I give no rule from it.

An older IBD article republished on Yahoo Finance ("Buying When A Stock Gaps Up Can Be Scary But Also Profitable",
credited to Investor's Business Daily, dated 15 April 2015; read through WebFetch only, because Yahoo refused a plain
download with HTTP 429) carves gaps out of IBD's chase limit: "Normally, we're told not to chase stocks that are
extended more than 5% from a proper buy point." and then "Gaps are exceptions." It gives no stop or volume rule.

### 3.10 The house brain template (compiled, author unclear; low weight)

`docs/superpowers/research/setups/setup_criteria.json` records the firm brain's "News Gappers" entry as mapped to
"Gap-and-Go (various) + BGU (Morales)", with lines such as "do not chase stocks already up 20%+ in prior 30 days" and
"waiting for the 30-minute close improves entry by 1-2% as initial open volatility can be 3-5% range driven by retail
order flow". The same record notes its own inconsistency (3%+ in one place, 5%+ in another). No person is named and no
measurement is shown, so I treat it as a draft, not a source.

### 3.11 The UCT course draft (`docs/curriculum/`, author not named)

`uct_method_scripts.json` has a 12-minute lesson, "News/Earnings Gapper: Trade the First Pullback and Reclaim, Not the
Open". It treats the setup as an intraday trade on 5-minute charts and ends on "the one-line rule the member repeats:
never the open, always the reclaim." Its worked numbers in two chapters ("Entry $31.20, pullback low $29.95") name no
stock, although the script calls one of those chapters "a real loser"; the chart notes for the same chapters point to
META on 2023-02-02 at different prices (a reclaim near $187, a stop near $184.50), so the figures cannot be traced to a
real trade. `docs/study/UNITS-method.md` (SET.20) carries the same lesson title and the same idea in its own words
("never the emotional open"). This conflicts with the owner's own words (section 6) and is not an outside source.

### 3.12 Read but not used, or could not read

- StockCharts ChartWatchers, "How to Profit from Strong Earnings Reports While Reducing Risk" (2021): an opinion piece
  on waiting until after the report; no rules or numbers. Not used.
- Brian Shannon (alphatrends.net): two AVWAP pages read; neither mentions earnings, so nothing from him is quoted here.
  UCT anchors AVWAP to the earnings day (Bracco, section 6.4).
- Not reached: TraderLion (HTTP 403 to a plain download and to WebFetch; a search result lists a TraderLion page titled
  "Pradeep Bonde: Episodic Pivots Delayed Reactions", https://traderlion.com/?p=406502, which could not be opened, so
  nothing from it is used), the IBD article body (paywall), TraderPlanet's buyable gap-up article (the site returned an
  error), the abstract of Chan (2003) (publisher 403; RePEc has no abstract), Minervini's own pages.

### 3.13 Comparison table

| criterion | Owner (UCT) | Bonde | Kullamägi | Morales and Kacher | Bulkowski | Wagner |
|---|---|---|---|---|---|---|
| catalyst | earnings first; news, PRs, partnerships, government stakes | earnings (100%+ growth; 25%+ minimum) or 100%+ sales growth; ~20 news types, some low quality | earnings and guidance first; political, FDA, contracts, sector | top fundamentals, a leading stock | an earnings report (or FDA approval, upgrade) | strong earnings and revenue growth |
| gap size | no number; his named examples gapped 3.7% to 58% | 20% gaps on 1 million shares (2006); close-to-close 4% (2014) or 8% (2010); the 2014 routine starts from after-hours movers up 4% | open gap 10%+ | 0.75 x the 40-day ATR | large move or gap; day swing 2-3x the average range | up 5% to 25% by the close |
| volume | "Would prefer higher volume" | 3x the 50-day (2014); 300% of the 100-day (2010); big winners 10x | average daily volume in the first 15-20 minutes | 1.5x the 50-day (Bulkowski's reading) | above the 30-day average | 3x the 50-day |
| prior trend | out of bases; RS; first of its group | not rallied in the last ~65 days; neglected | sideways 3-6 months; second EPs fail more | trending up or out of a consolidation; doubled before; not after a 4-month run | earnings flag: uptrend but within a third of the yearly low | base of 4-5 weeks or more |
| 200-day | no longs below it (B26, hard) | not stated | not stated | not stated | yearly-range location, not the 200-day | not stated |
| day-one close | holds the gap; weak closes noted | not stated | a gap that sells off is not an EP | must not close the gap | (event day defines the trigger) | must not fill the gap |
| entry | ORB on day one, or the build-out (higher low, red to green, Oops, 30-minute pivot, slingshot) | the morning of the gap or pre-market; later on a bull flag | ORH of 1, 5 or 60 minutes | half at the open, half later or on later days | close above the announcement-day high; flag trendline break | after 1-2 minutes; inside day; 10-day, 20-day, 50-day tests |
| stop | day's low (ER-day low); sometimes the 50-day | $1 under the gap low or the 2-day low; "normally low of the EP day" | low of the day, at most 1-1.5x ADR/ATR | intraday low of the gap day, 1-2% (or 2-3%) room, none after day 5; 7-8% cap | not given for this pattern | 5-10% under entry, or under the gap low |
| exits and trail | house plan (section 9 of the rulebook): trail the 10-day or 21-day (E52) | stops up fast after +20%; 4 parts, 20%+ target | 10 or 20-day trail (20 or 50-day also mentioned) | 10-day after 7 weeks, else the 50-day (Bulkowski's reading) | sell weakness in the first week; measured target | not given |
| liquidity | $10 and $20M a day (B23) | likes floats under 25M | passed illiquid ones | not stated | not stated | not stated |

### 3.14 Where the sources disagree

1. **Day one or later.** Bonde: buy day one, often pre-market ("you will be just a observer" otherwise). Kullamägi: day
   one, but at the opening range; he "rarely" trades extended hours. Morales and Kacher: half at the open, half later.
   Wagner: day one or an inside day or the 10-day test. Bulkowski: wait for a confirming close above the event day's
   high. The UCT course draft: "never the open". The owner: both, with a stated love of day one.
2. **Gap measured from the open or the close.** Bonde's published scans (2007, 2010, the 2014 in-session scan) measure
   the close (C/C1), so a stock that opens flat and closes up 8% qualifies, although his 2014 routine starts from
   after-hours and pre-market movers and his 2006 replies speak of gaps. Kullamägi, Morales and Kacher and ChartSchool
   measure an opening gap; Wagner sizes the day by its close (section 3.7, "by the end of day") on a day that must not
   fill its opening gap.
3. **How big.** 20% (Bonde 2006), 4% (Bonde 2014), 8% (Bonde 2010), 10% (Kullamägi), 0.75 ATR (Morales and Kacher), 5%
   by the close (Wagner). The owner named a 3.7% gap (TXN) as an "ER gapper".
4. **Neglected or already strong.** Bonde and Kullamägi want a quiet stock that has not run. Morales and Kacher want a
   stock that has normally doubled, yet call a gap after a 4-month run extended. Bulkowski's earnings patterns do best
   "within a third of the yearly low"; his gap page says "The best performance comes from breakaway gaps in a bull market
   near the yearly high." The owner's named examples cover both: leaders well above their 200-day (OKTA, TWLO in May
   2026), a stock just under its 200-day before the gap (DELL), and a long-neglected name (FSLY: "an old pre Covid IPO
   that went on an 800% move in 2020. Since has been beaten to hell.").
5. **Stop.** Day's low (Bonde 2017, Kullamägi, the owner), $1 under the gap low or the 2-day low (Bonde 2007), the gap
   day's low with 1-3% of room (Morales and Kacher), 5-10% (Wagner's aggressive entry), the gap midpoint (our Chart IQ
   engine, section 5.3, and the house brain template in 3.10; no outside source found for it).
6. **Pre-market buying.** Bonde does it and says his biggest wins came from it. Kullamägi rarely does. The house rule E58
   forbids it.
7. **Float and size.** Bonde prefers floats under 25 million. The house trades only $10 stocks with $20 million a day
   (B23), which removes most of Bonde's best cases.

---

## 4. Measured evidence

### 4.1 Published statistics (every number with its source and its limits)

**Bulkowski, event patterns** (thepatternsite.com, via WebFetch; the earnings flag, good and bad earnings surprise and
FDA pages each say "The above numbers are based on hundreds of perfect trades."; the broker upgrade page states no
basis for its numbers):

| pattern | rank | break-even failure rate | average rise (decline) | throwback (pullback) | met target |
|---|---|---|---|---|---|
| earnings flag | "1 out of 6" | 10% | 34% | 63% | 86% |
| good earnings surprise | "5 out of 6" | 29% | 24% | 41% | 76% |
| broker upgrade (up breakouts) | "2 out of 6" | 18% | 24% | 63% | 81% |
| FDA approval | "6 out of 6" | 34% | 20% | 61% | 81% |
| bad earnings surprise (bull-market table, not split by direction) | "3 out of 5" | 31% | (13%) | 41% | 69% |

Also: good surprise, "Almost half (48%) rise just 10% before tumbling and that occurs in less than 2 weeks."; bad
surprise, "For those with downward breakouts, almost half (47%) bottom in one week, and 60% bottom in less than two
weeks." Limits: the pages say the numbers come from "perfect trades", a term his glossary does not define; the glossary
does define the averages: "The average rise/decline measures from the opening price the day after the breakout to the
ultimate high or ultimate low.", the ultimate high being "The highest peak before price declines by at least 20%,
measured from the high to the close." No trader sells at that peak. The break-even failure rate counts patterns that
"fail to rise (upward breakout) or decline (downward breakout) by at least 5%" (glossary). The pages give no sample size
or date range. The triggers are a close above the event day's high or a flag break, not a day-one buy.
Bonde (2007-04-04) read the same work: "According to his article and book it is the best performing event pattern with
average 34% returns."

**Bulkowski, gaps** (gaps.html, "Updated and added 10 examples on 8/8/25."; "The above numbers, combined, are based on
over 1,100 samples."). Share of upward gaps closing within a week: area gaps 85%, breakaway gaps 1%, continuation gaps
8%, exhaustion gaps 60%. Median time to close in a bull market: breakaway, 89 days (up gaps); continuation, 45 days;
exhaustion, 6 days; area, 3-4 days. Limit: the gap type is judged from the trend around it, so part of the label is
only known after the fact (my reading, not his words). And: "Gaps that occur on the day of a chart pattern breakout
suggest a better performing chart pattern two out of three times,".

**Bulkowski's test of the Kacher-Morales gap rules** (KacherMorales.html): "Having said all that, I used 557 stocks in
the test with daily price data from March 12, 2001 to October 1, 2010." Results over 16 tests: "Average gain ranges
between 1.2% and 3.1%", "Win/loss ratio ranges between 28% and 32%", "Average drawdown: 5.5% to 8.9%". His verdict: "I
don't recommend this setup, but test it for yourself and make up your own mind." Limits, his own: he says his test did
not fully copy the authors' rules (he did not test the fundamentals or the consolidation rule), and one stock drove much
of the best result ("Removing that stock and the average gain drops from 3.1% to 2.6%").

**Adam Grimes, "Gap Study (3/3)"** (SMB Training blog, 2010-10-02). Current S&P 500 members over the two years to
2010-10-01 ("N=125,811"): "Large gaps (>5% or <-5%) close only 9.6% of the time. (N=279)". In his first sample: "gaps
over 5% close less than 30% of the time." Limits: S&P 500 names only, two years, survivors of 2010's index; a gap
"closes" when it trades back into the prior day's range, and I did not read parts 1 and 2 for the exact time window.

**Academic.** Frazzini (2006, *Journal of Finance* 61(4): 2017-2046), abstract: the drift is strongest when holders'
gains and the news point the same way, and an event strategy "yields monthly alphas of over 200 basis points." Gervais,
Kaniel and Mingelgrin (2001, *Journal of Finance* 56(3): 877-919): the high-volume return premium (section 1). Bernard
and Thomas (1989, *Journal of Accounting Research* 27: 1-36) is the classic drift paper; RePEc carries no abstract and I
give no number from it. Limits: these are portfolio results across thousands of stocks, before costs, mostly from older
data; none tests a gap-day entry with a stop.

**Practitioner claims that are not statistics.**
- Wagner: "When market conditions are solid, breakaway gap ups are a powerful buy signal that can produce gains of
  40-100% in just two to three months of trading." No sample.
- Morales and Kacher: the gap-up's risk perception "is not valid, as we know from studying buyable gap-ups" and "the
  odds are certainly in your favor, as the statistics prove out" (2011 report). No statistics shown.
- A Stockbee reader's backtest (comment, 2010-02-21, not Bonde): the raw EP scan gave "about 6% CAR", rising to about
  50% when he added Bulkowski's earnings flag. One unverified comment; Bonde's reply was that he buys under 1% of the
  scan's names.

### 4.2 UCT's own measurements (in the repo, not published to members)

- **The engine's Episodic Pivot flag** (`api/services/ep_base_rate.py`, measured 2026-09-28 on the owner's engine
  database). Resolved flags are those closed after the hold window or stopped at -8%; "followed through" means the final
  tracked price was above the flag-day entry. By the engine's own selection rule the record reads "189/448 = 42.2%";
  read correctly (last row by id) it reads "76/447 = 17.0%". The backlog dates the flags 2026-02-20 to 2026-09-25
  (`docs/terminal-research/10-roadmap/backlog.md`, TERM-090). Limits: these are the uct-intelligence engine's own EP
  flags, and how that engine picks them is not visible from this repo (the engine is a separate repo, not checked out
  here), so I cannot say what share were earnings gaps. The module's own notes say the engine keeps a separate
  `Earnings-Gap` flag, which this count leaves out ("`Earnings-Gap`, `Stage2`, `VCP` ... are other flags"). They were entered at the flag-day price with a fixed -8% stop,
  over about seven months of one market. Read plainly: most of those flags, bought blind, did not follow through.
- **The EP v2 lab detector** (`uct_ep_v2.py`) reports detection quality, not trading results: on random days "13 yes / 4
  no / 8 ambiguous".

### 4.3 New measurements for this dossier (local daily bars, read-only)

**Data.** The test machine's daily bars and the repo's earnings-date cache
(`docs/study/setups/earnings_dates_cache.json`, Yahoo's reported dates via yfinance, built by
`docs/study/audits/2026-11-05/build_next_pass.py`). The 990 stocks in both, from each stock's first listed earnings
date, 2000-04 to 2026-11. Scripts and outputs are in the session scratchpad (`setups/22-news-gapper/tools`, `measure`).

**A gap event.** The open is 4% or more above the prior close (and under 100%, to drop split errors); volume is 2 times
or more the prior 50-day average; the prior close is $10 or more and the prior 50-day average dollar volume is $20
million or more (B23); not within 10 sessions of an earlier event in the same stock. 11,461 events in 959 stocks.
**Earnings gap**: a listed earnings date falls between the prior session and the gap day (a report after the prior
close or before the gap day's open): 6,855. **No earnings**: no listed date within 5 sessions either side: 3,885. The
721 in between were left out of the split.

**The trades.** All use the house plan from the rulebook: a third off at 3R with the stop to breakeven, a third at 5R,
the last third out on a close under the 10-day average; a gap through the stop exits at the open; under 1R after 10
sessions exits at the close (C33); a 120-session cap; if a stop and a target fall on the same day, the stop is counted.
No commissions or slippage.
- **Buy A, day one (a proxy).** Buy at the gap day's close, stop 0.1% under the gap day's low. The real day-one buy is
  at the opening range high, which daily bars cannot see.
- **Buy B, the first pullback and reclaim (the course draft's reading).** After the gap, two or more down closes in a
  row starting within 8 sessions, no close under the gap-day low; buy when a later session trades above the prior
  session's high (within 12 sessions of the gap); stop 0.1% under the pullback low; if that entry day also trades under
  the stop, a full loss.
- **Buy D, the Model Book glyph read literally.** At least one down close after the gap, no close under the gap-day low,
  then the first close above the gap day's high within 20 sessions; stop 0.1% under the lows since the gap day.
- **Buy C, Bulkowski's confirmation.** The first close above the gap day's high within 20 sessions; stop 0.1% under the
  lowest low since the gap day, the gap day included.
- **Baseline.** 11,784 random days in the same stocks under the same floors, bought at the close with the stop under
  that day's low, same plan: **+0.04R a trade (standard error 0.03), 29% winners** in the writer's run. Random days
  whose stop was 2.5% to 4.5% (like a gap day's): +0.06R (0.05). **Cold check 2 re-ran the same script on the same
  database a few hours later** (the database had taken new bars, so the same seed drew a different set of days; 7,315 of
  the 11,784 days were the same): **+0.09R (0.03), 30% winners**; the 2.5% to 4.5% slice +0.11R (0.05). Read the
  baseline as somewhere between +0.04R and +0.09R, with 20-session drift of about +0.8% to +0.9% in both runs.

**Results** (R per trade with its standard error in brackets; "held" = no close under the gap-day low in the next 10
sessions):

| group | events | held 10 sessions | traded back to the prior close within 20 | mean change, day-one close to 20 sessions later | Buy A: R (se) | Buy A winners | Buy A reached 3R | Buy B: R (se), n | Buy D: R (se), n | Buy C: R (se), n | Buy A stop, median |
|---|---|---|---|---|---|---|---|---|---|---|---|
| all gap events | 11461 | 49% | 47% | +0.7% | +0.16 (0.04) | 34% | 22% | +0.02 (0.03), 4745 | +0.05 (0.03), 2673 | +0.07 (0.01), 7412 | 3.2% |
| earnings gaps | 6855 | 55% | 41% | +1.0% | +0.23 (0.05) | 37% | 22% | -0.01 (0.03), 3073 | +0.05 (0.03), 1726 | +0.08 (0.02), 4404 | 3.2% |
| no earnings within 5 sessions | 3885 | 40% | 57% | +0.1% | +0.01 (0.06) | 29% | 21% | +0.06 (0.05), 1390 | +0.05 (0.06), 790 | +0.04 (0.03), 2531 | 3.2% |
| earnings, gap-day close above the 200-day | 5002 | 56% | 36% | +0.9% | +0.21 (0.04) | 38% | 22% | -0.02 (0.04), 2313 | +0.05 (0.04), 1281 | +0.08 (0.02), 3225 | 3.3% |
| earnings, gap-day close below the 200-day | 1853 | 50% | 52% | +1.3% | +0.28 (0.14) | 35% | 24% | +0.03 (0.07), 760 | +0.06 (0.06), 445 | +0.10 (0.03), 1179 | 3.0% |
| no earnings, close above the 200-day | 2345 | 44% | 49% | +0.3% | +0.10 (0.07) | 30% | 21% | +0.03 (0.07), 904 | +0.03 (0.06), 525 | -0.01 (0.03), 1567 | 2.9% |
| no earnings, close below the 200-day | 1540 | 34% | 69% | -0.3% | -0.11 (0.11) | 26% | 21% | +0.11 (0.10), 486 | +0.09 (0.11), 265 | +0.12 (0.05), 964 | 3.6% |
| earnings, gap 10% or more | 1669 | 54% | 28% | +1.3% | +0.18 (0.06) | 36% | 23% | +0.00 (0.07), 746 | +0.02 (0.06), 405 | +0.05 (0.03), 1056 | 4.0% |
| earnings, gap 4% to 8% | 4194 | 55% | 47% | +0.9% | +0.26 (0.07) | 37% | 22% | -0.02 (0.04), 1873 | +0.02 (0.04), 1072 | +0.09 (0.02), 2715 | 2.9% |
| no earnings, gap 10% or more | 723 | 41% | 40% | +0.4% | +0.03 (0.11) | 30% | 23% | -0.04 (0.12), 262 | +0.03 (0.16), 138 | +0.09 (0.08), 435 | 4.1% |
| earnings, volume 3x or more | 4119 | 58% | 33% | +1.1% | +0.18 (0.04) | 38% | 21% | -0.02 (0.04), 1948 | +0.02 (0.04), 1101 | +0.07 (0.02), 2693 | 3.6% |
| earnings, closed in the upper half | 3609 | 68% | 27% | +1.1% | +0.16 (0.03) | 41% | 17% | -0.02 (0.04), 2058 | +0.02 (0.04), 1135 | +0.09 (0.02), 2722 | 5.0% |
| earnings, closed in the lower half | 3246 | 40% | 55% | +0.8% | +0.30 (0.10) | 32% | 28% | +0.01 (0.06), 1015 | +0.10 (0.05), 591 | +0.07 (0.03), 1682 | 1.6% |
| no earnings, closed in the upper half | 2093 | 48% | 50% | -0.4% | -0.14 (0.04) | 29% | 16% | +0.03 (0.07), 918 | -0.04 (0.07), 529 | +0.06 (0.04), 1498 | 5.4% |
| earnings, opened above the 60-day high | 3017 | 56% | 34% | +0.5% | +0.16 (0.05) | 37% | 21% | -0.06 (0.05), 1386 | +0.01 (0.04), 777 | +0.05 (0.02), 1875 | 2.9% |
| earnings, quiet before (3-month change -15% to +15%, 60-day range 35% or less) | 3502 | 57% | 36% | +0.6% | +0.29 (0.05) | 38% | 23% | +0.00 (0.05), 1606 | +0.09 (0.04), 902 | +0.09 (0.02), 2232 | 2.8% |
| earnings, up more than 30% in the 3 months before | 603 | 48% | 49% | +1.4% | +0.15 (0.15) | 34% | 23% | -0.02 (0.11), 259 | -0.02 (0.12), 132 | +0.11 (0.07), 374 | 3.9% |
| earnings, passes C29, A13 and B26 at the close | 2005 | 40% | 50% | +0.6% | +0.29 (0.09) | 32% | 28% | +0.00 (0.07), 637 | +0.04 (0.06), 384 | +0.09 (0.03), 1142 | 1.5% |
| earnings, not a market-wide day (under 10 events that date) | 5611 | 54% | 41% | +0.6% | +0.19 (0.06) | 36% | 22% | -0.07 (0.04), 2515 | +0.06 (0.04), 1417 | +0.07 (0.02), 3604 | 3.0% |
| earnings, 2000 to 2012 | 1544 | 54% | 42% | +0.0% | +0.07 (0.07) | 35% | 20% | -0.12 (0.07), 733 | -0.02 (0.06), 430 | -0.03 (0.03), 1026 | 3.1% |
| earnings, 2013 to 2019 | 1983 | 58% | 34% | +1.6% | +0.28 (0.06) | 39% | 23% | -0.04 (0.06), 911 | +0.14 (0.06), 523 | +0.15 (0.03), 1263 | 2.8% |
| earnings, 2020 to 2026 | 3328 | 53% | 44% | +1.1% | +0.27 (0.09) | 36% | 23% | +0.06 (0.05), 1429 | +0.03 (0.05), 773 | +0.10 (0.03), 2115 | 3.5% |
| no earnings, 2000 to 2012 | 999 | 39% | 58% | -1.5% | -0.11 (0.17) | 29% | 22% | -0.24 (0.09), 378 | +0.01 (0.10), 216 | -0.04 (0.05), 641 | 2.6% |
| no earnings, 2013 to 2019 | 825 | 45% | 50% | +0.1% | +0.27 (0.14) | 31% | 23% | -0.07 (0.11), 322 | -0.04 (0.10), 204 | -0.03 (0.05), 521 | 2.4% |
| no earnings, 2020 to 2026 | 2061 | 39% | 59% | +0.8% | -0.03 (0.07) | 27% | 20% | +0.28 (0.08), 690 | +0.12 (0.09), 370 | +0.11 (0.04), 1369 | 3.9% |

**What the numbers say.**
1. **Earnings gaps hold; other gaps mostly do not.** Earnings gaps kept the gap-day low for 10 sessions 55% of the time
   and traded back to the prior close within 20 sessions 41% of the time. Gaps with no earnings nearby: 40% and 57%.
2. **Day one beat the baseline on earnings gaps only.** Buy A on earnings gaps: +0.23R (0.05), against +0.04R (0.03) for
   random days in the writer's baseline and +0.09R (0.03) in the cold-check re-run; the gap over random days is about
   two to three standard errors, not more. On no-earnings gaps: +0.01R (0.06), no better than random. Below the 200-day,
   no-earnings gaps did worst (34% held, 69% traded back to the prior close).
3. **The first pullback and reclaim did not beat day one.** Buy B, the course draft's version, came out near zero on
   earnings gaps (-0.01R) and found a setup on only 45% of them (a median of 6 sessions after the gap). Buy D, the glyph
   read literally, found one on 25% of earnings gaps, with a median stop of 6.2%, and came out at +0.05R (0.03).
   Bulkowski's confirmation (Buy C) was +0.08R (0.02) with a median stop of 8.2%. One slice looked good (Buy B on
   no-earnings gaps since 2020, +0.28R, 0.08), but the other periods did not, so I read it as noise until it repeats.
4. **The house rules bite hardest on day one.** On earnings gaps, at the day-one close: 32.5% were more than 10% above
   their 10-day average (C29 says skip); 52.5% needed a stop more than 3% away to sit under the day's low (A13 says
   stops usually within about 3%); 27.0% closed under the 200-day (B26 forbids). 70.8% failed at least one of the three.
   For earnings gaps of 10% or more: 66.3%, 60.9%, 27.5%, and 86.9% failing at least one.
5. **The ones the rules would block were not worse.** Earnings gaps that C29 blocks: +0.18R (0.04); that it allows:
   +0.25R (0.07). Earnings gaps closing under the 200-day: +0.28R (0.14) against +0.21R (0.04) above it. The rules
   change which trades you take more than how good they are.
6. **A strong close holds better but pays less per R.** Earnings gaps closing in the upper half of the day held 68% of
   the time (lower half: 40%), but the stop from a strong close is wider (median 5.0% against 1.6%), so the R result
   is lower. Measured in percent (the 20-session change) the two are similar.
7. **The average drift after day one is small.** From the day-one close, earnings gaps averaged +1.0% over 20 sessions;
   random days in the same stocks averaged +0.8%. Most of the move is in the gap itself; the trade lives on the stop
   and the few big winners (22% reached 3R).
8. **About a quarter of big gaps are not earnings.** Of gaps of 8% or more on 3 times volume, 69.1% were earnings,
   26.3% had no earnings within 5 sessions (2,919 events). The biggest of those include VKTX 2024-02-27, BE
   2024-11-15 and MRNA 2026-08-19. I did not look up each one's news, so calling them "news gaps" is an assumption.

**Limits.** The stock list is today's (survivors), which flatters all long results, the baseline included. Yahoo's dates
can be wrong or missing: 6.2% of the no-earnings events sit in a hole of more than 120 days in a stock's date list, so
some are missed reports. "No earnings" is not the same as "news": it mixes company news, sector sympathy, squeezes and
market-wide days. Buy A uses the close, not the opening range. Daily bars cannot see the intraday path, so same-day stop
and target order is guessed (stop first). No costs. Events overlap in time, so the standard errors are too small. The
result changes by period (earnings Buy A was +0.07R in 2000 to 2012). None of this is a promise about the next trade.
**Reproduction (cold check 2, 2026-11-09 evening).** `measure.py`, `baseline.py` and `analyze.py` were re-run from
scratch against the same read-only database after it had taken new bars: 11,475 gap events (6,859 earnings, 3,892 no
earnings; the table above has 11,461 / 6,855 / 3,885 from the writer's run). Every figure in the table and in points 1
to 8 reproduced within rounding (for example earnings Buy A +0.234R, se 0.049; Buy B -0.008R on 3,073; Buy D +0.052R on
1,726, median stop 6.17%; 69.1% / 26.3% of the 2,920 big gaps; 70.8% failing one of C29, A13, B26). Only the random-day
baseline moved, from +0.04R to +0.09R, because it is a different random sample; it is reported both ways above.

---

## 5. Our app

### 5.1 There is no News/Earnings Gapper scanner

No detector in `api/services/pattern_engine/detectors/` is named for this setup. The card, the tag and the aliases are
listed in section 2 and 3.2. `api/services/desk_session_insights.py` lists "News/Earnings Gapper" in its fixed setup
names. `api/services/pattern_vision/eval.py` maps the journal tag "News Gappers" to the `power_earnings_gap` detector.

### 5.2 The nearest pattern-engine detectors (summarised from the code)

- **`power_earnings_gap.py`** (Power Earnings Gap). In the last 30 bars, a gap bar that opens 8% or more (under 100%)
  above the prior close on volume 3 times or more the prior 20-bar average (if several qualify, the one with the highest
  confidence score, though the docstring says "largest gap_pct"); then 3 to 10 bars after it whose lows all stay
  above 99% of the gap-day open; the last 3 bars' average range under 70% of the gap bar's range; and the post-gap high
  not yet broken. Entry: just over the post-gap high, with a close on 1.5 times volume. Stop: 1.5% under the gap-day
  low. Target: the gap height added to the gap-day close. Its own docstring says it cannot check that the gap was
  earnings ("UNVERIFIED" unless a caller supplies `days_to_earnings`).
- **`episodic_pivot.py`** (Episodic Pivot). In the last 5 bars, a bar that opens 4% or more above the prior close, has
  2 times the 20-bar range and 2 times the 20-bar volume, closes in the top 30% of its range and above a 15 to 60-bar
  base no more than 25% deep. Entry: just over the EP bar's high. Stop: 1.5% under its low.
- **`uct_ep_v2.py`** (admin-only lab port). The same gap, volume and range tests, close strength 0.50, the base only a
  label. Entry: the latest close. Stop: the gap-day low. Targets at 2R and 3R.
- **`uct_go_signal.py`** counts "a 4% gap on 2x volume within the last 30" as one way a stock "has already shown it can
  move", then looks for a weak open that sweeps support and closes strong.
- **`uct_slingshot.py`** needs a prior strength day ("a > 4% up close on volume above its 50-day average" within 25
  sessions); the owner said the Slingshot is "Meant to be used to enter PEGS mostly but not" (verdict line 161), then
  on the same chart "Not exclusively to PEGs but still good, I don’t want to keep this" (line 162).
- **`uct_gap_support.py`** buys a later test of the gap-up low (see `docs/study/TRADE_PLANS.md`).
- All of these except `episodic_pivot.py` use the shared `liquidity_floor`, whose defaults are a $2 price and $10,000
  of average daily dollar volume (`api/services/pattern_engine/primitives/liquidity.py`), far under B23.
  `episodic_pivot.py` has no price or liquidity floor in its own code.

### 5.3 The Chart IQ engine (vendored from the UCT lab, `api/services/chart_iq/engine/`)

- **"Earnings gapper flagging"** (`forward.py`): a gap of 5% or more over the prior close on 2.5 times the 50-day volume,
  4 to 25 sessions ago; every close since at or above the gap-day low; today's close no more than 1.2 ATR above the
  20-day EMA; the last 3 days' average volume at or under the 50-day average. Buy: a break of today's high. Stop: the
  gap-day low. It does not check that the gap was earnings.
- **"ER gap"** (`v4_compose.py`): any gap of 8% or more on 3 times volume, labelled "(likely earnings)". An "Episodic
  pivot" label is kept only when `ep_ok` finds the stock out of neglect (within 30% of its 60-day low, a 60-day range of
  35% or less, a 10% gap on 3 times volume, and more); otherwise it becomes "ER gap", with the reason "big-volume gap,
  not out of neglect (likely earnings)".
- **"PEG flag"** (`v3_bases.py`): a base of up to 30 bars and 30% depth that starts within 15 bars after an 8%, 3 times
  volume gap (or a 3% gap whose day closes 10% or more up, on 3 times volume), with the format text
  `flag on top of the %s earnings/news gap`.
- **"Buyable gap-up"** (`v2_setups.py`): a 4% gap on 1.5 times volume, closing in the upper half, above the 50-day, with
  the stop drawn at the "Gap midpoint (BGU stop)", halfway between the gap day's low and the prior day's high.
- **"ER breakdown"** (`v44_read.py`): a gap down of 8% or more on 3 times volume reads "no swing trade area".

### 5.4 The screener and the catalyst engine

- **`buyable_gap_up_state`** (`api/services/screener/base_catalog.py`): a true gap (the low above the prior high) of at
  least 0.75 times the 40-day ATR measured the day before, within the last 10 bars, still open (last close above the
  prior close), in a stock that doubled within 250 bars. The volume rule is deliberately not applied.
- **Starter screens** (`api/services/screener/saved_screens.py`): "Gapping up on volume" (2%, 1.5 times volume, $10
  million a day, $5 price), "Gap Movers" (8%, 3 times volume, $300 million market cap), "Up in extended hours" (3%, $10
  million a day, $5 price). The `starterScans.json` note refuses to call any of them "News Gappers": "a member scanning
  News Gappers would get index rebalances and sympathy moves under a name that promised a catalyst."
- **Catalyst engine** (`api/services/catalyst/brain_grades.py`): a gap of 3% or more with earnings just reported is
  graded as a Power Earnings Gap; a gap with news and no earnings is graded as an Episodic Pivot. The EP label is refused
  on an earnings gapper (TERM-090; `app/src/components/tiles/EpBaseRate.jsx`), and the EP flag shows its base rate
  (section 4.2).

### 5.5 Where the app disagrees with the sources or looks wrong

1. **No definition in code.** The setup has a card, a tag and a lesson title, but no detector, no playbook and no trade
   plan row. The pattern-vision evaluation maps the "News Gappers" label to the PEG detector (`pattern_vision/eval.py`),
   while the catalyst engine calls the same non-earnings gap an EP and the Model Book keeps it as its own card. Three
   surfaces, three readings.
2. **The detectors' Bonde claims are not what Bonde wrote.** `episodic_pivot.py` says "both Bonde and Kullamägi's
   published versions of this setup require a genuine opening gap". Bonde's published scans measure the close (C/C1,
   c/c1), and his 2007 stop rule covers the case where it is not a gap ("1 dollar below the gap low if it is gap up or at
   2 days low"); his own trades usually are gaps (his 2014 routine starts from after-hours and pre-market movers), but
   what he published does not require one. `power_earnings_gap.py` says the PEG was "codified by Pradeep Bonde"; I found
   no Bonde post that uses the name, and a search of his blog for "power earnings gap" (2026-11-09) returned three posts,
   none containing the phrase. The detectors also credit Bonde with chase limits ("never chase more than 3-5% above the
   pivot"; "Avoid chasing more than 5% above the EP bar high") and with the phrases "filling the gap" (PEG detector) and
   "filling the EP bar" (EP detector), each "in Bonde's terminology"; I found none of these in the Bonde posts listed in
   3.3. The PEG detector's constant comment also puts a paraphrase in quotation marks (Bonde: "5+ points OR 8%+ gain");
   the 2010 post gives a scan formula, not those words. They may exist elsewhere; until found they should not be taught
   as his.
3. **"Likely earnings" is wrong about a quarter of the time.** In section 4.3, 26.3% of gaps of 8% or more on 3 times
   volume had no earnings date within 5 sessions. Chart IQ's "ER gap" and "Earnings gapper flagging" do not check.
4. **The Chart IQ BGU stop is not the authors' stop.** Morales and Kacher's book rule is the gap day's intraday low; the
   gap midpoint traces only to the house brain template (3.10); I found no outside source for it.
5. **Floors under the house rule.** The detectors' $2 and $10,000 floors and the screens' $5 and $10 million floors are
   below B23's $10 and $20 million.
6. **The course draft says "never the open, always the reclaim".** The owner says "I love trading earnings gappers on day
   one." Our test also found day one better than the reclaim on earnings gaps (section 4.3). The draft needs his ruling.
7. **The glyph draws no gap.** The card's gap-day candle is `[9, 2, 0.6]` with no fourth value, so the mini-chart shows
   a 9% day that opens at the prior close. The Power Earnings Gap card (`[11, 1, 0.4]`) and the Kicker card do the
   same. In the Gaps & Catalysts family only the Episodic Pivot's gap day (4%) and the High Volume Edge's trigger day
   (0.8%) are drawn with a gap.
8. **The PEG detector's hold rule** (lows above 99% of the gap-day open for 3 to 10 bars) is stricter than the owner's
   rule, which lets a pullback reach the gap-day low (below the open) as long as it holds. His Gap Support ruling (line
   185): "I want the gap up low to hold or be slightly breached instead of the gap fill spot btw".

---

## 6. UCT's own words

All Substack posts below are public. I searched all 103 posts in the sitemap on 2026-11-09 for "gapper", "PEG",
"earnings gap", "news", "day 1", "delayed reaction" and related words. Sunday Scans carry the byline "Uncharted
Territory"; "TSDR's Weekly Outlook & Watchlist" and the "Charts Covered" list under it are the owner's section (some
weeks it is headed "Patrick (TSDR)’s Weekly Outlook & Watchlist"). The house treats the first-person openings as the
owner's too (`docs/study/sizing_rule.md` section 1 quotes the opening of the 2026-06-14 Sunday Scans as his). The earnings
calendar, Index and ETF, and closing-comments sections carry no name; rows from them are marked "no byline" below. Their
first-person voice reads like the owner's, but that is a reading, not a byline. "The Rest of the Week" posts are signed
by section.

### 6.1 The owner's verdicts and rulings (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`)

| line | chart | his words | what it settles |
|---|---|---|---|
| 3 | GRMN 2024-05-01 (Kicker pass) | "Yeah no this is not one, this is plainly just an earnings gapper" | a 6% earnings gap that runs is an earnings gapper |
| 4 | TSN 2022-02-07 | "Sometimes earnings gappers can be kickers but mostly they are just earnings gappers." | an earnings-day gap is an earnings gapper by default |
| 5 | eight Kicker charts | "I want them to be rarely earnings though because those are mostly just earnings gappers and not kicker candles in this context of where and when you would want to apply the candle setup and usefulness" | Kickers are positioning; earnings gaps belong here |
| 2 | VTRS 2024-11-07 | "these are pretty random stocks and I would classify them more as earnings moves vs kicker candles however sometimes they are indistinguishable" | random names are weak examples |
| 13 | ELVN 2026-06-12 (Oops pass) | "this is more of a delayed reaction setup vs an oops imo" | the day after a big news gap is its own setup |
| 19 | FIP 2026-03-02 (Oops pass) | "looks more news driven than technical, but I see it" | news bars read differently from technical bars |
| 128 | ASML 2024-01-24 (HVE pass) | "Again, just a PEG" | an earnings volume spike on an established name is a PEG |
| 152 | FSLY 2026-02-12 (HVE pass) | "This. This is 100% A+" | the gap day of a long-neglected name with record volume |
| 161 | COIN 2023-11-15 (Slingshot) | "Meant to be used to enter PEGS mostly but not" | the Slingshot is a later entry into these gaps |
| 162 | COIN 2023-11-15 (Slingshot, same chart) | "Not exclusively to PEGs but still good, I don’t want to keep this" | mostly, not only, a PEG entry |
| 192 | META 2023-02-24 (Gap Support) | "Such a great setup on this PEG there" | the later test of an earnings gap |
| 196 | NVDA 2023-03-02 (Gap Support) | "Keep — great" | the late-February 2023 earnings gap holding its gap-up low |
| 205 | MSFT 2025-08-04 (Gap Support) | "A lot of the are more PEGs but also gap support" | the families overlap |
| 206 | NVDA 2023-06-01 (Gap Support) | "Never really tested gap support" | the late-May 2023 earnings gap was cut as a Gap Support example |
| 207 | AAPL 2024-05-07 (Gap Support) | "Just a PEG" | the gap bar itself is the PEG, not Gap Support |
| 225, 227 | UBER 2022-10-11 and the definition ruling (Gap Support) | "Prefer holding open gap vs filling gap btw" | an open gap ranks above a filled one |
| 289 | PRIM 2026-05-06 (Bear gap) | "This is more of just an earnings breakdown" | the short-side mirror has its own name |

### 6.2 The owner in the Sunday Scans and The Rest of the Week

| date | where | words | link |
|---|---|---|---|
| 2025-06-20 | watchlist, GRRR | "Gapping up 15% in after hours following their earnings report." / "Can enter there and place a stop at LOD and see how far it goes." | [market-update-and-watchlist](https://unchartedterritoryy.substack.com/p/market-update-and-watchlist) |
| 2025-06-22 | his section | "I always use the first 30 min to let play out and establish the range." (on positions gapping down through a stop) | [sunday-scans-0d2](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2) |
| 2025-07-13 | calendar (no byline) | "Remember to check non-headline stocks that report as well, can find good Episodic Pivot gappers during ER season." | [sunday-scans-6a6](https://unchartedterritoryy.substack.com/p/sunday-scans-6a6) |
| 2025-07-20 | closing comments (no byline) | "Important to pay attention to news and earnings gappers. These are frequently the best trades to be in." | [sunday-scans-c82](https://unchartedterritoryy.substack.com/p/sunday-scans-c82) |
| 2025-07-27 | his section | "Will be very focused on earnings gappers looking for notable day 1 moves." | [sunday-scans-63b](https://unchartedterritoryy.substack.com/p/sunday-scans-63b) |
| 2025-08-03 | his section | "This is common for strong earnings gappers and deserves attention." / "Very often these ER gappers are the best performers for the quarter to come." | [sunday-scans-726](https://unchartedterritoryy.substack.com/p/sunday-scans-726) |
| 2025-08-03 | Charts, RMBS | "Earnings gapper on Tuesday. Would prefer higher volume on Day 1 move." | same |
| 2025-08-10 | his section | "I personally prefer letting the earnings gappers build out for a few days or weeks, so it may take time to get full margin again." / "I don't mind buying day 1 and should quite frankly be more comfortable doing it." | [sunday-scans-f6f](https://unchartedterritoryy.substack.com/p/sunday-scans-f6f) |
| 2025-08-10 | his section | "This has been a wild ER season so far with a number of 20% gappers in both directions. I choose to focus on strength. Stocks love to double." | same |
| 2025-08-24 | Charts, NBIS | "Wednesday it undercut the ER gap up low and quickly got bought up then rest on Thursday followed by a bullish engulfing on Friday." | [sunday-scans-ffa](https://unchartedterritoryy.substack.com/p/sunday-scans-ffa) |
| 2025-09-21 | Charts, INTC | "Massive gap up on news of NVDA taking a 5% stake in the company. Looking for delated [sic] news reaction. Can treat this also like a classic PEG (Power Earnings Gap)." | [sunday-scans-88a](https://unchartedterritoryy.substack.com/p/sunday-scans-88a) |
| 2025-09-28 | Charts, SNOW | "I don’t like that it is all consolidating at the bottom 50% of the big earnings candle." | [sunday-scans-9a2](https://unchartedterritoryy.substack.com/p/sunday-scans-9a2) |
| 2025-11-02 | Charts, TSLA | "We want to see bull gaps stay open because it shows who is in control of the strength. Gaps act as support and resistance not as open price spots that need to be retraced." | [sunday-scans-b99](https://unchartedterritoryy.substack.com/p/sunday-scans-b99) |
| 2025-11-02 | Charts, RDDT | "I am interested in keeping this on the list for a delayed reaction to earnings." | same |
| 2025-11-02 | his section | "The only times these will be adjusted are on a gap down and will be replaced at the 15/30 min low and when moving my stop to breakeven" | same |
| 2025-11-05 | RotW, APPS (signed TSDR Trading) | "This is gapping up on earnings after a beat on EPS, Revenue, and raising guidance. I will be looking for an Opening Range Break or a “VWAP undercut and rally”." | [the-rest-of-the-week-9c9](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9) |
| 2025-11-09 | opening | "I love trading earnings gappers on day one." / "It is well within my strategy to look for these and position into a few of them each quarter." | [sunday-scans-720](https://unchartedterritoryy.substack.com/p/sunday-scans-720) |
| 2025-11-09 | his section | "A classic PEG that I should and will take 10/10 times on a “Buy Day” like Friday." / "I have a baby position in CRS from the PEG (Post Earnings Gap) setup." | same |
| 2025-11-09 | Charts, U | "This is shaping up to give us one of my favorite post earnings setups. The delayed reaction has provided many great opportunities this year including GEV 4/24, HIMS 5/1, TEM 8/12, QS 9/11, and INTC 9/23." | same |
| 2025-11-16 | Charts, GH | "Earnings gapper consolidating below $100 and above the gap up low." | [sunday-scans-d6a](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a) |
| 2025-11-16 | Charts, DDOG | "Simple post earnings look holding $180 and gap up low support, consolidating below $200." | same |
| 2025-11-23 | calendar (no byline) | "Although it hasn’t yet led to a ton of setups, often coming out of corrections it is the recent ER gappers that have stellar performance on the other side." | [sunday-scans-56d](https://unchartedterritoryy.substack.com/p/sunday-scans-56d) |
| 2025-11-23 | Charts, DOCN | "We know that recent ER gappers are some of the best opportunities when the market comes out of a correction" | [sunday-scans-56d](https://unchartedterritoryy.substack.com/p/sunday-scans-56d) |
| 2026-01-25 | calendar (no byline) | "It is without question that new high quality winners will establish themselves and start as earnings gappers." | [sunday-scans-7fb](https://unchartedterritoryy.substack.com/p/sunday-scans-7fb) |
| 2026-01-27 | RotW (signed TSDR TRADING) | "They were all three textbook morning headlines and significant follow through during the entire day." / "Most people will wait for a flag or consolidation. If you get day 1 you have a massive cost advantage for sizing big and holding longer." | [the-rest-of-the-week-aaa](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-aaa) |
| 2026-02-04 | RotW (TSDR) | "Earnings season will prove to offer opportunities and moves that are immune to whatever the mkt is doing at the time." | [the-rest-of-the-week-732](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-732) |
| 2026-02-08 | Charts, TXN | "ER gapper to new ATHs with 70% YoY Datacenter growth for the calculator maker. Flagging out and holdings it’s ER close and ATH." | [sunday-scans-29e](https://unchartedterritoryy.substack.com/p/sunday-scans-29e) |
| 2026-02-16 | his section | "On the same note some have failed to follow through on day 1 or days following." | [sunday-scans-ccf](https://unchartedterritoryy.substack.com/p/sunday-scans-ccf) |
| 2026-02-16 | calendar, FSLY (no byline) | "Yet the stock put in a perfect gap up on earnings and closed the week up 113%. This was an old pre Covid IPO that went on an 800% move in 2020. Since has been beaten to hell." | same |
| 2026-03-01 | Charts, CRCL | "I really wish I would have bought on day 1 of earnings. I was considering it and using the 50SMA as a stop." | [sunday-scans-6a8](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8) |
| 2026-03-01 | Charts, FSLY | "If looking to trade stocks post earnings and you did not hit this either Tuesday or Friday I sincerely and respectfully ask WHY?" | same |
| 2026-03-08 | his section | "And Earnings and Catalyst gappers have been clean and respectful and will always have a place on my focus list." | [sunday-scans-dcf](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf) |
| 2026-03-08 | Charts, FIGS | "Market corrections and earnings gappers during have a high tendency to go on to be big winners when the market finds it’s footings." | same |
| 2026-03-22 | Charts, FSLY | "A strong name then as an earnings gapper pulled into the HVC and the MAs. Bought with tight risk and let the trade play out." | [sunday-scans-cab](https://unchartedterritoryy.substack.com/p/sunday-scans-cab) |
| 2026-03-22 | Charts, RNG | "$39.50 is the HVC from earnings that we want to see taken out for signs of strength." | same |
| 2026-05-03 | Charts, TWLO | "Massive ER Gapper. Took a loss on Friday, will look to buy gap support or a flag buildout." | [sunday-scans-bcc](https://unchartedterritoryy.substack.com/p/sunday-scans-bcc) |
| 2026-05-17 | Charts, MXL | "This MXL from the day three undercut of earnings day low at $50 has gone on to double and is now flagging" | [sunday-scans-679](https://unchartedterritoryy.substack.com/p/sunday-scans-679) |
| 2026-05-24 | Charts, TWLO | "Classic PEG set up. Makes a 4 to 5 day move following a notable earnings gap up. Pulls back, consolidates, holds the moving averages and actually it held the earnings day close perfectly." | [sunday-scans-ffb](https://unchartedterritoryy.substack.com/p/sunday-scans-ffb) |
| 2026-05-24 | Charts, AAON | "I think Friday was actionable with the risk to low of day and I think you can still take that trade." | same |
| 2026-05-24 | Index and ETF section, IGV (no byline) | "Cannot justify stocks below 200SMA with so many other things acting properly right now at highs." | same |
| 2026-05-31 | Charts, INOD | "Great example of an earnings gapper needing a little wiggle to offer optimal risk to reward later on." | [sunday-scans-6d8](https://unchartedterritoryy.substack.com/p/sunday-scans-6d8) |
| 2026-06-28 | Charts, BFLY | "EP on earnings followed by a mini shakeout and classic 3 day delayed reaction." | [sunday-scans-ae1](https://unchartedterritoryy.substack.com/p/sunday-scans-ae1) |
| 2026-06-28 | Charts, TWLO | "Holding ER close, gap support, 50SMA, inside day just below the 20EMA and AVWAP from earnings." | same |
| 2026-07-12 | his section | "Make sure to track ER GAPPERS for the quarter and make your PEG list!" | [sunday-scans-898](https://unchartedterritoryy.substack.com/p/sunday-scans-898) |
| 2026-08-16 | Charts, FSLY | "Very bullish on the potential then got hit on that 40% gap down in May and took a 120% gainer down to only 30% win." | [sunday-scans-da5](https://unchartedterritoryy.substack.com/p/sunday-scans-da5) |
| 2026-08-30 | Charts, ESTC | "Faded off day 1 into $100 psyche level. Could be due to mkt weakness on JHole day. In play for delayed reaction." | [sunday-scans-d40](https://unchartedterritoryy.substack.com/p/sunday-scans-d40) |
| 2026-09-06 | Charts, OKTA | "Sold breakeven this week after buying on Day 1. Should have kept ER day low as a stop that was a mistake I think." | [sunday-scans-fcd](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd) |
| 2026-10-11 | Charts, TEAM | "Earnings gapper, rallies to $200 and then bases. Pulls into and undercuts this range slightly closing with a strong lower wick. Remounts MAs and breaks highs." | [sunday-scans-31b](https://unchartedterritoryy.substack.com/p/sunday-scans-31b) |
| 2026-10-11 | Charts, OKTA | "Classic and repeatable. ER gapper to highs, first of it’s group already showing major strength." | same |
| 2026-10-11 | Charts, PENG | "HVE, ER Gapper and RS. That’s trader speak for Highest Volume Ever, Earnings Gapper, Relative Strength." | same |
| 2026-11-08 | Charts, CROX | "Earnings gappers continue to be the main thing that stands out for now. Remember, the main winners from April were also big ER gappers." | [sunday-scans-70f](https://unchartedterritoryy.substack.com/p/sunday-scans-70f) |

### 6.3 The team ("The Rest of the Week", signed by section)

| date | signer | words | link |
|---|---|---|---|
| 2025-11-12 | Alex Jones Industrial Average (CAT) | "Really clean PEG (Post Earnings Gap) sequence happening in this name. Bull flagging right into the 9EMA." | [the-rest-of-the-week-045](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-045) |
| 2025-11-19 | Manrav (TDC) | "Massive base and got a power earnings gap with a strong close and now flagging on daily." | [the-rest-of-the-week-72c](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-72c) |
| 2025-11-19 | Camden (FROG) | "This is exactly what you want to see after a strong earnings gap: expansion, digestion, and a controlled retest of the breakout spot." | same |
| 2026-01-07 | The Wiz (IREN, CIFR, WULF) | "Gap up, followed by an UnR of that gap candle low and closing back inside the bar with a hammer." / "Stop being the low of the day." | [the-rest-of-the-week-3f0](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-3f0) |
| 2026-02-25 | JERSACE (VRT) | "This structure is bullish and can looked at as a PEG setup." (a rally, not a gap: a loose use of the name) | [the-rest-of-the-week-b24](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b24) |

### 6.4 Bracco

- 2025-07-06: news gappers as small "base hits" while getting back in sync: "Whether it be a intraday momentum scalp,
  morning PR, news gapper, etc." ([sunday-scans-df6](https://unchartedterritoryy.substack.com/p/sunday-scans-df6))
- 2026-04-26, SOXL: the "underexposed" quote in section 1 ([sunday-scans-f2d](https://unchartedterritoryy.substack.com/p/sunday-scans-f2d)).
- 2026-05-24, INTC: "Held the earnings gap AVWAP and 20ema on recent pullback." ([sunday-scans-ffb](https://unchartedterritoryy.substack.com/p/sunday-scans-ffb))
- 2026-05-31, drones: "Considered these a potential thematic episodic pivot." ([sunday-scans-6d8](https://unchartedterritoryy.substack.com/p/sunday-scans-6d8))
- "The Parabolic Short" (2025-06-13), the gap to avoid buying: "A gap-up on the climax day. You never know exactly when
  the climax day will hit, but I won’t short without that gap-up." (In the post the first sentence is the bold lead-in of a list item.)
  His burst is a 3 to 5 day run, and "The climax gap up typically takes place on day 3 to 5 of the move." A gap there
  is a condition for his short (the entry itself is intraday), not a long.
  ([the-parabolic-short](https://unchartedterritoryy.substack.com/p/the-parabolic-short))

### 6.5 UCT traders in the brain (repo KB extracts, mostly summaries)

From `docs/study/levels/brain_kb_2026-11-06.json` and `brain_kb_rules_2026-11-06.json`. Most rows are the KB's
summaries, not the traders' words; only quoted text marked "In TSDR's words" is his.
- TSDR (KB 12645, 2026-06-01), his words: "It has been so common to see shakes into the gap and hold on day 1 or day 2
  lately for these moves. Keep that in mind. They often offer tighter risk"
- TSDR (KB 12545, 2026-04-29, summary): on an EP chart (MXL), the entries were a day-1 EP (stopped the next day), a day-2
  Oops Reversal, and a day-4 wick play.
- Manrav (KB 11027, 2024-07-27, summary): on news and earnings gappers, "day 1 is ideal but chasing a 20%+ gapper is
  hard"; he uses the high-volume close as the pivot.
- Bracco (KB 11114, 2024-10-12, summary): "play the reaction after earnings, not before; betting into earnings is a
  gamble"; AVWAPs anchored to the earnings-day open and close as entries.
- TSDR desk log (KB 10088, 2025-05-12): "OSCR --have long term position, but A+ PEG here 17 strong support looking to
  breakout on hourly rn"

### 6.6 What UCT's usage adds up to

1. The owner trades two moments of one event: the gap day itself (ORB, stop at the day's low) and the build-out after it
   (a pullback that holds the gap-up low, the earnings-day close, the HVC, the AVWAP or the 9 and 20-day EMAs, then a
   higher low, a red to green, an Oops, a 30-minute pivot or a Slingshot).
2. "Earnings gapper" is his everyday word for the event; "PEG" for the event and its build-out; "news" and "PR" gappers
   for non-earnings catalysts; "delayed reaction" for a gap that moves days later.
3. He values volume, a strong close, an open gap, a leader or a neglected story with growth, and tracking a quarterly
   list. He watches the 200-day.
4. He reports failures honestly: day-one buys that did not work (OKTA sold at breakeven, TWLO a loss on the gap day),
   names that "failed to follow through on day 1",
   and a 40% gap down that cut a winner (FSLY).

### 6.7 Candidate model examples (bar facts from our local data, not rulings)

The gaps the owner named, measured on the local daily bars. "Buy A" is the day-one-close proxy of section 4.3 (his real
entries were intraday). Prices are as the local data store them (split-adjusted).

| stock | gap day | earnings date listed | gap | volume vs 50-day | day change | close in range (0 low, 1 high) | prior close vs 200-day | close vs 10-day | stop: close to under the low | Buy A result (R, exit) | 20 sessions later | who named it |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| TSN | 2022-02-07 | not in cache | 10.3% | 4.9x | +12.2% | 0.89 | +10% | +8.5% | 3.7% | -1.00 (stop) | -7% | verdict: good chart, an earnings gapper |
| GRMN | 2024-05-01 | 2024-05-01 | 6.1% | 2.6x | +13.1% | 0.90 | +19% | +13.0% | 7.7% | +0.57 (time) | -0% | verdict: plainly an earnings gapper |
| SANM | 2025-11-04 | 2025-11-03 | 6.9% | 2.8x | +16.6% | 0.81 | +44% | +18.7% | 11.0% | -0.39 (time) | -4% | SS 2025-11-09 day one +17% |
| XMTR | 2025-11-04 | not in cache | 14.2% | 4.6x | +28.9% | 0.99 | +33% | +23.4% | 18.7% | -0.36 (time) | -10% | SS 2025-11-09 day one +29% |
| HTZ | 2025-11-04 | not in cache | 16.2% | 14.8x | +36.2% | 0.73 | -13% | +27.8% | 16.9% | -1.00 (gap_stop) | -22% | SS 2025-11-09 day one +36% |
| FSLY | 2026-02-12 | 2026-02-11 | 44.9% | 27.4x | +72.3% | 0.59 | +11% | +68.4% | 16.7% | +3.86 (trail) | +53% | SS 2026-02-16 perfect gap up, +113% week |
| CRCL | 2026-02-25 | not in cache | 20.2% | 6.1x | +35.5% | 0.98 | n/a | +32.0% | 14.5% | +1.00 (stop) | +25% | SS 2026-03-01 wished he bought day 1 |
| DELL | 2026-02-27 | 2026-02-26 | 13.1% | 4.8x | +21.9% | 0.94 | -6% | +21.0% | 8.2% | +0.29 (time) | +16% | SS 2026-03-01 up 22%, top of PEG list |
| OKTA | 2026-08-27 | 2026-08-26 | 23.6% | 5.3x | +28.6% | 0.89 | +36% | +22.3% | 9.6% | -0.39 (time) | +13% | SS 2026-09-06 bought day 1, ER-day low stop |
| TWLO | 2025-10-31 | 2025-10-30 | 12.4% | 4.0x | +19.5% | 0.77 | +1% | +18.3% | 8.2% | -1.00 (stop) | -5% | SS 2025-11-09 gapped up 20% on earnings |
| TWLO | 2026-05-01 | none listed | 20.1% | 3.5x | +23.8% | 0.94 | +22% | +23.6% | 6.8% | +1.00 (stop) | +24% | SS 2026-05-03 massive ER gapper |
| MXL | 2026-04-24 | 2026-04-23 | 57.7% | 18.3x | +76.1% | 0.67 | +98% | +95.6% | 11.1% | -1.00 (stop) | +64% | SS 2026-05-24 EP gapped to $50 |
| TXN | 2026-01-28 | 2026-01-27 | 3.7% | 2.8x | +9.9% | 0.97 | +8% | +10.5% | 5.9% | +0.82 (time) | -2% | SS 2026-02-08 ER gapper to ATHs |
| AAON | 2026-05-07 | not in cache | 45.5% | 8.6x | +31.5% | 0.17 | +10% | +33.8% | 3.2% | +1.00 (stop) | +3% | SS 2026-05-24 gap up low $127 |
| RMBS | 2025-07-29 | 2025-07-28 | 5.9% | 3.8x | +13.9% | 0.98 | +15% | +9.3% | 10.8% | +0.42 (time) | +3% | SS 2025-08-03 earnings gapper |
| NVDA | 2023-05-25 | 2023-05-24 | 26.1% | 3.6x | +24.4% | 0.47 | +57% | +22.5% | 3.6% | +0.57 (time) | +7% | Gap Support pass: cut, "Never really tested gap support" (line 206); the owner's "great" NVDA (line 196) is the late-February 2023 gap, not this one |
| META | 2023-02-02 | 2023-02-01 | 19.8% | 5.1x | +23.3% | 0.51 | +1% | +25.5% | 4.7% | -1.00 (stop) | -2% | Gap Support PEG, great |
| APPS | 2025-11-05 | not in cache | 34.8% | 10.9x | +23.1% | 0.24 | +30% | +13.4% | 4.3% | -1.00 (stop) | -30% | RotW 2025-11-05 gapping on earnings, ORB |

Exits: `stop` is the initial stop or breakeven after the 3R trim (a +1.00 is a 3R trim then breakeven); `time` is the
C33 rule (under 1R after 10 sessions); `trail` is the close under the 10-day; `gap_stop` is an open under the stop.
What the table shows: 16 of his 18 named gaps closed more than 10% above their 10-day average (C29), and the stop from
the close to under the day's low was more than 3% on all 18 (A13). FSLY's prior close was $9.31, under B23's $10, and
it opened at $13.49. Two more fail B23 at every price on our bars: HTZ (prior close $4.94, open $5.74, close $6.73) and
APPS (prior close $5.92, open $7.98, close $7.29, and about $16.7 million a day over the prior 50 sessions, under the $20
million floor). HTZ and DELL were under their 200-day before the gap and closed above it. The three "day one"
names of 2025-11-09 (SANM, XMTR, HTZ) all lost from the day-one close over the next 20 sessions; his note praised their
first day, not the weeks after.

---

## 7. How it fits the owner's account rulebook (`docs/study/sizing_rule.md` section 9)

| rule | what it says | fit with the News/Earnings Gapper |
|---|---|---|
| B26 (hard) | no longs below the 200-day SMA | Excludes 27% of earnings gaps and 40% of no-earnings gaps at the day-one close (section 4.3). Open question: does a gap that opens under the 200 and closes above it count (HTZ, DELL)? Question 6. |
| B23 | $10 and $20 million a day | Our test used it. Excludes most of Bonde's low-float favourites. FSLY was $9.31 before its gap and $13.49 at the open: which price counts? Question 7. Two of his named gaps fail it outright (HTZ about $5 to $7; APPS about $6 to $8 and $16.7 million a day; section 6.7). |
| A3, F62 | stop a few cents under the day's or prior day's low | A natural fit: the gap day's low (day one) or the pullback low (later). The owner says the same (OKTA). |
| A13 | stops usually within about 3% | **Conflict on day one.** From the close, the stop under the gap day's low was over 3% on 52.5% of earnings gaps and on all 18 of his named gaps. The opening-range entry is usually closer to the low than the close is, but daily data cannot measure it. Question 4. |
| A5, A7 | size from the stop; one buy, one stop; max 40% | A 9% stop at 1% risk is an 11% position; a 2% stop is capped at 40%. A tight stop on a news stock does not cover the next gap (A7). |
| E57 | market orders | A market order when the opening range high trades, or when the reclaim level trades. |
| E58 | no buys outside regular hours | **Conflict with Bonde**, who buys pre-market ("Most EP where I made big money I bought in pre market."). Kullamägi mostly agrees ("I rarely trade in extended hours"). The house rule stands. |
| C28 | no more than 4% past the buy point | The buy point is the opening range high (day one) or the reclaim level (later), not the old base pivot; otherwise every gap is a chase. Question 5. |
| C29 | skip a long more than 10% above its 10-day | **The biggest conflict.** 32.5% of earnings gaps (66.3% of gaps of 10%+) and 16 of his 18 named gaps closed more than 10% above the 10-day. Applied on day one, C29 removes most of his own favourite trades. It does not remove worse trades (section 4.3, point 5). Question 3. |
| C31 | RS 80+, except parabolic and mean reversion | A neglected stock's RS before the gap can be low (FSLY "beaten to hell"). Question 8. |
| B22 | no buys in the 3 days before earnings; hold through only if up 5R | Not a conflict on the gap itself (the report is out). It blocks a news gapper with a report due in 3 days, and it governs holding into the next report about 60 sessions later. |
| B19, E51, E52, F63 | a third at 3R, a third at 5R, trail the 10 or 21-day; breakeven at 2R to 5R; trim at the open if it gaps past a trim | Fit. Kullamägi trails the 10 or 20-day. Gappers often gap again (F63 applies). |
| B20 | a gap through the stop: first 30-minute low is the new stop; out past 2R | Applies; news stocks gap again on follow-up news (FSLY's "40% gap down"). |
| C33 | under 1R after 10 sessions: sell | Fits Bulkowski ("If price shows weakness in the first week, consider selling.") and Bonde's 2-6 week path. |
| C32 | no news-day rule (Fed, CPI) | Not about this setup; this setup is stock news. |
| D40 | prefer growing sales and earnings | Fits every source on earnings gaps. |
| D42 | never own more than 1% of average daily volume | Matters for small news gappers. |
| E56 | at most 3 tries a week, 6 a month in one stock | Matters: gappers are volatile and get retried. |
| F65, B18 | the market reading as a guide | The owner says these trade even in corrections (section 6); Bulkowski's good surprise "works best in a bull market". |

---

## 8. Proposed rules for our course

Every line is measurable on daily bars unless it says intraday. Thresholds marked *measured* come from section 4.3.

### 8.0 Scope: what this setup is, next to its neighbours [my proposal, for question 1]

- **This setup (22)**: a catalyst gap (earnings or news) traded on day one or on its first pullback and reclaim within
  about 10 sessions.
- **Episodic Pivot (20)**: the same gap in a neglected stock out of a long quiet base, the biggest-surprise version.
- **Power Earnings Gap (21)**: the earnings gap in a stock that clears its base; the owner's "PEG" build-out.
- **Later entries on the same gap**: Gap Support (the test of the gap-up low), Slingshot (the first pause), Go Signal,
  High Volume Edge, delayed reaction. They keep their own lessons.
- **Not this setup**: a Kicker (positioning, rarely earnings), a gap on day 3 to 5 of a parabolic burst (Bracco's
  climax gap), a news gap that closes red (the News Failure, setup 23).

### 8.1 What it is (checked on the gap day)

- **Catalyst.** A fresh, named catalyst released outside market hours: an earnings report (with guidance), or company
  news that changes the business (a contract or partnership, a buyout, a product, a regulatory or FDA decision, a
  government stake). [originator: Bonde's high and low probability lists; Kullamägi's types; UCT] Analyst upgrades and
  media mentions alone do not count. [my proposal, from Bonde's low-probability list: "have a low probability of follow
  through"]
- **Gap.** The open is at least 4% above the prior close. [my proposal; the house EP floor; Bonde's 2014 scan uses 4%,
  but close to close] Prefer 8% or more; 10% or more for an A+. [originator: Bonde 2010; Kullamägi] Options in
  question 2.
- **Volume.** At least 3 times the 50-day average by the close (on pace for it by the opening-range buy). [source
  consensus: Bonde 2014, Wagner] A+ when it is the highest volume in a year or ever. [originator: Bonde 2010; UCT HVE]
- **The gap holds on day one.** It closes above the prior day's close and does not trade back to it, and closes in the
  upper half of its range. [source consensus for the gap staying open: Morales and Kacher, Wagner; Kullamägi's "sold
  off. This is not an EP."; UCT: "We want to see bull gaps stay open". The upper-half close is my proposal, measured:
  upper-half closes held the gap-day low 68% of the time against 40%; no outside source sets that line] A close in the
  lower half is a B-; a red close is not this setup.
- **Location.** The gap-day close is above the 200-day SMA. [house rule B26] Prefer a gap out of a base: an open above
  the top of a base of 4 weeks or more, or out of a 3 to 6 month sideways range (to measure it: the prior 60 sessions'
  high is no more than 35% above their low, the quiet test of section 4.3; the 35% is my line, neither source gives
  one). [source consensus on a prior base: Kullamägi (sideways 3-6 months), Wagner (a base of at least four to five
  weeks); the 35% is my proposal]
- **Not late.** Not up more than about 30% in the 3 months before the gap, and not the 3rd to 5th day of a straight-up
  burst. [originator: "not rallied" in Bonde (looked at over about 65 days) and Kullamägi (3-6 months), with no number
  from either; the 30% line is my proposal; UCT: Bracco's climax gap] (Measured: earnings gaps after a 30% run were
  +0.15R, 0.15, against +0.29R, 0.05, for quiet stocks; not a clean difference.)
- **Liquidity.** At least $10 at the entry price and $20 million a day; never more than 1% of average daily volume.
  [house rule B23, D42]
- **Fundamentals (earnings gaps).** Growing sales and earnings, ideally accelerating, with a beat and raised guidance.
  [house rule D40; originator: Bonde, Kullamägi]

### 8.2 The buy

Two buys. Recommended: teach both, day one first, because the owner's own words and our test favour it on earnings
gaps. [my proposal; UCT; measured]
- **Buy 1, day one (intraday).** A market order when price trades above the opening range high (the first 5 or
  30-minute high; Kullamägi also uses 1 and 60 minutes) and volume is running hot (Kullamägi: the average daily volume
  in the first 15 to 20 minutes). [originator: Kullamägi; UCT; house rule E57] Only while the stock is still above its
  open. [my proposal, from Kullamägi's "gapped up slightly but sold off. This is not an EP."] No pre-market or
  after-hours buys. [house rule E58]
- **Buy 2, the first pullback and reclaim (the card).** Within about 2 to 10 sessions: at least two down days (or an
  inside day, or a shake under the prior low) that keep every close above the gap-day low; buy with a market order when
  price trades above the prior day's high. The stricter card version waits for a close above the gap day's high.
  [UCT card; Wagner's inside day; TSDR's "shakes into the gap"] Measured: neither version beat day one on earnings gaps
  (section 4.3).
- **No chasing.** Not more than 4% above the trigger (the opening range high, or the reclaim level). [house rule C28]
- **Not in the 3 days before a scheduled report** (a news gapper with earnings due). [house rule B22]

### 8.3 The stop

- **Buy 1**: a few cents under the day's low at the time of the buy (usually the opening range low). [source
  consensus: Bonde, Kullamägi, the owner; house rule F62] If that stop is more than 1.5 times the 14-day ATR from the
  entry, skip. [originator: Kullamägi's 1 to 1.5 times ADR/ATR cap; he names no ATR length, the 14 days is my choice] A
  stop over 3% is allowed only by question 4.
- **Buy 2**: a few cents under the pullback low. [UCT; house rule A3]
- **No porosity.** Morales and Kacher allow 1-3% under the gap-day low; the house rule is that the stop is the exit
  (A4). [house rule]

### 8.4 Trims and trail (house defaults)

- A third at 3R (breakeven between 2R and 5R), a third at 5R, the last third on a close under the 10-day (fast movers)
  or the 21-day. If it gaps past a trim level, trim at the open. [house rule B19, E51, E52, F63]
- Under 1R after 10 sessions: sell. [house rule C33; Bulkowski's first-week rule]
- Into the next earnings report (about 60 sessions later): hold only if up 5R. [house rule B22]
- A climax run (3 to 5 straight up days, gaps, range expansion): sell a big part. [house rule C34]

### 8.5 What invalidates it

- Day one closes red, or trades back to the prior close (the gap fills). [source consensus: Morales and Kacher, Wagner,
  Kullamägi] A red close after good news is the News Failure (setup 23).
- A close under the gap-day low in the first 10 sessions. [originator: Morales and Kacher's book Rule #2 (sell below
  the gap-up day's intraday low, waiting for the close is allowed); Bonde 2017 ("normally low of the EP day"); measured:
  on earnings gaps 45% did this, on others 60%]
- The pullback breaks the gap-day low before any reclaim (no Buy 2).
- Still under 1R after 10 trading days (C33).

### 8.6 The short mirror: the earnings breakdown [my proposal; question 12]

The owner's own word for the down version is "earnings breakdown" (verdict line 289), kept apart from the "bear gap off
the highs". Shorts are the long setups reversed (D47) and only under the 200-day (B26).
- A gap down of 4% or more on bad earnings or news, on 3 times volume, closing in the lower half, in a stock already
  under its 200-day, with an RS of 20 or less (C31's mirror). Short with a market order under the opening range low;
  stop a few cents over the day's high; skip if hard to borrow (D48).
- Expect it to be shorter: Bulkowski's bad surprise, "Expect a quick but shallow decline." and "almost half (47%)
  bottom in one week". So take trims faster. [source: Bulkowski]
- Our Chart IQ calls the long side of this "no swing trade area" (section 5.3), which is consistent.

### 8.7 Best market conditions

- A Green or Yellow market reading (F65). [house rule]
- Earnings season: Kullamägi says EPs "mostly occur during a concentrated period of 3-4 weeks every quarter". [originator]
- Coming out of a correction: "often coming out of corrections it is the recent ER gappers that have stellar performance
  on the other side." (Sunday Scans 2025-11-23, calendar section, no byline) Bonde (2007): "When market expectations
  are low, or market has had several months of correction, you will find 50 to 100 opportunities in an earning season."
  [UCT; originator]
- Our measurement: earnings Buy A was +0.07R in 2000 to 2012, +0.28R in 2013 to 2019, +0.27R in 2020 to 2026.

### 8.8 Common mistakes

1. Buying a gap with no catalyst, or a weak one (an upgrade, a media mention). [Bonde]
2. Buying the open before the opening range forms, with no stop to lean on. [Kullamägi; course draft]
3. Buying a gap that is filling, or that closed red. [Morales and Kacher; Wagner]
4. Buying the third gap of a parabolic burst. [Bracco; ChartSchool's exhaustion gap]
5. Sizing from a tight intraday stop as if a news stock cannot gap again. [house rule A7; owner's FSLY]
6. Pre-market buys. [house rule E58]
7. Calling every big gap "earnings" without checking (a quarter are not). [measured]
8. Calling an earnings gap a Kicker. [owner, verdict lines 3 to 5]
9. Holding through the next report without a 5R cushion. [house rule B22]
10. Moving the stop under the gap-day low to give it room. [house rule A4]
11. Chasing a gap far above the opening range high, or a stretched later entry (C28, C29 on Buy 2).

---

## 9. Grading: what makes it an A+ versus a B-

The owner said grading is "discretionary and hard to define" (E50). These are observable cues from the sources, for him
to accept or change.

| cue | A+ | B- |
|---|---|---|
| catalyst | earnings with triple-digit or accelerating growth, a beat and a raise; or a business-changing deal | an upgrade, a media mention, a vague press release |
| gap | 10% or more, a true gap (the low stays above the prior high) | 4% to 6%, trades back into the prior range |
| volume | the highest in a year or ever (HVE); the average daily volume in the first 15 to 20 minutes | 2 to 3 times average |
| close | top quarter of the range | lower half |
| location | opens above a base of 4 weeks or more, or out of a 3 to 6 month quiet range; above a rising 200-day | just over the 200-day, into old overhead supply |
| before the gap | quiet, not up more than about 15% in 3 months | up 30% or more already; a second or third gap |
| group and market | first of a strong group; Green market | weak group; Orange market |
| stop on day one | within about 1 ATR and near 3% | more than 1.5 ATR away |
| follow-through | holds the upper half of the gap day in the first pullback | dips under the gap-day midpoint |

Sources for the cues: Bonde (volume records, neglect, catalyst quality), Kullamägi (10%, first-minutes volume, 3-6
months sideways, 1 to 1.5 times ATR), Morales and Kacher (the gap must not close; extended after a long run), Wagner
(base length, 3 times volume), Bulkowski (tight flags beat loose ones), the owner (volume, open gaps, first of the
group, PEG list).

---

## 10. Questions for the owner

1. **Scope.** What does setup 22 cover? (a) Any catalyst gap, earnings or news, traded on day one or the first pullback
   (my recommendation), with EP and PEG as named versions; (b) only non-earnings news and PR gappers, with every
   earnings gap going to PEG (21); (c) only the card's first-pullback-and-reclaim entry, with day one taught under EP
   and PEG.
2. **Minimum gap.** 4% (Bonde's scan; our EP floor), 8% (Bonde 2010), 10% (Kullamägi), or 0.75 ATR (Morales and
   Kacher)? Your TXN example opened 3.7% up.
3. **C29 on day one.** Exempt the gap day of a catalyst gap from C29 (like the parabolic exception), apply C29 only to
   the later entry, or apply it everywhere (which removes most day-one trades, including FSLY, DELL, OKTA and CRCL)?
4. **A13 on day one.** Allow day-one stops over 3% if under 1.5 ATR, require an opening-range entry close to the low,
   or skip any gapper whose honest stop is over 3%?
5. **The buy point for C28.** The opening range high on day one and the reclaim level later?
6. **B26 and the gap through the 200.** Does a stock that opens under the 200-day and closes above it qualify (HTZ, DELL),
   or must the prior close already be above it?
7. **B23 and the price.** Is $10 measured at the entry (FSLY opened at $13.49) or at the prior close ($9.31)?
8. **C31 RS.** Is RS 80 required before the gap, after the gap day, or waived for neglected names (like your HVE ruling
   on FSLY)?
9. **Which news counts.** Earnings, guidance, contracts, partnerships, buyouts, FDA, government stakes, sector news. Do
   analyst upgrades, index additions or sympathy moves count?
10. **The course draft.** "Never the open, always the reclaim" (docs/curriculum, SET.20) against "I love trading earnings
    gappers on day one". Rewrite the draft to teach both?
11. **Delayed reaction.** A variant of this setup or its own lesson (U, RDDT, ESTC, BFLY, ELVN)? Bonde uses the same
    name ("Delayed reaction Episodic Pivots", 2024).
12. **The short mirror.** Teach the earnings breakdown short under the 200-day, or leave this setup long-only?
13. **Stop reference.** Day's low (Bonde, Kullamägi, your OKTA note), the 50-day (your CRCL note), the gap midpoint (our
    Chart IQ), or the earnings-day close?
14. **App fixes (later, not now).** Check earnings dates before the "likely earnings" label; draw the gap on the card
    glyph; move the Chart IQ BGU stop to the gap-day low; raise screen floors to B23; one reading of "News Gappers"
    across the vision eval, the catalyst engine and the Model Book.
15. **Model examples.** Which of the 18 gaps in section 6.7 should be lead examples, and which are failures worth
    teaching (APPS, HTZ, TWLO 2025-10-31)?

---

## 11. Sources

All read on 2026-11-09 unless marked.

| source | publisher / author | URL or path | reliability |
|---|---|---|---|
| UCT Substack, 103 posts (sitemap) | UCT (the owner, Bracco, team) | https://unchartedterritoryy.substack.com/sitemap.xml and each `/p/` link above | primary for how we trade it |
| Owner verdicts | the owner | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | primary (his words) |
| Account rulebook | the owner | `docs/study/sizing_rule.md` section 9 | primary (house rules) |
| Trade plans | UCT | `docs/study/TRADE_PLANS.md` | house document (no row for this setup) |
| Model Book card and glyph | UCT | `app/src/pages/modelbook/setupCatalog.js`, `SetupsView.jsx` | house |
| Journal tags | UCT | `app/src/constants/setupGroups.js`, `app/src/pages/journal-2-0/lib/setupTagMap.js` | house |
| Detectors | UCT | `api/services/pattern_engine/detectors/uct/power_earnings_gap.py`, `episodic_pivot.py`, `uct_ep_v2.py`, `uct_go_signal.py`, `uct_slingshot.py`, `uct_gap_support.py` | house code (some outside claims unverified, section 5.5) |
| Chart IQ engine | UCT lab | `api/services/chart_iq/engine/forward.py`, `v3_levels.py`, `v3_bases.py`, `v4_compose.py`, `v2_setups.py`, `v44_read.py` | house code |
| Screener and catalyst engine | UCT | `api/services/screener/base_catalog.py`, `saved_screens.py`; `api/services/catalyst/brain_grades.py`; `api/services/ep_base_rate.py`; `app/src/components/tiles/EpBaseRate.jsx`; `app/src/components/chart/engine/ast/starterScans.json` | house code |
| Brain KB extracts | UCT traders (summaries) | `docs/study/levels/brain_kb_2026-11-06.json`, `brain_kb_rules_2026-11-06.json` | medium; mostly summaries |
| Brain template record | compiled, author unclear | `docs/superpowers/research/setups/setup_criteria.json` | low |
| Course draft | not named | `docs/curriculum/uct_method_scripts.json`; `docs/study/UNITS-method.md` | low (a draft, not a source) |
| Earnings dates | Yahoo via yfinance | `docs/study/setups/earnings_dates_cache.json` | medium; some dates missing |
| "Gaps and traps" (2006-11-22, his replies) | Pradeep Bonde, Stockbee | https://stockbee.blogspot.com/2006/11/gaps-and-traps.html | originator (added in checking) |
| "Trading Earnings Breakouts" (2007-01-06) | Pradeep Bonde, Stockbee | https://stockbee.blogspot.com/2007/01/trading-earnings-breakouts.html | originator |
| "Up stocks and down stocks" (2007-02-15) | Pradeep Bonde | https://stockbee.blogspot.com/2007/02/up-stocks-and-down-stocks_15.html | originator (the term "episodic pivots" in use; added in checking) |
| *Episodic Pivots and "Idea Pickle"* (2007-02-26) | Pradeep Bonde | https://stockbee.blogspot.com/2007/02/episodic-pivots-and-idea-pickle.html | originator |
| "How to trade earnings" (2007-03-30) | Pradeep Bonde | https://stockbee.blogspot.com/2007/03/how-to-trade-earnings.html | originator |
| "How to trade earnings Part3" (2007-04-01) | Pradeep Bonde | https://stockbee.blogspot.com/2007/04/how-to-trade-earnings-part3.html | originator |
| "How to trade earnings Part 2" (2007-03-31) | Pradeep Bonde | https://stockbee.blogspot.com/2007/03/how-to-trade-earnings-part-2.html | originator (the writer tried a `/2007/04/` address that does not exist; the blog's own link points here) |
| "Earnings and Bulkowski" (2007-04-04) | Pradeep Bonde | https://stockbee.blogspot.com/2007/04/earnings-and-bulkowski.html | originator |
| "What are Episodic Pivots and how to find them" (2010-02-12, with comments) | Pradeep Bonde | https://stockbee.blogspot.com/2010/02/what-are-episodic-pivots-and-how-to.html | originator; reader comments are not |
| "My process flow for Episodic Pivots (EP)" (2014-07-30, with comments) | Pradeep Bonde | https://stockbee.blogspot.com/2014/07/my-process-flow-for-episodic-pivots-ep.html | originator |
| "Delayed reaction Episodic Pivots" (2024-05-15, video only) and "Scans Irun in Marketsurge to find Delayed Reactions Episodic Pivots (EP)" (2025-09-01) | Pradeep Bonde | https://stockbee.blogspot.com/2024/05/delayed-reaction-episodic-pivots.html, https://stockbee.blogspot.com/2025/09/scans-irun-in-marketsurge-to-find.html | originator (the name only; the video and the scan images were not reviewed) |
| "3 TIMELESS setups..." (2021-01-08, updated 2021-04-28) | Kristjan Kullamägi | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | originator (his EP version) |
| "How to master a setup: Episodic Pivots" (2021-11-02) | Kristjan Kullamägi | https://qullamaggie.com/how-to-master-a-setup-episodic-pivots/ | originator (his EP version) |
| FAQ: undercut of the gap-up low (2010-10-24, quotes the book's page 171) | Morales and Kacher, VoSI | https://www.virtueofselfishinvesting.com/faqs/answer/stocks-that-undercut-the-low-of-the-gap-up | originator |
| FAQ: how to tell a gap is buyable (2010, updated 2012) | VoSI | https://www.virtueofselfishinvesting.com/faqs/answer/how-do-you-determine-if-a-stock-gapping-up-is-buyable-if-it-is-buyable-how-do-you-time-your-entry | originator |
| FAQ: buy at the open or later (2012, updated 2025) | VoSI | https://www.virtueofselfishinvesting.com/faqs/answer/should-i-buy-a-buyable-gap-up-at-the-open-or-wait-until-later-in-the-trading-day-what-about-buying-in-subsequent-days-on-pullbacks-stop-loss | originator |
| FAQ: low more than 7-8% away (2010) | VoSI | https://www.virtueofselfishinvesting.com/faqs/answer/if-you-buy-a-stock-on-a-gap-up-day-and-the-low-of-the-day-is-greater-than-7-8-from-where-you-bought-it-do-you-still-set-your-stop-at-the-gap-up-days-low | originator |
| FAQ: doubled before a BGU (2013) | VoSI | https://www.virtueofselfishinvesting.com/faqs/answer/should-a-stock-that-has-a-buyable-gap-up-have-at-least-doubled-in-price-from-its-lows-to-its-highs-before-the-bgu-day-for-the-bgu-to-work | originator |
| FAQ: the 6-day sell rule (2013) | VoSI | https://www.virtueofselfishinvesting.com/faqs/answer/what-is-the-6-day-sell-rule-for-bgus | originator |
| FAQ: a second gap up (2025) | VoSI | https://www.virtueofselfishinvesting.com/faqs/answer/what-if-a-stock-gaps-up-then-some-days-later-gaps-up-again | originator |
| FAQ: FFIV and LVS gaps (2010) | VoSI | https://www.virtueofselfishinvesting.com/faqs/answer/could-you-briefly-explain-for-the-sake-of-education-if-there-is-a-significant-difference-in-the-gap-up-of-ffiv-and-the-gap-up-of-lvs-as-of-october-28-2010 | originator |
| FAQ: performance results (2014, updated 2022) | VoSI | https://www.virtueofselfishinvesting.com/faqs/answer/do-you-have-performance-results-over-the-years-of-the-pocket-pivot-review-and-the-buyable-gap-ups | originator (no numbers) |
| *Trade Like an O'Neil Disciple* catalogue page (1st edition September 2010, 384 pages) | Wiley | https://wiley-vch.de/en/areas-interest/finance-economics-law/trade-like-an-o-39-neil-disciple-978-0-470-61653-6 | publisher (book not read) |
| "PPR - Lesson on buyable gap ups" (2011-11-03) | VoSI | https://www.virtueofselfishinvesting.com/reports/view/ppr-lesson-on-buyable-gap-ups | originator |
| "PPR - Some Thoughts on the Psychology of Gap-Ups vs. Pocket Pivots" (2011-02-12) | VoSI | https://www.virtueofselfishinvesting.com/reports/view/PPR-Some-Thoughts-on-the-Psychology-of-Gap-Ups-vs-Pocket-Pivots | originator |
| Event patterns; earnings flag; good and bad earnings surprise; FDA approvals; upgrades; gaps; Kacher-Morales setup; glossary | Thomas Bulkowski, ThePatternSite | https://thepatternsite.com/eventpatterns.html, earnflag.html, earnsgood.html, earnsbad.html, fda.html, upgrade.html, gaps.html, KacherMorales.html, glossary.html | measured statistics with stated limits; read via WebFetch; **the site states: "This website, in whole or in part, shall not be used to train artificial intelligence (AI) systems"** |
| "How To Trade Breakaway Gaps For Huge Stock Gains" (2018-09-06, modified 2022-04-06) | Deron Wagner, Morpheus Trading | https://morpheustrading.com/blog/breakaways-gaps/ | established educator |
| "Gaps and Gap Analysis" | StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/chart-analysis/gaps-and-gap-analysis | established educator |
| "Gap Study (3/3)" (2010-10-02) | Adam Grimes, SMB Training blog | https://www.smbtraining.com/blog/?p=7421 | measured study, short window |
| "The Breakaway Gap: How To Buy Strength While Managing Your Risk" (2026-05-28) | Rachel Fox, Investor's Business Daily | https://www.investors.com/how-to-invest/investors-corner/breakaway-gap-how-to-buy-strength-manage-risk/ | established; teaser only (paywall) |
| "Buying When A Stock Gaps Up Can Be Scary But Also Profitable" (2015-04-15) | Investor's Business Daily, republished by Yahoo Finance | https://sg.finance.yahoo.com/news/buying-stock-gaps-scary-profitable-221200313.html | established; read through WebFetch only (Yahoo answered a plain download with HTTP 429) |
| "How to Profit from Strong Earnings Reports While Reducing Risk" (2021) | StockCharts ChartWatchers (EarningsBeats) | https://articles.stockcharts.com/article/articles-chartwatchers-2021-09-how-to-profit-from-strong-earn-50/ | opinion; not used for rules |
| Frazzini (2006), "The Disposition Effect and Underreaction to News" | *Journal of Finance* 61(4) | https://ideas.repec.org/a/bla/jfinan/v61y2006i4p2017-2046.html | peer-reviewed (abstract) |
| Gervais, Kaniel, Mingelgrin (2001), "The High-Volume Return Premium" | *Journal of Finance* 56(3) | https://ideas.repec.org/a/bla/jfinan/v56y2001i3p877-919.html | peer-reviewed (abstract) |
| Bernard and Thomas (1989), "Post-Earnings-Announcement Drift - Delayed Price Response Or Risk Premium" (title as RePEc lists it) | *Journal of Accounting Research* 27 | https://ideas.repec.org/a/bla/joares/v27y1989ip1-36.html | peer-reviewed; citation only, no abstract read |
| Chan (2003), "Stock price reaction to news and no-news: drift and reversal after headlines" | *Journal of Financial Economics* 70(2) | https://ideas.repec.org/a/eee/jfinec/v70y2003i2p223-260.html | peer-reviewed; title only, abstract not reachable; nothing quoted |
| Brian Shannon, AVWAP pages | alphatrends.net | https://alphatrends.net/archives/trading-ipos-with-the-anchored-vwap/ and https://alphatrends.net/anchored-vwap/ | established; no earnings text, not quoted |
| Not reached | TraderLion (403 to a plain download and to WebFetch); TraderPlanet BGU article (site error); the IBD body (paywall) | | |
| Setup 21 (Power Earnings Gap) and 23 (News Failure) dossiers | written by sibling runs the same day | `docs/study/setups/research/21-power-earnings-gap.md`, `23-news-failure.md` | read only for the boundaries in 8.0; not used as sources |
| Our test | this dossier | session scratchpad `setups/22-news-gapper/tools/measure.py`, `baseline.py`, `examples.py`; local bars `uct_tests_datadir_8_xzj23w/bars.db` (read-only) | our own; limits in section 4.3 |

---

## Removed in checking

Cold check, 2026-11-09. Each item says what the first draft said, what the source shows, and what changed.

**Wrong, corrected**
1. *"Part 2 is gone"* (sections 2, 3.3, 11). The draft tried `/2007/04/how-to-trade-earnings-part2.html`, which does not
   exist; the blog's own link is `/2007/03/how-to-trade-earnings-part-2.html` (2007-03-31) and it loads. Its sales-growth
   rule is now in 3.3.
2. *"2007-02-26 names the Episodic Pivot."* The term is already in Bonde's 2007-02-15 post ("Up stocks and down
   stocks"), which also says a stock is "already in my 'Episodic Pivot' list". The 02-26 post explains where the idea
   came from; it is no longer called the naming.
3. *Bernard and Thomas (1989) "named by Bonde".* Bonde's posts name only Ball and Brown (1968). Bernard and Thomas stay
   as the classic paper, marked as added here.
4. *Bulkowski: "each page says 'The above numbers are based on hundreds of perfect trades.'"* The broker upgrade page
   carries no such sentence (WebFetch, asked twice). Now limited to the four pages that do.
5. *"As I understand Bulkowski's method (not checked today), that means measuring from the breakout to the ultimate
   high".* Replaced by his glossary's own definitions (average rise, ultimate high, break-even failure), read today.
   The glossary does not define "perfect trades".
6. *Morales and Kacher hold-and-sell rule "as the WebFetch tool summarised it, not his exact words".* Replaced by
   Bulkowski's exact sentences, each confirmed on the page.
7. *Book name stated as if the FAQ gave it.* The FAQ says only "our book (hardcover 1st edition)"; Wiley's catalogue page
   (1st edition September 2010) is now cited for *Trade Like an O'Neil Disciple*.
8. *Quotes from the unbylined calendar, Index and ETF, and closing sections given as "the owner's"* (section 1, 3.1 twice,
   6.2 four rows, 8.7). They are now marked "no byline". The 2025-07-13 calendar line, which sat under "Bracco" (6.4),
   moved to the 6.2 table. 3.1's "Track them" now leads with a quote from the owner's own section (2026-07-12).
9. *NVDA 2023-05-25 labelled "Gap Support kept great (NVDA 2023)"* (6.7). Verdict line 206 cut that late-May 2023 gap
   ("Never really tested gap support"); the "great" NVDA (line 196) is the late-February 2023 gap.
10. *"All of these use the shared `liquidity_floor`"* (5.2). `episodic_pivot.py` does not import it and has no price or
    liquidity floor of its own.
11. *Only FSLY flagged under B23* (6.7). On our bars HTZ (about $5 to $7) and APPS (about $6 to $8, $16.7 million a day)
    fail B23 outright. Added to 6.7 and the B23 row of section 7.
12. *Kullamägi "never pre-market"* (3.14). He wrote "I rarely trade in extended hours". Section 7's "Kullamägi agrees
    with the house" softened the same way.
13. *"Bonde's scans measure the close"* stated without the rest (3.3, 3.14, 5.5). Still true of his published scans, but
    his 2006 replies speak of gaps ("20% plus gaps") and his 2014 routine starts from after-hours and pre-market movers.
    Added.
14. *Course draft numbers "are round illustrative figures, not a real trade"* (3.11). The script itself calls that
    chapter "a real loser"; the figures name no stock and do not match the META chart notes. Reworded to say they cannot
    be traced.
15. *"In the owner's writing ... 43 uses"* (2). The 43 count covers all sections and writers of the 103 posts; reworded.
16. *"day-one buys that stopped (OKTA, TWLO)"* (6.6). OKTA was sold at breakeven, not stopped.
17. *Bracco's climax gap called "his short trigger"* (6.4). The post makes the gap a condition; the entries are intraday
    (the "U-Turn" and others). Reworded, with his "day 3 to 5" sentence quoted.
18. *Owner column "trail the 20-day"* (3.13). No source for a 20-day trail by the owner; replaced by the house rule E52
    (10-day or 21-day).
19. *Basis tags in 8.1, 8.3, 8.5.* "The gap holds on day one" was tagged source consensus including the upper-half close,
    which no outside source sets (now split: the open gap is consensus, the upper-half close is my proposal, measured).
    "Location" was tagged [originator: ... Wagner]; Wagner is an educator, so it is now [source consensus: Kullamägi,
    Wagner]. "Not late" carried a 30% line tagged originator; neither Bonde nor Kullamägi gives a number, so the 30% is
    now [my proposal]. The 14-day ATR length is marked as my choice. "Over 1R never reached in 10 sessions" did not match
    C33 ("still under 1R after 10 trading days") and now does.
20. *Section 5.5 point 2* said the detectors' Bonde phrases were missing from "the seven Bonde posts I read"; the list is
    now longer (3.3) and a blog search for "power earnings gap" found none. The EP detector's phrase is "filling the EP
    bar", not "filling the gap" (that one is the PEG detector's); both are now named. The PEG detector's quoted
    paraphrase of Bonde ("5+ points OR 8%+ gain") is added to the list.

**Removed**
- *"The test machine's daily bars (3,897 stocks)".* The count could not be reproduced: the read-only bars database now
  holds 4,284 tickers with daily bars (it was written to after the draft's run). The number that matters, 990 stocks in
  both the bars and the earnings-date cache, was re-counted and stands.

**Added in checking** (each read today): Bonde's "Gaps and traps" (2006-11-22), "Up stocks and down stocks"
(2007-02-15), "How to trade earnings Part 2" (2007-03-31), and his delayed-reaction posts (2024-05-15, 2025-09-01), which
show "delayed reaction" is also Bonde's term; the owner's opening-volume words on GRRR (2025-06-20); verdict lines 162,
196, 206, 225 and 227; IBD's "Gaps are exceptions." to its 5% chase limit (2015, via Yahoo Finance and WebFetch); the
engine note that its `Earnings-Gap` flag is separate from the EP count (4.2); Bulkowski's reading of the stop ("Sell if
price closes below the low posted on the day price gaps up."); the note on Substack dates (UTC).

**Checked and confirmed, no change:** every other quote in the file (word for word, in context, by script against fresh
downloads, or one at a time through WebFetch for Bulkowski); the RePEc citations; the post dates and sections of the 41
cited Substack posts; the verdict lines cited in 6.1; the rule numbers and wording used in sections 7 and 8 against
`sizing_rule.md` section 9; the scanner and engine summaries in section 5 against the code; the glyph arithmetic in 3.2;
the 4.3 tables against the draft's saved outputs (`measure/table2.md`), including a re-count of the 6.2% earnings-date
hole; and the gap, price and date figures of section 6.7 spot-checked on the bars database (FSLY, NVDA, TXN, HTZ, DELL).

---

### Cold check 2 (2026-11-09 evening, a third reader)

Method: own downloads of every web source (not the writer's copies), a script match of all 529 quoted spans, a per-row
match of the 61 Substack rows (quote inside the linked post, date against `datePublished`, section heading against the
"where" column), a per-quote match of the Bonde, Kullamägi and VoSI quotes to the post or FAQ they are dated to, the
Bulkowski pages through WebFetch, the code of section 5 re-read, 12 of the 18 gaps in 6.7 recomputed from the bars
database (META, OKTA, APPS, TWLO twice, MXL, AAON, CRCL, GRMN, SANM, XMTR, RMBS, plus the writer's five again), and a
full re-run of the section 4.3 scripts.

**Confirmed, no change:** all 529 quotes (0 misses); all 41 Substack post dates and the eight "evening before" posts;
the 43 uses of "earnings gapper" (my count on the fresh downloads, all sections and writers); the section headings over
every 6.2, 6.3 and 6.4 quote (the owner's rows sit under "TSDR’s Weekly Outlook & Watchlist" or its "Charts Covered"; the
"no byline" rows under "Earnings & Economic Calendar for the Week", "Closing Comments and Mindset" or "Index & ETFs"; the
team rows under each signer's heading; the 2025-11-09 "I love trading earnings gappers on day one." is the post's
opening paragraph); the 12 Stockbee post dates; the commenters and dates of the Stockbee comment quotes (the "about 6%
CAR" / "about 50% CAR" backtest is a reader signing "Paul", 2010-02-21; the "less than 1%", "low of last 2 days", "4
parts", "85 plus" and "monthly EP scan" replies are Pradeep Bonde's, 2010; "Yes. It is normally low of the EP day." is
his, 2017-01-31; "ATM" is his, 2021-11-08); his blog search for "power earnings gap" (three posts: Opportunity Buffet Part
1, How to trade earnings, Gaps and traps; the phrase appears only in the search box and result banner); the Kullamägi
post dates (2021-01-08, modified 2021-04-28; 2021-11-02); every VoSI page date ("Last updated" or "Published" as the page
prints it: 24 Oct 2010; 21 Oct 2010 and 4 Apr 2012; 25 Jul 2012 and 11 Feb 2025; 21 Oct 2010; 1 Aug 2013; 13 May 2013;
3 Jul 2025; 28 and 31 Oct 2010; 25 Feb 2014 and 20 Oct 2022; 3 Nov 2011; 12 Feb 2011) and the "Rule #2" / "page 171 of
our book (hardcover 1st edition)" wording; Wagner (2018-09-06, modified 2022-04-06); Grimes (2010-10-02; his "closure"
is a gap that "traded back at least to the previous day’s range"); IBD (Rachel Fox, 2026-05-28) and the Yahoo reprint
(2015-04-15, "Gaps are exceptions."); Wiley (1st edition, September 2010, 384 pages, "Dr. K's Laboratory: Buying Gap-Ups
in Leading Stocks"); RePEc (abstracts for Frazzini and Gervais et al.; "No abstract is available" for Bernard and Thomas
and for Chan); every Bulkowski sentence and number in 3.6 and 4.1, including that the broker-upgrade page lacks the
"perfect trades" sentence and the bad-surprise table is one bull-market table; the five brain KB rows of 6.5; the
`setup_criteria.json` quotes; the course draft's 12 minutes, its "$31.20 / $29.95" figures, its "real loser" and its META
2023-02-02 chart notes; the glyph arithmetic (the pullback's lowest low is 1.0576 against a gap-day midpoint of 1.0529,
the trigger closes at 1.1295 against a gap-day high of 1.1118, in units of the pre-gap price); every detector constant
and sentence quoted in 5.2 and 5.5 (including the PEG detector's docstring-versus-code mismatch, "largest gap_pct" against
the highest-confidence pick); the Chart IQ, screener and catalyst-engine readings of 5.3 and 5.4; the rulebook numbers
of section 7 (71 rules, the texts of A3 to F69 as cited); and all 18 rows of 6.7 (12 recomputed here, 5 by the writer,
TSN recomputed too).

**Corrected or tightened:**
1. *Baseline (4.3).* The writer's +0.04R (0.03) is what the writer's saved run gives, but a re-run of the same script
   on the same database a few hours later (new bars had been added, so the same seed drew a different set of days)
   gives +0.09R (0.03). Both are now reported, and point 2 of "What the numbers say" no longer leans on the lower one.
   Everything else in 4.3 reproduced within rounding; the re-run's counts are recorded under "Reproduction".
2. *Kullamägi's 30% position cap (3.4)* is a general rule from the introduction of his 2021-01-08 post, not an EP rule;
   said so. Which of his two posts each 3.4 quote comes from is now stated.
3. *"PEG flag" (5.3)* has a second branch in the code (a 3% gap whose day closes 10% or more up, on 3 times volume);
   added.
4. *3.11* said `UNITS-method.md` "carries the same line"; it carries the same lesson title and the idea in different
   words ("never the emotional open"). Reworded.
5. *8.1 Location* said "a 3 to 6 month sideways range" with no measurable line; the 60-session range test of 4.3 (35%)
   is now attached and marked as my proposal.

**Removed:** nothing. No quote, attribution, date or number in the file failed its source.

---

## 12. Examples (from our data)

Scan written 2026-11-09 night (`_study-resume/scratchpad/setups/22-news-gapper/ng_scan.py`, charts `ng_chart.py`), on
the local sandbox's daily bars, read-only, over the 2,630 names that ever met the house liquidity rule, from 2005-01-01
(report dates are complete from about 2005, so an earnings gap can be told from a news gap). All 2,630 names were
scanned (the 420-second budget was not reached).

**The rule, in one paragraph.** Gap day: the open at least 4% above the prior close; volume at least 3x the 50-day
average; the gap holds (the day's low stays above the prior close), the day closes green and in the upper half of its
range; the close is above the 200-day SMA (B26); the stock is not up more than 30% over the prior 65 sessions; the prior
close is at least $10 and the stock traded at least $20 million a day (B23). The gap is classed **earnings** when the
gap day is a report reaction day (`earnings_reaction_days`: the report date for a pre-open report, the next session for
an after-close one), **news** when the name has report dates covering that time and this day is not one (our data
cannot NAME the news; it only shows a catalyst-size gap that was not a report), **unknown** when the name has no report
dates. Three buys, all market orders at the trigger (E57), chase limit 4% (C28), entry no more than 10% over the 10-day
SMA (C29), stop within 3% (A13): **Buy 1, real** (hourly bars; only names and dates with hourly data, 2023-12-12 on):
over the first-hour high, stop a few cents under the first-hour low, allowed up to 5% when also within 1.5x the 14-day
ATR (the cap in 8.3; flagged, since A13 says "usually" 3%); a buy stopped later the same day is counted as a loss.
**Buy 1, proxy** (daily bars only): the gap-day close with the stop a few cents under the gap-day low, kept only when
within 3%. **Buy 2, the first pullback and reclaim** (the card): within 2 to 10 sessions, a pullback of at least 2
sessions with two down closes or an inside day, every close above the gap-day low and no trade back to the prior close;
buy when price trades over the prior day's high; stop a few cents under the pullback low (within 3%, else under the
lower of the trigger and prior day's lows). Outcome: a fixed stop, no trims, no breakeven move, 60 sessions forward,
the first of stop / 3R / 5R (`common.outcome`).

**Base rate.** 1,491 hits (1,022 earnings, 348 news, 121 unknown; 1,200 pullback buys, 250 close-proxy day-one buys,
41 real first-hour buys). **29.5% reached 3R and 19.5% reached 5R before the stop** (fixed stop, no trims, so the
house trade, which trims a third at 3R and moves to breakeven, would do better on the winners and the same on the
losers). By buy: real first-hour buy 36.6% / 24.4% (41 trades, 2023-12 on, one stopped the same day); close proxy
31.2% / 20.4%; pullback 28.9% / 19.2%. By class: earnings 29.4% / 19.6%, news 29.3% / 18.1%, unknown 31.4% / 23.1%.
Caveats: the day-one proxy is the close, not the opening-range buy the owner takes (daily bars cannot see it before
2023-12); the "news" class means "not a report day", not a verified headline; the 65-session "not late" test and the
3-times volume line are this dossier's proposals (section 8), not owner rulings.

**The 10 examples** (sheets `final/sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png` in the scratch folder; facts from
`final/examples.json`). "Buy" is the market-order fill, "best R" the highest R reached within 60 sessions before the stop.

| # | stock | gap day | class | gap / volume / close in range | buy | stop | best R | why it is textbook |
|---|---|---|---|---|---|---|---|---|
| 1 | INTC | 2014-06-13 | news (not a report day; nearest report dates in our data 2014-04-15 and 2014-07-15) | +6.4%, 4.1x (a 1-year volume high), 62% | day-one proxy, the close 29.87 | 29.51 (1.2%) | 15.8R | A gap out of a 4-month base on the year's biggest volume; the stop under the gap-day low was 1.2% away and never touched; a steady ride on the 10-day EMA to 3R in 8 sessions |
| 2 | ULTA | 2016-03-11 (report 2016-03-10) | earnings | +14.2%, 4.8x (1-year high), 94% | pullback day 6, over the prior high at 190.69 | 186.55 (2.2%) | 12.1R | A big gap out of a correction (down 11% over 65 sessions) that closed at the top of its range; a 4-session pullback 2.8% deep held the gap-day low, then a clean reclaim |
| 3 | AMZN | 2017-10-27 (report 2017-10-26) | earnings | +8.8%, 5.5x (1-year high), 92% | pullback day 6 at 55.11 | 54.29 (1.5%) | 22.6R | The classic: a flat 5-month base, a gap on the year's volume record, a tight 4-session pause 1.7% deep, then a 2-month trend on the 10-day |
| 4 | TWLO | 2018-02-14 (report 2018-02-13) | earnings | +10.0%, 8.3x, 62% | pullback day 8 at 33.55 | 32.59 (2.9%) | 24.1R | A gap out of a 3-month bottom straight through the 200-day; the first 6-session pullback held the gap-day low and the reclaim ran to 3R in 4 sessions |
| 5 | TGT | 2019-08-21 (report 2019-08-21, pre-open) | earnings | +16.8%, 9.0x (1-year high), 93% | pullback day 6 at 105.11 | 103.20 (1.8%) | 12.0R | A 17% gap to all-time highs in a large-cap on 9x volume; a 4-session flag with almost no give-back (0.1% under the gap-day high), then the reclaim |
| 6 | PANW | 2021-08-24 (report 2021-08-23) | earnings | +13.7%, 11.6x (1-year high), 82% | pullback day 8 at 77.06 | 75.92 (1.5%) | 14.2R | Out of a 6-month range on 11.6x volume; a 6-session pullback 2.6% deep that never closed under the gap-day low; a textbook 10-day trend after |
| 7 | DECK | 2023-10-27 (report 2023-10-26) | earnings | +12.5%, 5.2x, 79% | pullback day 7 at 101.01 | 98.39 (2.6%) | 18.9R | A gap from a 3-month pullback to the 200-day; a 5-session pause 1.3% deep; the kind of leader the owner's PEG list is built from |
| 8 | NFLX | 2024-10-18 (report 2024-10-17) | earnings | +7.3%, 5.6x, 92% | pullback day 6 at 75.62 | 74.38 (1.6%) | 19.6R | A gap to new highs from a tight base, a 4-session pullback 2.9% deep, a stop 1.6% away and a two-month run |
| 9 | HAL | 2025-10-21 (report 2025-10-21, pre-open) | earnings | +8.6%, 3.2x, 83% | **real day-one buy**, over the first-hour high 24.87 at the 12:30 bar | 24.07, under the first-hour low (3.3%) | 10.9R | The only example with the owner's actual buy on real hourly bars: the stock cleared its first-hour high in the third hour and never looked back; 3R in 2 sessions. The gap-day close was above a falling 200-day the stock had been under for months (B26 is met, but it is a turnaround, not a leader) |
| 10 | CCJ | 2025-05-23 | news (not a report day; nearest report dates in our data 2025-05-01 and 2025-07-31) | +6.2%, 3.4x, 98% | pullback day 6 at 58.93 | 57.58 (2.3%) | 15.8R | A news gap in a stock already in a strong uptrend (up 13.5% over 65 sessions, under the 30% line) closing at the very top of its range; a 4-session pause 1.9% deep, then 3R in 5 sessions |

Two examples are "news" by our classification (INTC, CCJ): the data shows a catalyst-size gap on a day that was not a
report reaction day, but it does not say what the catalyst was. The owner should confirm the headline before either is
used as a "news" model. Removed in checking: BIDU 2010-02-25 (an 11-session pullback, at the edge of the 10-session
window), FORM 2025-10-29 (a report is listed for that date but the reaction day did not match the gap; ambiguous),
SMTC 2024-03-26 (two sessions before a scheduled report, B22), SGRY 2026-11-04 (only three sessions of history after
the buy, and a report due 2026-11-09). Every chart was looked at; none had a split artefact or a reused ticker.

**Notable failures (in words).** AVAV, gap 2024-03-05 (+15.3% on 15.8x volume, closing at 79% of its range): the
8-session pullback and reclaim on 2024-03-14 was bought at 162.59 and went straight to the stop (158.43) without a
single higher high; a big-volume gap does not protect a late Buy 2. SEDG, gap 2019-05-07 (+15.0%, 11.4x): the day-4
reclaim at 51.76 failed the next session, best 0.0R; the whole gap was given back within weeks. PEN, gap 2026-01-15
(+11.1%, 18.2x, a 1-year volume high): the stock was already up 23.8% over 65 sessions and the day-4 reclaim at 357.70
reached 0.45R before the stop; late in a run, even the loudest gap is a poor Buy 2. The pattern across the losers: the
pullback buy fails most often when the reclaim comes early (day 4) after a very wide day-one range, when the stop sits
under a shallow pullback inside that wide gap bar, and when the stock was already extended before the gap.

## 13. Failures and near-misses (from our data)

Added 2026-11-10 from the same scan as section 12 (`ng_scan.py`, `final/hits.json`) and a near-miss scan
(`near_scan.py`, `final/near_hits.json`): the section-12 rule run again over the 2,630 liquid names with one gate relaxed
at a time, keeping only the gaps that fail exactly one of ng.gap_floor (an open 2% to 4% over the prior close), ng.volume
(1.5x to 3x), ng.gap_holds (a close in the lower half with the gap still open), ng.above_200, ng.not_late (up more than
30% over the prior 65 sessions) or ng.entry_pullback (the first pullback trigger on session 12 to 20) and pass every
other gate; day-one close proxies and pullback buys only, no hourly buys. Charts (scratch folder, not in the repo):
`final/fail_1-4.png`, `final/near_1-4.png` and `final/pair_20-episodic-pivot.png` (a News Gapper above an Episodic
Pivot, the card's first look-alike, each with its tell). Script `fail_near.py`; every number below is in
`final/fail_near.json`. Outcome as in section 12: a fixed stop, no trims, 60 sessions. [my computation]

**Four valid News Gappers that lost.** Every gate of the card passed; the house stop was hit; one per name, four years.
All four are pullback buys (Buy 2), since that is where the losses of section 12 sit.

| # | Ticker | Gap day (class) | Gap / volume / close in range / run65 | Buy (trigger) | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|---|
| 1 | AVAV | 2024-03-05 (earnings, report 2024-03-04) | +15.3% / 15.8x, a 1-year high / 79% / -3% | 162.59 on 2024-03-14 (pullback day 8, over 162.58) | 158.43 (2.6%) | 2024-03-15, day 1, best 0.0R | An 8-session pullback bought late in the window; straight to the stop without a single higher high. A big-volume gap does not protect a late Buy 2. | ng.entry_pullback |
| 2 | SEDG | 2019-05-07 (earnings, report 2019-05-06) | +15.0% / 11.4x, a 1-year high / 84% / +2% | 51.76 on 2019-05-10 (pullback day 4, over 51.75) | 50.50 (2.4%) | 2019-05-13, day 1, best 0.0R | The day-4 reclaim failed the next session and the whole gap was given back within weeks. (The card lists this trade under 2019-05-13; that is the stop day, the buy was 2019-05-10.) | ng.inv_close_under_low |
| 3 | PEN | 2026-01-15 (earnings, report 2026-01-15) | +11.1% / 18.2x, a 1-year high / 76% / +24% | 357.70 on 2026-01-21 (pullback day 4, over 356.65) | 349.07 (2.4%) | 2026-02-04, day 10, best 0.45R | Already up 23.8% over 65 sessions, near the 30% line; the reclaim made 0.45R and drifted for ten sessions before the stop, the time-stop case (ng.time_stop would have sold it at under 1R). | ng.not_late |
| 4 | GE | 2015-04-10 (news, not a report day) | +5.4% / 10.0x, a 1-year high / 90% / +7% | 133.43 on 2015-04-15 (pullback day 4, over 133.42) | 131.17 (1.7%) | 2015-04-16, day 1, best 0.0R | A day-4 reclaim after a 10x-volume gap; the stop under the shallow pullback low, inside the wide gap bar, went the next session. | ng.stop_pullback |

**Four near-misses.** Each looks like a gapper and fails exactly one gate; the would-be buy follows the section-12 entry
so the levels can be compared with the winners. No trade is implied.

| # | Ticker | Gap day (class) | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | BA | 2023-07-26 (earnings, report 2023-07-26) | ng.gap_floor | the open was 3.8% over the prior close; the rule is 4% or more (4.8x volume, close at 97%) | A strong earnings day without the gap: not a gapper, a base breakout at best. The would-be day-5 pullback buy at 239.08 was stopped, 0.0R. |
| 2 | AAPL | 2022-01-28 (earnings, report 2022-01-27) | ng.volume | 1.7x the 50-day average volume; the rule is 3x or more (+4.1% gap, close at the high of the day) | 1.7x clears the Power Earnings Gap floor (1.5x), so it is a PEG (setup 21), not a gapper; the same trade is a listed PEG failure (section 12 of that dossier). The would-be day-4 buy at 174.85 was stopped, 0.0R. |
| 3 | NFLX | 2018-10-17 (earnings, report 2018-10-16) | ng.gap_holds | closed at 35% of the day's range; the rule is the upper half. The gap held (low 35.65 above the prior close 34.64) | A faded gap day: the +9.2% open was sold to the lower third. Not a gapper and not a News Failure either (it closed green). The would-be close buy at 36.47 was stopped, 0.0R. |
| 4 | URI | 2024-01-25 (earnings, report 2024-01-24) | ng.not_late | up 42% over the prior 65 sessions; the rule is not more than about 30% (+5.5% gap on 4.0x, close at 89%) | A late gap in a stock already run up: the climax risk of 8.5. The would-be day-4 pullback buy at 648.26 was stopped, 0.0R. |

**What the failures have in common.** All four came after very loud gap days (10x to 18x volume, each the highest of
its year) and all four were pullback buys whose stop sat under a shallow pullback inside the gap bar's range; three were
stopped the next session and the fourth (PEN) drifted for ten sessions under 1R. Three of the four reclaims came on day
4, the earliest the rule allows after a two-session pullback, which repeats the section-12 reading that the early
reclaim after a very wide day-one range is where Buy 2 fails. None reached 1R, so each loss was about 1R. The near-miss
scan adds this about the gates: the 4,531 near-misses reached 3R 28.6% of the time against 29.4% for the strict rule,
and by gate, a lower-half close 28.0% (1,781 hits), 1.5x to 3x volume 27.8% (1,440), a gap of 2% to 4% 31.0% (988), a
close under the 200-day 26.4% (231), up more than 30% in 65 sessions 35.4% (79) and a pullback trigger on session 12 to
20 16.7% (12). Only the late pullback window separates clearly in this sample; the other gates define the setup more
than they predict it, which belongs in section 10 next to the volume and not-late questions. [my computation]

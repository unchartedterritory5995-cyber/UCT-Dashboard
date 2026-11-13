# Setup 05: IPO Base (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Where I could not
read a source, I say so and give no wording from it.

**How the quotes were checked.** Every quote is 40 words or fewer and copied from the page named next to it. Three kinds:
- **Checked against a saved copy** (downloaded and searched word for word): UCT's Substack (all 103 posts through
  Substack's post feed), the IBD columns syndicated on Yahoo Finance in 2014 and 2015 (read through the Internet
  Archive, because Yahoo refused the download), the two MarketSmith India articles (Internet Archive; the blog's host
  no longer resolves), the IBD press release (Internet Archive), Stockbee, the TraderLion pages (Internet Archive;
  traderlion.com refused the download), Deepvue, Alphatrends, Optuma, Google Books, the Lifecycle Trade site, the
  Donnelly interview, Jay Ritter's PDF, RePEc abstracts, and our own code.
- **Read through a page-reading tool** (the site refused a download and no archive copy exists): IBD's 2015 CBRE
  column and Bulkowski's index page. These are marked "(reader tool)". Check them against the live page before a quote
  goes into a lesson.
- **Recorded in our repo, not re-read by me**: Minervini's book quotes (from `docs/superpowers/research/bases/03-minervini-vcp-powerplay.md`,
  which read an unofficial online PDF of the book). Marked "(repo record)". (The SEC lockup quote was re-checked in the
  cold check below.)

**Cold check (2026-11-09, a second reader).** Every quote in this file was re-opened at its source and compared word for
word: the Stockbee, MarketSmith India, TraderLion, Deepvue, Alphatrends, Optuma, Google Books, Donnelly, PRWeb, RePEc and
Ritter pages were downloaded again; the two IBD Yahoo columns again through the Internet Archive; all 103 UCT Substack
posts again through Substack's post API, with each quote's section heading checked so the writer is named correctly; the
code claims against the code. All quotes held except where "Fixed in checking" at the end says otherwise. The check also
found IBD's own investors.com copies of its IPO-base columns (sections 3.3, 3.3a, 3.4a, 3.5), which the first draft
lacked.

Tags used in section 8: **[source consensus]** at least two outside sources agree; **[originator]** IBD and the O'Neil
firm (IBD columns, MarketSmith India, William O'Neil India), who named and codified the IPO base; **[source: name]** one
outside source that is not the originator (Minervini, Stockbee, Kedia, the Lifecycle Trade team, Shannon); **[UCT]** the
owner, Bracco or another UCT writer on the Substack; **[house rule]** the account rulebook, `docs/study/sizing_rule.md`
section 9; **[my proposal]** my recommendation, for the owner to accept or change.

Terms. **Listing day**: the first day the stock trades. **IPO price** (offer price): the price the underwriters sold
the shares at before trading began. **IPO open**: the first trade on the listing day. **Left-side high**: the high
where the base begins; for an IPO base it is usually the highest price since listing (UCT calls it the "IPO high").
**Pivot**: the price the stock must trade through, the top of the base. **Depth**: the fall from the left-side high
to the base's lowest low, in percent. **AVWAP**: the volume-weighted average price anchored at a chosen day; "IPO
AVWAP" is anchored at the listing day. **Lockup**: the agreement that stops insiders selling for a set time after
the IPO. **R**: the risk on the trade (entry minus stop). **LOD**: low of the day. **ORB**: opening-range breakout.
**PDH**: previous day's high. Moving averages: 10-day, 21-day (EMA), 50-day and 200-day (SMA).

---

## 1. What it is

**In two sentences.** An IPO base is the first sideways rest a newly listed stock builds under its post-listing high,
usually a few weeks after it starts trading. The buy is the break above that high, because a stock with no trading
history has no older buyers sitting above it waiting to sell.

**The market psychology, from the sources.**
- **No overhead supply.** Older stocks have holders who bought higher and sell when price returns to their cost. A new
  issue has none. IBD (2007, reproduced by Stockbee): "In an IPO, few shareholders need to be shaken out since most
  investors are brand-new holders." That is why IBD accepts a shorter base than usual: "Many stocks' successful
  initial bases have been as short as three or four weeks."
- **Who sells first.** The people allotted shares at the offer price often sell on day one. Pradeep Bonde (Stockbee,
  2010): "Let the flipping phase be over and then you can find opportunities in IPO when they breakout after forming
  a base."
- **Who is trapped.** Day-one buyers. Kathy Donnelly (Lifecycle Trade co-author, 2019): "91% of IPOs will undercut their
  Day 1 low". IBD (2015): "Many new issues tend to be quite volatile on their first few days or weeks of trading."
- **Who is buying on the breakout.** Institutions that have done their homework. The Lifecycle Trade team calls the
  quiet stretch the "Institutional Due Diligence Phase" and the breakout phase the "Institutional Advance Phase"
  (TraderLion, 2025). IBD (2014) wants "quiet action during declines and heavy volume on the upside."
- **Why it can run.** Small free float and few owners. Chhirag Kedia (TraderLion, 2025): "IPO Bases leverage the
  explosive combination of value-price gaps, limited institutional ownership, and low float".
- **Why it can fail fast.** New issues are the first to be sold in a weak tape. IBD (2007): "If the general market
  stumbles into a correction, it's often the new issues that pull back the hardest." Supply also grows when lockups
  end (Field and Hanka, 2001, section 4).

---

## 2. Origin and naming

- **Who named it.** The term "IPO base" belongs to Investor's Business Daily and the William O'Neil firm: every early
  definition I found is theirs, though I could not find the first use. IBD has used it in its Investor's Corner and
  IPO columns for many years. The oldest IBD wording I could read is an Investor's
  Corner column of 2007-07-20, reproduced by Stockbee the same day ([S4](#11-sources)). IBD's 2014 and 2015 columns
  use "IPO base" as a named pattern ([S1](#11-sources), [S2](#11-sources)). IBD's own site (investors.com, read through
  the Internet Archive) carries bylined Investor's Corner columns on it: Vincent Mao 2014-05-30 and 2015-09-21, Scott
  Stoddard 2015-12-01, Juan Carlos Arancibia 2018-03-02 ([S36](#11-sources) to [S39](#11-sources)). In 2014 IBD launched an
  "IPO Leaders" list of companies "that have gone public within the last three years" ([S7](#11-sources)). The 2015
  column also advertised an IBD home-study course called "IPO Trading Strategies".
- **O'Neil's book.** *How to Make Money in Stocks* has a contents entry on new issues (seen only in search snippets of
  the contents). I could not read the text (the Internet Archive copy is lending-only and Google Books refused the
  query). I quote nothing from it.
- **MarketSmith India / William O'Neil India** restated IBD's rules in 2018 and 2019, adding a listing-day rule and a
  rule against undercutting the IPO price ([S5](#11-sources), [S6](#11-sources)). The 2018 article is not independent:
  it is IBD's own Arancibia column ([S39](#11-sources)) nearly word for word, with the example swapped and the "10 cents"
  left out (section 3.5).
- **Mark Minervini** uses recent IPOs as one home for his "low cheat" entry in *Think & Trade Like a Champion* (2017)
  (repo record, [S9](#11-sources)). Secondary summaries say his earlier book uses "primary base" for the first buyable
  base after an IPO. I could not read that book's text, so I give no wording from it ([S10](#11-sources)).
- **Pradeep Bonde (Stockbee)** wrote about trading IPO breakouts from 2007 ([S11](#11-sources), [S12](#11-sources)). He
  calls it an "IPO breakout" and gives scan numbers.
- **The Lifecycle Trade** (Eve Boboch, Kathy Donnelly, Eric Krull, Kurt Daill; Blanca Graciela Inc., 2018-12-21) built
  a vocabulary for a new stock's life: IPO Advance Phase (IPO-AP), IPO Advance Failure (IPO-AF), Institutional Due
  Diligence Phase (I-DDP), Institutional Advance Phase (I-AP), and the "Turbulence Zone" pivot ([S15](#11-sources) to
  [S19](#11-sources)). The authors are IBD meetup alumni and appear often on IBD Live.
- **Brian Shannon** (Alphatrends), known for anchored VWAP, treats the AVWAP from the IPO day as a key reference level
  ([S20](#11-sources), [S21](#11-sources)).
- **Other names in use.** "First base" (IBD 2007), "IPO breakout" (Stockbee; Bracco), "IPO pivot" (UCT's Beebe; MSI's
  "standard pivot"), "new issue base", "IPO flag" and "J-Curve" (Kedia, for very short ones), "IPO high", "IPO open"
  and "IPO AVWAP" (UCT, as levels), "U&R" (undercut and rally) of a base low or the IPO open (UCT).
- **Not found.** No IPO-base definition at qullamaggie.com (all posts read), nor in web searches for Oliver Kell,
  Stan Weinstein's book, or Morales and Kacher, or on Bulkowski's thepatternsite.com (no IPO pattern in its
  index). Stockbee posted an image titled "Jesse Livermore IPO b/o setup" (2011-12-01) whose only text is "What more do
  you need. A complete setup idea for trading IPO's"; I could not read any Livermore wording, so none is claimed.

---

## 3. Every definition, source by source

### 3.1 IBD, Investor's Corner, 2007-07-20 (as reproduced by Stockbee) [S4]

- Length: "A base pattern needs at least several weeks to develop, but new issues sometimes form short bases that lead
  to prodigious results." And: "Many stocks' successful initial bases have been as short as three or four weeks."
- When to buy: "Let the stock develop some degree of trading history and wait for it to form its first base. Just be
  aware that first base could be pretty short."
- Why the short base is allowed: "In an IPO, few shareholders need to be shaken out since most investors are
  brand-new holders."
- Market: "If the general market stumbles into a correction, it's often the new issues that pull back the hardest."
- Stockbee's summary of the same column adds: "Look for IPO's with outstanding earnings and sales".
- No depth, volume, stop or buy-point numbers.

### 3.2 IBD, "MasterCard's IPO Base In '06 Sparked A 'Priceless' Uptrend", 2014-06-05 [S2]

- Prior trend: "For starters, avoid buying a new issue right after it has already made a massive price run."
- Length: "Normally, a proper base takes a minimum of five weeks to form. An IPO base can form in as little as three
  weeks, and on very rare occasions less."
- Volume and character: "Yet you still want to see a base form well, with quiet action during declines and heavy
  volume on the upside."
- Example: "Its stock cleared a shallow, cup-shaped base and a 50.73 buy point during the week ended Aug. 4. Weekly
  volume rose sharply from the prior week." (2006.)
- Hold: "Not once did it seriously threaten a break below its 10-week moving average."
- Why: "Remember, stocks tend to make their biggest moves in the early stages of being a public company."
- Fundamentals: "Investors should also avoid overly speculative IPOs." And: "You'll need great fundamentals to back up the
  story."

### 3.3 IBD, "IPO Bases Are Unconventional, But They Can Lead To Big Gains", 2015-09-21 [S1]

The fullest IBD definition I could read.
- Wait: "But it's often prudent to wait for new issues to form an IPO base first."
- Length: "IPO bases can be shorter. They usually run two to five weeks." And: "In rare instances, IPO bases can be as
  short as seven days." Fitbit had "an ultrashort IPO base of only five days." Google (2004) "had an IPO base that
  spanned 15 trading days."
- Depth: "Most of the time they tend to correct less than 20%." And: "In times of volatility, corrections in IPO bases
  can be as deep as 50% from the stock's price high."
- Timing after listing: "New issues tend to carve out a left-side high within the first 25 days of trading."
- Shape: "IPO bases can appear as consolidations, but they can turn out to be more common patterns such as cups, cup
  with handles, and flat bases."
- Trigger: "The buy point in an IPO base is the same as in most regular bases, which is 10 cents above the high on the
  left side of the base."
- Earlier entries: "But a handle can offer a lower entry. Other alternative buy points use trend lines. Or a smaller
  consolidation within a bigger one may produce a lower entry point."
- Volume: "While IBD suggests that volume should be at least 40% above the 50-day average on a breakout, many new issues
  have yet to trade that long. So you can see how volume is doing compared with recent sessions."
- Example: Concho Resources (2007): "The stock wavered to a high of 13.49 on Aug. 14, then consolidated for 13 sessions.
  The action formed a tight IPO base with a 13.59 buy point. The stock corrected less than 8%."
- No stop or sell rule in this column.
- Author: Yahoo names none. IBD's own copy of the same text (investors.com, "IPO Bases Can Be Brief But Profitable",
  2015-09-21) names Vincent Mao [S36].

### 3.3a IBD, Vincent Mao, "Google's IPO Base Brought About Big Gains", 2014-05-30 [S37]

Read on investors.com through the Internet Archive (copy of 2021-02-20).
- Length: "Unlike other patterns, which are at least five or six weeks in length, IPO bases can be as short at nine or 10
  days." (The "short at" is IBD's typo.)
- Volume in the base: "Volume should be light during pullbacks and heavy during the stock's upside."
- Example (Google, 2004; IPO high on the third day, 113.48): "The stock consolidated gains for the next 15 sessions and
  corrected lightly in the process, down just 13%." The buy point was 113.58; the breakout came Sept. 15.
- Breakout volume: "So there is a judgment call when it comes to what is heavy volume." And: "In Google's case, turnover
  that day was one of the heaviest in three weeks."

### 3.4 IBD, "CBRE Soared From IPO Base, But Investors Needed Patience", 2015-04-21 [S3] (reader tool)

- "The buy point was at 20.10, or 10 cents above the left-side high of a three-week base that featured tight trading,
  with weekly ranges of less than 10%." (The reader tool confirmed the comma after "trading" that the first draft had
  dropped.)
- "But usually it pays to wait a bit, because most stocks retreat after an initial post-IPO spike."
- Timing, short fragments confirmed by the reader tool: CBRE "went public on June 10, 2004", "began forming an IPO base
  in early August" and "cleared the buy point Sept. 3 in heavy volume". So this base began about eight weeks after
  listing. No byline; no stop or sell rule.

### 3.4a IBD, Scott Stoddard, "Buying IPO Stocks Can Be Tricky, So Do Your Homework", 2015-12-01 [S38]

Read on investors.com through the Internet Archive (copy of 2016-03-05).
- A failure from the originator: Habit Restaurants "cleared a 40.35 IPO-base buy point on Dec. 11, 2014, hitting a high
  of 44.20. But the stock plunged 16% the following week, erasing the 10% gain to set off a round-trip sell signal."
- A winner: Inphi (listed 2010-11-11 at $11) "cleared a 16.68 buy point of a narrow 11-day IPO base".
- Volume yardstick: the weekly chart showed it "breaking out of its IPO base in volume that was well above the average of
  the prior three weeks, excluding the spike in turnover that occurred in its IPO week."

### 3.5 MarketSmith India, "How To Trade: IPO Bases Are Unusual But Can Result In Rich Gains", 2018-08-06 [S5]

MarketSmith India is the O'Neil firm's Indian arm. This column is IBD's own Investor's Corner column of the same title
(Juan Carlos Arancibia, investors.com, page dated 2018-03-02 [S39]) nearly word for word: the ServiceNow example became
Avenue Supermarts, IBD's rating and tool names became MarketSmith India's, and IBD's "the buy point is drawn by
taking the prior high and adding 10 cents" lost its last four words. Count it with IBD, not as a second voice. IBD's
version also says: "Also, the stock should generally form the base above its IPO price." And its ServiceNow base (2012)
fell 14% over 17 days.
- Depth and length: "The decline from peak to low usually doesn’t top 20%, but most volatile markets have produced
  declines of up to 50%. The length is often less than five weeks and can be as short as seven days."
- Timing: "In an IPO base, the pattern typically starts within 25 days of the stock’s first day of trading."
- Pivot: "the buy point is drawn by taking the prior high."
- Breakout day: "Important factors include seeing a shallow correction within the base during normal market conditions,
  a large increase in price and a close near session highs on the breakout day and heavy volume on the breakout day
  and week."
- IPO price: "Also, the stock should generally form the base above its IPO price."
- Wait: "It is best to pass on the first heated days of trading and wait for the base to emerge."

### 3.6 MarketSmith India (William O'Neil India), "Missed IPO is Not a Missed Opportunity", 2019-10-21 [S6]

The only O'Neil-family source here with a listing-day rule and a stop.
- Don't buy early: "We advise investors not to buy a company’s shares on the day or during the week of its listing."
- Prior move: "Firstly, there should be a massive gain as the stock goes public and before it runs down after hitting
  resistance."
- Shape: "A classic IPO base is a short and shallow area of consolidation that occurs right after a company’s IPO."
- Depth: "The decline from a peak to low usually doesn’t top 20%, but after a good gain on a listing day, the more
  volatile markets can have a decline of up to 50%."
- Length: "The length of a base is often less than five weeks and can be as short as seven days."
- Listing day: "On a listing day, the closing should be in the upper half of the day’s range."
- IPO price: "During base formation, the stock price should not undercut the IPO price."
- Timing: "In an IPO base, the pattern should typically start within 25 days of the stock’s first day of trading."
- Pivot: "The standard pivot (entry point) is at the highest point on the left side from where a base pattern started to
  form."
- Volume: "At breakout, the volume should be very high, and accumulation should be good just before a breakout (on the
  right side of the base)." And: "the volume of the first two-three days generally tends to be very high and should not
  be set as a benchmark."
- Group: "Ideally, we prefer stocks among the top 40 industry group rank." (Of 164 Indian groups.)
- After the breakout: "Ideally, after the breakout, we would not like to see a stock breach the pivot price and go back
  to the base."
- Stop: "Exit the position at a maximum loss of 8%."

### 3.7 Mark Minervini, *Think & Trade Like a Champion* (2017), section "THE 'LOW CHEAT'" [S9] (repo record)

- Universe: "I like to use the low cheat for larger cap names, and in some cases new issues that recently went public."
- IPO price and depth: "The low cheat can work for IPOs that don't spend much time trading below their IPO price and
  don't correct too excessively. It's best if the stock holds above the IPO price."
- Length: "The basing period after the IPO should be at least 10 days."
- Examples: Google "formed a low cheat over in 14 days"; "The Twitter base formed in 19 days."
- Entry: the low cheat sits in the lower third of the base, confirmed by "some inside days on very low volume".
- Not verified: the "primary base" wording attributed to *Trade Like a Stock Market Wizard* (2013) by secondary
  summaries, and a "Mark Minervini Quotes" account on X quoting him on IPO bases. Neither is his own page. Not used.

### 3.8 Pradeep Bonde (Stockbee) [S11, S12, S13]

"How to trade IPO's", 2007-07-19:
- Universe: no age limit is stated as a rule. His context: "25% of the stocks in Double Trouble universe have IPOed in
  last 2 years", and his list heading "IPO's in last 2 years up over 100% or more from low price".
- Filters, in his words: "IPO's with good earnings or sales growth. This is number one criteria to look for."; "IPO's
  which IPO during market weakness. They really do well."; "IPO's which do not go down more than 35% below first day
  trading close"; "IPO's with spin offs".
- Trigger: "The best way to trade IPO is by just running a simple 4% plus breakout scans." The scan:
  `(100*(c-c1)/c1)>=4 and v>=1000 and v>v1`.

"How to find profitable IPO trading opportunities using Telechart", 2010-08-23 (he lists seven guidelines "in order of
importance"):
- Universe: "These are stocks which have IPOed in last one year."
- Volume: "You want to see 2to3 times or more volume than average 10 days volume for the IPO." And: "For IPO with less
  than 10 day trading history you want to see a highest volume or second highest volume day since IPO launch on
  breakout day."
- Base: "A 5 to 10 days sideways move prior to breakout day." In a reply on the same page (2010-10-11): "10 to 20 days
  sideways move or pullback before breakout is what i look for."
- Orderliness: "Stocks should not have 2 or more 4% =ve or -ve breakouts in last 5 days prior to breakout day."
- Linearity (his fractal-efficiency scan) above +0.30.
- Catalyst: "IPO's with clearly defined catalyst like earnings, or new product or some other catalyst tend to do well."
- Fundamentals and group: "I always look for an IPO with 100% plus EPS or sales growth." And IPOs "from Top 20 ranked
  sector by momentum tend to do very well."
- Market: "As a side note IPO tend to do well at start of a new bull move."
- Shorts: "IPO's also offer opportunities on short side." But: "One of the problems for trading IPO on short side is
  liquidity." His short candidates are "Concept IPO's", not failed bases: "Concept IPO's often are good short selling
  opportunity."

"Why you should not rush to buy a IPO on first day", 2010-11-24: "Wait for an IPO to setup after debut. Let the
flipping phase be over and then you can find opportunities in IPO when they breakout after forming a base."

### 3.9 The Lifecycle Trade team (Boboch, Donnelly, Krull, Daill) [S15 to S19]

I could not read the book. What I could read:
- Jack Schwager's blurb on the book's Google Books page quotes two findings: "1. 20% of IPOs gain 100% or more within
  their first year." and "2. Over 90% of IPOs eventually trade below their first day low."
- Kathy Donnelly, interview, 2019-05-05: "Don’t buy on Day 1. 91% of IPOs will undercut their Day 1 low". She describes
  "a three-year study of initial public offerings (IPOs)".
- TraderLion's 2025 summary of their framework (unsigned TraderLion staff article): the IPO Advance Phase "can last a
  few days to several weeks, depending on market conditions and company news." The Due Diligence Phase: "This phase may
  last months or even years." Its advice for that phase: "Sit on your hands: This is mostly a no-trade zone." For the
  first phase: "Use tight stops: Protect your capital." And: "Be cautious of the IPO lock-up period". On the market:
  "Near the end of a prolonged uptrend, however, be wary when too many companies rush in to go public at once."
- Deepvue's 2025 article, written with the team's screens: "This first rally generally lasts under twenty weeks and can
  see gains of over 100%." The later pivot: "This Turbulence Zone acts as a traditional pivot point with the strongest
  stocks breaking out into new highs." Screens credited to the authors: Donnelly "only show stocks trading over $100M
  in daily dollar volume"; Boboch "at least 35% quarter-over-quarter growth in both earnings and sales"; Krull "stocks
  trading above their 21-day exponential moving average". Deepvue's own general tips, not credited to any author:
  "Relative Strength Rating above 85 identifies IPOs outperforming most of the market." And: "The highest volume since IPO
  may signal a breakout or accumulation phase." Its basic screen asks for "at least $20M in daily dollar volume". (The
  page shows "Last Updated: May 12, 2025", not a first-publish date.)
- Note: this school's best trade is often NOT the very first base. It is the breakout past the "Turbulence Zone" after
  the due-diligence stretch, months or years after listing.

### 3.10 Brian Shannon (Alphatrends) [S20, S21]

- Show notes, 2025-06-30, under the heading "IPOs: Anchored VWAP Strategy in Action": "Big early rally → shakeout below
  VWAP → new move begins when price retakes VWAP." And: "Wait for consolidation, then buy at the first higher low above
  VWAP." The notes do not name the anchor; reading it as the IPO-day AVWAP is an inference from the heading and from
  Optuma below. Stops, from the same notes: "Always set stops under recent lows."
- Optuma, paraphrasing his book: "As Brian writes in his book, the AVWAP from a stock’s IPO date can be an important
  level to keep on your chart."
- No depth or length numbers.

### 3.11 Chhirag Kedia, "IPO Bases – A Comprehensive Study", TraderLion, 2025-03-08 [S22]

A practitioner in the Indian market. He says his study is "primarily based on the rules of Mike Webster & the legendary
late William J. O’Neil." (Mike Webster appears on IBD Live beside IBD's editors, per the Lifecycle Trade site's media
list.) Examples are Indian stocks.
- "Timing: Any consolidation forming within the first five weeks of listing qualifies as an IPO base." And on first
  versus later bases: "A stock can form multiple IPO bases, collectively considered part of the IPO base family."
- "Depth: The base depth generally ranges from 20% to 30%, but in extreme cases, it can reach up to 50%."
- "Duration: IPO bases typically last up to five weeks (though, in my experience, they can extend to six to nine months
  as well)."
- Failure shape: "However, when a base is significantly deep and approaches its left-side high with time compression,
  it tends to have a very high failure rate."
- Entries: the left-side high, tight "cheat" areas inside the base, and "PDH & ORB Techniques: Using price action from
  previous days or opening range breakouts to time entries more precisely."
- Spin-offs: "Demerged entities often behave similarly to new IPO stocks when forming an IPO Base:"
- Depth classes in his own scheme: shallow bases 15% to 20% deep, deep bases 30% to 35% deep.
- Stops: no fixed number; he prefers tight areas that give "a well-defined stop-loss zone" (one example: a 4.5% stop).
- Theme: "Pay special attention to newly listed stocks in trending or futuristic themes, as they often produce
  mesmerizing moves from IPO bases".
- Below the issue price, against MarketSmith India: "Mispriced listings, where stocks either don’t see much demand or list
  negatively due to market conditions, offer an extremely unique opportunity to profit through IPO base formations".
- No measured statistics; every claim is shown by example.

### 3.12 Other educators

- TraderLion (staff, 2025-06-11): "Some of the best growth stocks make their biggest moves within the first 10 years
  after going public."
- TraderLion (Nick Schmidt, 2024-10-02), on O'Neil's rule our playbook cites: "The rule advises holding a stock for
  eight weeks if it gains over 20% within three weeks of buying."
- TradingView user JS_TechTrading (2022-11-10) repeats the IBD and MarketSmith India rules nearly word for word without
  credit (reader tool). Not used as a source.

### 3.13 The criteria side by side

| Source | When after listing | Length | Depth | Volume | Pivot / entry | IPO price | Stop | Other |
|---|---|---|---|---|---|---|---|---|
| IBD 2007 [S4] | first base | 3 to 4 weeks can work | none | none | none | none | none | earnings and sales |
| IBD 2014 [S2] | early stage | 3 weeks min., rarely less | "shallow" (example) | heavy up, quiet down | buy point (example) | none | none | no massive prior run |
| IBD 2015 [S1] | left-side high in first 25 days | usually 2 to 5 weeks; rare 7 days | usually under 20%; up to 50% | 40% over 50-day avg, or vs recent sessions | left-side high + $0.10; handle, trend line, inner base | none | none | shapes: consolidation, cup, CWH, flat |
| IBD 2014 Google [S37] | after the first days | as short as 9 or 10 days; Google 15 sessions | Google 13% | light on pullbacks, heavy up; breakout "a judgment call" | left-side high + $0.10 | none | none | none |
| IBD 2015 CBRE [S3] | base began about 8 weeks after listing | 3 weeks | weekly ranges under 10% | heavy | + $0.10 | none | none | wait after the IPO spike |
| IBD 2015 Inphi [S38] | breakout about 4 weeks after listing | 11 days | none | above the prior 3 weeks, IPO week left out | buy point | none | none | a round trip of a 10% gain is a sell signal (Habit) |
| IBD 2018 [S39] | starts within 25 days | under 5 weeks; as short as 7 days | usually under 20%; up to 50% | heavy on day and week | prior high + $0.10 | base above IPO price, "generally" | none | close near high on breakout |
| MSI 2018 [S5] (copy of IBD 2018) | starts within 25 days | under 5 weeks; as short as 7 days | usually under 20%; up to 50% | heavy on day and week | prior high | base above IPO price | none | close near high on breakout |
| MSI 2019 [S6] | starts within 25 days; not in listing week | under 5 weeks; as short as 7 days | usually under 20%; up to 50% | very high; right-side accumulation; ignore days 1 to 3 | highest left-side point | never undercut | 8% max | listing close in upper half; top 40 group |
| Minervini [S9] | recent IPO | at least 10 days | "don't correct too excessively" | inside days on very low volume | low cheat, lower third | hold above it | none given here | larger caps |
| Stockbee 2007 [S11] | not stated as a rule | none | not more than 35% below day-1 close | V > V1 | 4% up day | none | none | growth, top underwriters, spin-offs |
| Stockbee 2010 [S12] | within 1 year | 5 to 10 days (reply: 10 to 20) | none | 2 to 3x the 10-day average; or top-2 since listing | 4% breakout | none | none | no two 4% days in prior 5; 100% growth; top 20 sector |
| Lifecycle team [S15-S19] | first base often is not the best; the I-AP breakout comes months or years later | IPO-AP: under 20 weeks | none | (Deepvue's own tip: highest volume since IPO is a clue) | Turbulence Zone (prior highs) | none | tight stops in IPO-AP | $100M a day (Donnelly); above 21-day EMA (Krull); 35% QoQ growth (Boboch); Deepvue's own tips: $20M+, RS 85+ |
| Shannon [S20] | after the early rally and shakeout | none | none | none | first higher low above VWAP (anchor not named) | none | under recent lows | AVWAP from IPO day (Optuma's paraphrase) |
| Kedia [S22] | first 5 weeks; later IPO bases count too | up to 5 weeks; can be 6 to 9 months | 20% to 30%; up to 50% | none | left-side high; cheat areas; PDH; ORB | listing below issue price can be an opportunity | below a tight area (example 4.5%) | V-shape into pivot fails; themes |
| Our playbook (AI-authored, section 5) | first 3 to 12 months | a few weeks | 25% to 50% | expanding | base high + buffer; PDH; U&R | hold well above | BO-day low or tight area | trim 20% to 25%; 8-week hold |
| Our detector (experimental) | base top within 252 bars; as-of within 320 | at least 15 bars | at most 35% | none | highest high since listing | none | none | $2 and $10k/day floor |
| UCT (section 6) | "first year or so" | days to weeks | none stated | breakout on volume | IPO highs; hourly flag; ORB; U&R; LOD stop | IPO open, IPO-day close as levels | LOD | IPO AVWAP; theme; spin-offs count |

### 3.14 Where they disagree

1. **How soon after listing.** IBD and MarketSmith India: the left-side high within the first 25 trading days (yet IBD's
   own CBRE base began about eight weeks after listing). Kedia: the first five weeks, though "A stock can form multiple
   IPO bases". Stockbee: listed within one year (2010); his 2007 post states no limit. UCT (the owner): "within the first
   year or so". Our detector: base top within 252 bars. The Lifecycle team: the best breakout is often months or years
   later.
2. **Minimum length.** IBD does not agree with itself: "usually run two to five weeks" and "as short as seven days" in
   rare cases, Fitbit five days (2015); "as short at nine or 10 days" (2014, Google); "as little as three weeks" (2014,
   MasterCard); Inphi's 11-day base (2015). Minervini: 10 days. Stockbee: 5 to 10 days (2010), 10 to 20 (his reply). Our
   detector: 15 bars.
3. **Depth.** IBD and MSI: usually under 20%, up to 50% in volatile markets. Kedia: 20% to 30%, up to 50%. Our
   detector: 35% cap. Our playbook: 25% to 50%. Stockbee measures a different thing: not more than 35% below the
   listing-day close.
4. **Buy point.** IBD: 10 cents above the left-side high (2015, 2014 and its 2018 column). MSI: the high itself (its
   2018 copy of IBD's column dropped the 10 cents). Minervini and Kedia: earlier cheat entries inside the base. Shannon:
   the first higher low above VWAP. UCT: the break of the IPO high, an hourly flag, an ORB or a U&R.
5. **Volume test.** IBD: 40% over the 50-day average, or vs recent sessions, "a judgment call" (2014); the 2015 Inphi
   column compares with the prior three weeks, leaving out the IPO week. Stockbee: 2 to 3 times the 10-day average.
   MSI: ignore days 1 to 3. Our detector: no volume test at all.
6. **IPO price.** MSI and Minervini want the base above the IPO price; IBD's 2018 column says "generally". Kedia calls
   a listing below the issue price ("Mispriced listings") an opportunity. Stockbee anchors on the listing-day close
   instead. UCT watches the IPO open and the IPO-day close as levels, and the owner once wrote "the IPO price right at
   $100" of TTAN, whose offer price was $71 and whose first trade was $101 [S40]: in his usage "IPO price" can mean the
   first trade. No source defines what to do when only the first trade, not the offer price, is known.
7. **Stop.** MSI: 8% maximum. TraderLion: tight stops in the first phase. Kedia: under a tight area (4.5% in one
   example). Shannon: under recent lows. Our playbook: the breakout-day low or the last tight area. UCT: the low of the
   day. No originator ties the stop to the IPO structure.
8. **Selling.** Our playbook: trim into 20% to 25% and use O'Neil's 8-week hold. The house: thirds at 3R and 5R, trail
   the rest (section 7). TraderLion: take profits quickly in the first phase. IBD (2015, Habit): a breakout that gives
   back a 10% gain sets off "a round-trip sell signal".
9. **Lockups.** TraderLion: be cautious. Our curriculum plan: a mandatory pre-entry check. Bracco: a lockup expiry with
   negative sentiment can be a contrarian buy. The owner: no special rule for new listings (E53).

---

## 4. Measured evidence

**No published success rate for IPO-base breakouts exists in anything I could read.** What exists is about IPOs in
general, lockups, and a few claims without method.

1. **Long-run IPO returns (Jay Ritter, University of Florida, "Initial Public Offerings: Updated Long-run Statistics",
   PDF dated 2026-10-05)** [S28].
   - Table 20: "These tables show that IPOs have underperformed other firms of the same size (market cap) by an average
     of 3.6% per year during the five years after issuing, not including the first-day return." In Table 20-1
     (9,254 IPOs, 1980 to 2024), the second six months after listing returned -0.0% for IPO firms against 5.5% for
     size-matched firms; the first year 5.6% against 11.4%.
   - Table 16e (9,195 IPOs, 1975 to 2021, three-year buy-and-hold from the first close): average 21.2%, median -25.7%.
     38.5% of IPOs lost more than half. By my sum of the table's rows, 1,473 of 9,195 (16.0%) more than doubled.
   - Table 16a (9,253 IPOs, 1980 to 2024): the average three-year buy-and-hold return from the first close was 19.1%,
     -20.5% market-adjusted (the table's note gives the market's 39.6%). Split by pre-IPO sales, firms under $1 billion
     returned 17.8% (-22.4% market-adjusted) and firms with $1 billion and up returned 32.4% (-2.1%). Bigger, established
     issuers did far better, which fits Minervini's "larger cap" preference and Donnelly's liquidity screen.
   - Table 15c: 625 de-SPACs (2012 to 2024) averaged -51.2% in their first year against 7.9% for the market.
   - How: CRSP data; offer price $5 or more; excludes ADRs, REITs, unit offers and others; returns from the first
     close. Limits: these are all IPOs, bought and held. They say nothing about the subset that builds a clean base and
     breaks out. They do show the base rate is poor, which is why the setup's filters matter.
2. **The new issues puzzle (Loughran and Ritter, Journal of Finance, 1995)** [S29]: "During the five years after the
   issue, investors have received average returns of only 5 percent per year for companies going public and only 7
   percent per year for companies conducting a seasoned equity offer." Sample: 1970 to 1990. Same limit as above.
3. **Lockup expiry (Field and Hanka, Journal of Finance, 2001)** [S30]: 1,948 lockups, "typically 180 days". "When
   lockups expire, we find a permanent 40 percent increase in average trading volume, and a statistically prominent
   three‐day abnormal return of −1.5 percent." Larger for venture-backed firms. Limits: an average around the date; it
   does not say a breakout near the date fails.
4. **The Lifecycle Trade team (book, 2018; Donnelly interview, 2019)** [S15, S17]: 20% of IPOs gained 100% or more in
   their first year; over 90% (Donnelly: 91%) later traded below their first-day low. Who: the four authors, "a
   three-year study". Limits: I could not read the book, so I do not know the sample, the years or the definitions.
5. **MarketSmith India (2019)** [S6]: "From our study of different base patterns like cup-with-handle, double bottom,
   flat base, etc., we found that the highest success rate is of an IPO base." No numbers, sample or method are given.
   Treat as a claim.
6. **Assertions without numbers.** IBD (2014): biggest moves come "in the early stages of being a public company". IBD
   press release (2014): "the market’s biggest winners tend to be newer companies". TraderLion and Deepvue: the biggest
   moves come within the first 10 years. Stockbee: IPOs do well "at start of a new bull move". None gives a measurement.
7. **Our own lab.** `shape_draw.py` records that the round-3 IPO-base drawing was judged "2.77 on 17 held-out cases,
   100% >= 2, too few cases to pass a 2 x 25 packet". That grades the drawing, not the trade. No forward-return study of
   IPO bases exists in our repo. The Study bank holds only 4 IPO-base items, all recall questions in `draft` built from
   the AI-written Model Book playbook (`docs/study/bank/recall.playbooks.json`, skill `setup.family1.ipo_base`); the
   unit plan is `docs/study/UNITS-method.md`, SET.10 (no detector, no rubric, 0 fixtures).

**What would settle it.** A measurement on our own bars: every first base after listing that meets the section 8 rules,
its breakout, and 3R/5R outcomes under the house stop. That needs a trusted listing date (section 5.1) and is a later
task, not done here.

---

## 5. Our app

### 5.1 The scanner that exists (the task said "none known")

There is no IPO-base detector in `api/services/pattern_engine/detectors/`. There is an **experimental, admin-only**
structure and drawing:

- `api/services/screener/base_catalog.py`, `IPO_BASE` (lines 5585 to 5740), state `ipo_base_state` (line 5617). The
  rule, faithfully:
  - The listing date is the first stored bar of the series (comment: "THE LISTING DATE IS THE FIRST BAR WE HOLD").
  - The as-of bar is at most 320 bars after the listing (`IPO_MAX_AGE_BARS`).
  - Liquidity: `liquidity_floor` (line 5638), whose defaults are price at least $2.00 and a 20-bar average dollar
    volume of at least $10,000 (`pattern_engine/primitives/liquidity.py`, lines 54 and 55).
  - The base top is the highest high since listing, and it must come within 252 bars of the listing
    (`IPO_MAX_START_BARS`).
  - The base runs from that top to the as-of bar and is at least 15 bars long (`IPO_MIN_BARS`, "three weeks").
  - No close above the top before the as-of bar. The as-of close may be up to 5% above the top (`IPO_BUY_ZONE =
    IBD_BUY_ZONE`, 0.05), "a breakout in progress".
  - Depth from the top to the lowest low at most 35% (`IPO_MAX_DEPTH`).
  - The pivot is the top. No volume, IPO-price, market, group, RS or earnings test.
  - Its card: "The first base a newly listed stock builds: a consolidation of at least three weeks under its
    post-listing high, within about a year of the listing. Experimental -- not measured, not served to members."
- `api/services/pattern_engine/shape_draw.py`, `ipo_base_drawing` (line 416). Round 1 adds: no one-bar spike as the
  pivot, and the last close must be back at least halfway up the base (`IPO_RIGHT_SHARE = 0.5`). Round 3 (the admin
  preview) also withholds: a store backfill date taken for a listing (5 or more tickers sharing the first date), depth
  under 8%, more than 2 missing sessions, more than 5% flat or zero-volume bars, median dollar volume under $1,000,000
  over the base, a top more than one median true range above every other high, and a base that follows an earlier base
  (a stretch of 15+ bars that pulled back 10%+ from a high before the top).
- `api/services/auto_structures.py`: `MEMBER_IPO_BASE_ROUND = None` (line 784), so members never see it. The IPO base
  is attempted only when the store holds fewer than 600 bars for the ticker.
- `api/services/rare_preview.py`: the admin page where the owner can approve or reject live IPO-base drawings. Release
  rule: at least 12 approvals at an 80% approve rate, then a hand commit. Both flags are dark
  (`docs/feature_flags.json`, `AUTO_STRUCTURES_SHAPES_ENABLED`, `AUTO_STRUCTURES_RARE_PREVIEW_ENABLED`).
- The rare preview labels the buy point as the ceiling bar's high plus $0.10 (feature flag note;
  `auto_structures.rare_preview_drawings` via `textbook_numbers.buy_point`), which matches IBD.
- A live list scan, not a base detector, that the first draft missed: **"IPO in Last 1-Year"**
  (`api/services/scan_ipo.py`, route `/api/scans/ipo-1y`, paid; preset in `app/src/pages/charts/widgets/presetScans.js`,
  "First traded within the last year"). Its "IPO date" is the first daily bar in our store, overlaid with the vendor
  `list_date` for names we do not chart and with re-listed recycled tickers; ETFs are dropped. Its floor is "Price Above
  $1" and "Over $1M Average Daily Dollar Volume" (`scan_volume._tradable`), far below B23. It is the natural place to
  find IPO-base candidates, but it tests no base.

**Two listing dates already exist, and the detector uses neither.** The code says "There is no IPO-date field anywhere".
That is out of date:
- The screener snapshot carries `ipo_date` and `ipo_age_days` from the profile bulk (`screener/snapshot_builder.py`,
  around line 765; `screener/filters.py`, line 406).
- `api/services/ticker_ipo.py` serves `list_date` (Massive/Polygon) and a corroborated `first_trade_date`. The chart's
  gold "IPO" first-bar badge matches `list_date` (within 5 calendar days on daily); `first_trade_date` feeds the chart
  engine's listing seed (`app/src/components/StockChart.jsx`, `listingSeed.js`), not the badge.
- I did not audit either for spin-offs, uplistings or de-SPACs, where a vendor date can mean something else.

### 5.2 The Model Book card and playbook

- Card (`app/src/pages/modelbook/setupCatalog.js`, line 70): family "Bases & Breakouts", long. Essence: "A new issue’s
  first consolidation" that is "short, often shallow, and explosive when it resolves higher." The glyph's pivot is the
  fifth candle's high.
- Playbook (`app/src/pages/modelbook/setupPlaybooks.js`, lines 122 to 184). **Provenance: Claude wrote it.** Commit
  291af0c34c (2026-06-12) says the IPO Base was a "full 6-section dossier authored", while the same commit says the
  Launchpad was "transcribed from the firm's doc". So the IPO Base playbook is not the owner's words. Its content, in short:
  market in a confirmed uptrend with appetite for new issues; the first base typically within the first 3 to 12
  months (line 140); shorter and deeper, 25% to 50%, than a classic base (line 142);
  pivot is the range high; "price should hold well above the IPO price"; entry over the base high "+ a small buffer on
  expanding volume", or a prior-day-high break riding the 10/20-day SMA, or a U&R near the base low; stop under the
  breakout-day low or the last tight area, or the 10/20-day SMA; trim into a 20% to 25% gain and use the 8-week hold;
  trail the 10/20-day and the 50-day; "the sensible share count is smaller".
- Journal tag: `'IPO Base'` in the Swing group (`app/src/constants/setupGroups.js`, line 10). Also in the desk
  insights taxonomy (`api/services/desk_session_insights.py`, line 417).
- Course plan (`docs/curriculum/uct_method_scripts.json`, M7.L6, committed by Claude in 2ba1d76435): "shorter base
  tolerance, wider ADR allowance, and smaller position size", a lock-up check as "a mandatory pre-entry step", and an ARM 2023-2024 example
  with prices I did not verify.

### 5.3 Where our app disagrees with the sources or looks wrong

1. **The card and the playbook contradict each other.** The card says "often shallow". The playbook says deeper than a
   classic base, 25% to 50%. IBD says usually under 20%. The card matches IBD; the playbook does not.
2. **The playbook's 3 to 12 months has no source.** IBD and MSI say the base starts within 25 days. UCT says "the
   first year or so". No source I read says 3 to 12 months.
3. **The playbook's smaller share count, and the course plan's "smaller position size" and "mandatory" lock-up step,
   conflict with the owner's E53** ("No rule for new listings (IPOs)") and with D38/E49 (size comes from the grade).
4. **The playbook's exits conflict with the house rules.** A 20% to 25% trim and an 8-week hold are O'Neil's, not the
   house's thirds at 3R and 5R (B19, E51).
5. **Detector liquidity is far below the house floor.** $2 and $10,000 a day (round 3: $1,000,000 median) against B23's
   $10 and $20 million a day.
6. **Detector buy zone is 5%; the house chase limit is 4%** (C28).
7. **No volume test.** IBD, MarketSmith India and Stockbee all have one.
8. **No IPO-price test.** MSI and Minervini both use one. The first bar's open (the IPO open) is in our bars; the offer
   price is not (the IPO calendar holds only a price range for upcoming deals, `api/services/ipo_calendar.py`).
9. **15-bar minimum excludes IBD's own examples** (Concho 13 sessions, Inphi 11 days, Google 15 trading days at the
   edge, Fitbit 5; IBD 2014: "as short at nine or 10 days") and Minervini's 10-day floor.
10. **Round 1 can draw a later base.** Only round 3 checks for an earlier base.
11. **Unsourced attributions in other detectors.** `classical/rounded_base.py` (around line 494) and
    `structure/accumulation_distribution.py` (around lines 396 and 681) say Mark Ritchie II has a "post-IPO playbook"
    using rounded bases and A/D scoring. I found no source for this. Treat it as unverified and keep it out of lessons.
12. **Our research catalogue mis-cites Stockbee.** `docs/superpowers/research/setups/setup_criteria.json` (line 159,
    `ipo.drawdown.filter`) gives the "35% below first day trading close" rule the source key `stockbee_ipo`, whose URL in
    `setup_sources.json` is the 2010 post; the sentence is only in the 2007 post ("How to trade IPO's").
13. **The journal's grade list** (`setupGroups.js`, line 31: A+, A, B, C, F) does not match the house grades (A+, A, B,
    B-; D38, E49). Not IPO-specific, noted in passing.
14. **The Study bank's 4 draft IPO-base recall items teach the AI-written playbook** (its "3–12 months" and "Trim into a
    20–25% gain" lines appear in their reveal text, `docs/study/bank/recall.playbooks.json`). None is approved; they
    should wait for the owner's rules.
15. **The "Recent IPOs & Spinoffs" theme's hand-typed dates** (`ipo_maintenance.py`, `IPO_DATES`) include month
    placeholders (see the note at the end of section 11), so any age test built on them would be wrong.

---

## 6. UCT's own words

All from UCT's public Substack (https://unchartedterritoryy.substack.com). I read all 103 posts in the sitemap through
Substack's post feed and searched each for "IPO", "new issue", "first base", "spin off", "uplist", "lockup", "IPO
AVWAP", "IPO open" and "IPO high". The 2026-10-18 Sunday Scans is for subscribers only and was not read past its
preview. In the Sunday Scans, "TSDR’s Weekly Outlook & Watchlist" is the owner's section: the issues from 2026-10-25
on head it "Patrick (TSDR)’s Weekly Outlook & Watchlist", and `sizing_rule.md` quotes Sunday Scans passages as the
owner's own published rules. In "The Rest of the Week" posts each writer has a headed section. The cold check confirmed
the section heading above every quote below. Quotes keep the writers' spelling. The firm's private
Discord knowledge base was not searched: it is private and this file is public.

### 6.1 The owner (TSDR)

On what an IPO base is and when he trades it:
- FIG, [2025-10-15](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-39d): "A trade IPO bases within the
  first year or so and historically have performed nicely with them." (Read "A" as "I".) Same note: "The best stocks
  coming off the lows are when the market is coming off the lows."
- AMTM, [2025-06-15](https://unchartedterritoryy.substack.com/p/sunday-scans-744): "Inside day Friday, IPO base. Waiting
  for volume to pick up or a notable breakout over $24 and $25."
- NTSK, [2026-08-30](https://unchartedterritoryy.substack.com/p/sunday-scans-d40): "IPO base and starting to build on
  the right side." Then: "Want to see it tighten up a tad and form VCP ish action here in the %$15-$17 area."
- FPS, [2026-03-01](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8): "IPO in the data center group saw a
  40% advance after opening trade consolidating sideways and closing tight 4 weeks in a row." Then: "If it does that is a
  buy with LOD stop imo."
- AMRZ, [2026-03-01](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8): "Another IPO base. A spin off
  actually. Spin offs have been very successful." And: "Retest of IPO high at $56 and gap up on earnings."
- SPCX, [2026-10-11](https://unchartedterritoryy.substack.com/p/sunday-scans-31b): "Still think the IPO base reminds me
  of many past big winners, one of them being SNDK IPO base. Watching $160 flat for UnR spot."

On the levels he marks:
- CRCL, [2025-06-15](https://unchartedterritoryy.substack.com/p/sunday-scans-744): "If not in already, would want to see
  an hourly handle or flag form here under IPO highs."
- HNGE, [2025-06-29](https://unchartedterritoryy.substack.com/p/sunday-scans-d70): "Hanging over IPO day highs and gave a
  nice run from $35-$50. Putting in higher lows and trying to get tight here."
- CRCL, [2026-03-01](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8): "It was the close of IPO day in June of
  2025 ($83.23)."
- Q, [2026-04-12](https://unchartedterritoryy.substack.com/p/sunday-scans-a43): "Ignoring the big candle post earnings
  and focusing on how it held and based above the IPO opening price." A week later
  ([2026-04-19](https://unchartedterritoryy.substack.com/p/sunday-scans-33a)): "All of this basing occurred above the
  IPO/Spinoff opening price highs."
- CRCL, [2026-05-17](https://unchartedterritoryy.substack.com/p/sunday-scans-679): "The anchored VWAPs from IPO open and
  IPO high continue to give this a tough time at $130."
- HNGE, [2026-08-23](https://unchartedterritoryy.substack.com/p/sunday-scans-807): "Huge move after getting above the IPO
  AVWAP." And: "Prefer these earlier in the moves."
- SPCX, [2026-09-06](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd): "Tight inside day below $150 IPO open
  and sitting right smack on the IPO AVWAP."
- SPCX, [2026-09-20](https://unchartedterritoryy.substack.com/p/sunday-scans-bc2): "$150 IPO open has turned into
  support." And: "My first trade on SNDK was 5/8/25 when we began to dance around IPO open at …. $36."

On volume, entries and stops:
- HNGE, [2025-07-13](https://unchartedterritoryy.substack.com/p/sunday-scans-6a6): "Light volume on the
  sell/consolidation and another high volume advance day."
- FLY, [2026-01-04](https://unchartedterritoryy.substack.com/p/sunday-scans-153): "Reminds me a lot of some previous IPO
  winners including ALAB in 2024." Then: "We have the big push off the base and the higher low hold at the 20EMA. I am
  long from $22.30 with a stop at Friday’s low."
- FLY, [2026-01-27](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-aaa): "Weekly Hammer forming after
  aggressive shakeout and buy up. IPO base on increased volume in respected Space Industry. Ideally tightens a tad."
- TTAN, [2025-06-22](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2): "The low of that earnings day is also
  the IPO price right at $100. Not super ideal with it below MA’s and I might just track it instead of trade it."
  (TTAN's offer price was $71 and its first trade $101 [S40], so his "IPO price" here is the IPO open.)
- SKHY, [2026-09-27](https://unchartedterritoryy.substack.com/p/sunday-scans-09b): "Tight below IPO highs, A shake n bake
  at $180 would be awesome." (Compare Bracco's SKHY stop-out, 6.2.)

On priority and study:
- [2026-02-22](https://unchartedterritoryy.substack.com/p/sunday-scans-04c): "Fresh IPO and young stocks deserve extra
  attention."
- [2026-03-01](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8): "If you haven’t noticed IPOs/Recent IPOs need
  to be priority focus."
- [2026-03-15](https://unchartedterritoryy.substack.com/p/sunday-scans-af4): "HVEs, IPOs, ER Gappers, Themes, news
  driven catalyst, RS Leaders in growth is where my focus always is."
- RBRK, [2026-06-28](https://unchartedterritoryy.substack.com/p/sunday-scans-ae1): "Young stocks and stocks at ATHs are
  where you find the biggest winners btw."
- SPCX, [2026-08-30](https://unchartedterritoryy.substack.com/p/sunday-scans-d40): "Classic IPO behavior and needs to be
  on your radar. Some to study recently are ALAB CRWV and SNDK."
- SPCX, [2026-09-27](https://unchartedterritoryy.substack.com/p/sunday-scans-09b): "Look back at most ipos they do this
  type of action. Some shorter, some longer." And: "get to know this stock and study at least 10 notable IPOs."
- Sunday Scans intro, unsigned, first person, [2026-05-10](https://unchartedterritoryy.substack.com/p/sunday-scans-68a):
  "Sure it would be great to buy SNDK at $60 over IPO highs and trail a 50SMA all the way to $1500."

### 6.2 Bracco

- PL, [2025-12-07](https://unchartedterritoryy.substack.com/p/sunday-scans-088): "Few of these names that took IPO highs
  out of bases last year made massive moves. Reminds me a lot of RKLB during its first base after breaking the IPO highs
  earlier this year."
- [2026-01-11](https://unchartedterritoryy.substack.com/p/sunday-scans-0b3): "fresh IPOs such as VOYG, CHYM, FIGR, VWAV,
  and FLY breaking out of bases".
- FIGR, [2026-01-18](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1): "FIGR caught many eyes when it put in a
  strong gap-and-go move right out of a clean IPO base on the first Monday of the year, closing up over 21% on the
  highest volume in three months." Then "a sharp -16% late-day drop on Monday wiped out the late chasers and shook out
  the weak hands."
- FIGR, [2026-01-14](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305) (his section): "Got long at
  49.81 yesterday on the classic mean reversion setup." And: "First pullback following IPO base breakout and up over 7%
  today with major indexes closing negative."
- [2026-04-05](https://unchartedterritoryy.substack.com/p/sunday-scans-356): "worth watching as IPO breakouts can lead to
  massive moves, especially if tied to a big theme."
- [2026-04-12](https://unchartedterritoryy.substack.com/p/sunday-scans-a43): "You had the epic liquid, momentum trend in
  CRWV for a 400% move in 7 weeks. Just after that move the speculation moved to CRCL which 5x’d in 3 weeks."
- YSS, [2026-04-12](https://unchartedterritoryy.substack.com/p/sunday-scans-a43): "IPO’s have historically made some of
  the cleanest and biggest moves following market corrections." And: "big focus if this takes those IPO highs out on
  volume."
- FLY, [2026-04-12](https://unchartedterritoryy.substack.com/p/sunday-scans-a43): "Another space related name breaking
  out of its IPO base on sustained, elevated volume." And: "Clean above the IPO anchored VWAP now which is big for me to
  get involved."
- CRCL, [2026-05-31](https://unchartedterritoryy.substack.com/p/sunday-scans-6d8): "Big weekly IPO base. See if this can
  work back up the right side."
- SPCX, [2026-08-09](https://unchartedterritoryy.substack.com/p/sunday-scans-1ad): "Knew how negative the sentiment and
  positioning was into the large lockup expiry following earnings. Created a perfect storm for a potential contrarian
  trade."
- SKHY, [2026-09-06](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd): "Bought this on Wednesday at the close
  and got stopped Thursday through the lows of the day." And: "I know many just viewing this as an IPO base and in that
  sense it looks pretty clean."
- CBRS, [2026-09-06](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd): "Now has an interesting double bottom
  IPO base look and reminds me of ALAB from Summer 2024. Keep in mind market was coming out of a fast -15% correction at
  the time, so context much different."
- TEM, [2025-06-10](https://unchartedterritoryy.substack.com/p/trade-updates) ("Bracco here"): "Go look at some recent
  IPO movers like NBIS, CRWV, etc. Never underestimate how powerful these can be".

### 6.3 Team contributors ("The Rest of the Week")

- Dark Oblivion, NAVN, [2026-01-14](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305): "May need a
  little more time to build out this pivot but very classic IPO base looking constructive. Low sell volume and high buy
  volume, looks very constructive and potentially powerful."
- Beebe, DASH, [2025-10-01](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week): "Just breaking out of this
  cup & handle on the daily as well above the IPO pivot. Was buyable today off the 10 EMA."
- TINY TRADES, LOAR, [2025-10-01](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week): "Recent IPO, can be
  choppy, best to trade as swing with room to move back to highs."
- Dark Oblivion, FIG, [2025-10-08](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-208): "Big
  anticipation move from the IPO day but then subsequent relentless selloff,"

### 6.4 The owner's verdict log (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`)

- No IPO-base ruling exists. The account rulebook ruling: "E53 new listings rule", verdict "no", his words "53 no"
  (2026-11-09). `sizing_rule.md` records it as "No rule for new listings (IPOs)." The wording of the proposal he
  declined is not in the repo.
- Fresh IPOs appear in his HVE rulings: NAVN 2026-03-26, "Yes this is perfect", with the note "a lesser-known fresh IPO,
  a sudden massive day (12.9x, bigger than the IPO day)". And (2026-10-25): "NAVN from earlier this year is a good
  example" (`docs/study/setups/setup_examples.json`). The same NAVN was called a "very classic IPO base" by Dark Oblivion
  in January 2026.

### 6.5 What UCT's words add up to

1. **Window:** the owner trades IPO bases "within the first year or so".
2. **Structure:** consolidation under the IPO high (the highest price since listing), tightening ("get tight", "tighten
   up a tad", "VCP ish"), higher lows, inside days.
3. **Volume:** light on the pullback, heavy on the advance and the breakout.
4. **Levels unique to IPOs:** the IPO open, the IPO-day close and high, the IPO high, and the AVWAPs anchored at the IPO
   open and the IPO high. Bracco: "Clean above the IPO anchored VWAP now which is big for me to get involved."
5. **Entries:** the break of the IPO high on volume; an hourly handle or flag under it; an ORB; a U&R of a flat level;
   the first higher low at the 20-day; a flush into support (Bracco's mean-reversion FIGR buy).
6. **Stops:** the low of the day or the prior day's low.
7. **Context:** a theme, a leading group, strong growth, and a market turning up after a correction.
8. **Spin-offs and uplistings count** (AMRZ, SOLS, SNDK; the owner's 2025-07-27 GLXY note calls the Nasdaq uplisting
   highs "IPO" highs in quotes).

### 6.6 Examples UCT named at the time (candidates for the owner's 10 examples)

Not yet checked on our bars. Dates are the post dates, not the listing dates.

| Ticker | Who, when | What was said |
|---|---|---|
| FIGR | Bracco, 2026-01-18 | gap-and-go "right out of a clean IPO base", +21% on the highest volume in three months |
| FLY | owner 2026-01-04 and 01-27; Bracco 2026-04-12 | owner long from $22.30, stop at Friday's low; "breaking out of its IPO base" |
| NAVN | Dark Oblivion, 2026-01-14 | "very classic IPO base"; later the owner's HVE example |
| AMTM | owner, 2025-06-15 | "Inside day Friday, IPO base" |
| FPS | owner, 2026-03-01 | tight 4 weeks; "a buy with LOD stop" over $35 |
| AMRZ | owner, 2026-03-01 | spin-off IPO base; retest of IPO high $56 |
| HNGE | owner, 2025-06-29 and 2026-08-16 | over IPO-day highs; later "took out IPO highs and trended" |
| SPCX | owner, 2026-09 to 10 | IPO base; $150 IPO open as support; U&R of $160 |
| SNDK | Sunday Scans intro 2026-05-10 (unsigned); owner 2026-09-20 | over IPO highs at $60; first trade at the $36 IPO open |
| ALAB | owner, 2025-10-15 | his ALAB IPO-base trade "from $50.20 to $129" |
| CRCL | owner 2025-06-15; Bracco 2026-05-31 | hourly flag under IPO highs; later "Big weekly IPO base." |
| CBRS | Bracco, 2026-09-06 | "double bottom IPO base look" |
| NTSK | owner, 2026-08-30 | IPO base building the right side |
| YSS | Bracco, 2026-04-12 | right side of the base; watch for IPO highs taken out on volume |
| Outside, for contrast | IBD and Minervini | MA 2006 (buy point 50.73), CBRE 2004 (20.10), CXO 2007 (13.59), GOOG 2004 (113.58; 15 trading days), IPHI 2010 (16.68; 11 days), NOW 2012 (17 days, 14% deep), TWTR (19 days) |

Failures worth showing beside the winners: FIG (Dark Oblivion, a "relentless selloff" after the IPO day), Bracco's SKHY
stop-out, SPCX's "news failure after lockup exp & earnings" (Bracco, 2026-08-16), and IBD's own Habit Restaurants
round trip from a 40.35 IPO-base buy point (December 2014, section 3.4a).

---

## 7. How it fits the owner's account rulebook (section 9)

| House rule | How it applies to an IPO base | Conflict? |
|---|---|---|
| B26: no longs below the 200-day SMA (hard rule) | An IPO younger than 200 sessions has no 200-day SMA. The classic IPO base breaks out in its first weeks. | **Yes, a gap.** The rule cannot be checked. He must rule (Q3). |
| C31: RS 80 or more | Our RS needs at least 63 bars (`rs_weighted_return.py`: `REQUIRED_TERM = "3m"`, `IBD_REQUIRED_TERM = "q1"`, both 63 bars). An IPO base in its first three months has no RS. | **Yes, a gap** (Q4). |
| A3, F62: stop a few cents under the day's low or prior day's low | Applies. | No. |
| A13: stops usually within about 3% | IPOs are volatile (IBD); a breakout day's low is often further away. A3 says skip if the honest stop does not fit. | Tension, not a conflict (Q8). |
| E57: market orders | Applies: when price trades through the pivot, buy at market. | No. |
| C28: no buying more than 4% past the buy point | Applies. IBD and our detector use 5%; the house 4% wins. | Our detector disagrees. |
| C29: skip a long more than 10% above its 10-day average | A big gap-and-go breakout day (FIGR closed up over 21%) can put price more than 10% over the 10-day. Not measured here. | **Yes, in practice** (Q9). |
| B23: $10 and $20M a day | Applies. Measure dollar volume over the base, not the listing days (MSI: the first two or three days are not a benchmark). Our detector's $2/$10k floor is far below. | Our detector disagrees. |
| D42: own at most 1% of average daily volume | Applies. | No. |
| B22: no new buys in the 3 days before earnings | Applies. A new issue's first earnings report can come soon after listing; check the date. | No. |
| B19, E51, E52, F63: thirds at 3R and 5R, trail the 10-day (fast) or 21-day | Applies. IPOs are fast movers, so the 10-day by default. Our playbook's 20% to 25% trim and 8-week hold are not house rules. | Playbook disagrees (Q10). |
| B20: gap through the stop, first 30-minute low, out past 2R | Applies. | No. |
| C33: under 1R after 10 trading days, sell | Applies. | No. |
| D38, E49: size by grade | Applies. | Playbook's "smaller size" and the course plan disagree. |
| E53: no rule for new listings (IPOs) | My reading: no special account rule for IPOs, so no IPO size cut and no IPO waiting period as an account rule. | Course plan's "mandatory" lock-up step disagrees (Q11). |
| D47: shorts are the long setups reversed; B26: shorts only below the 200-day | A young IPO has no 200-day, so a short cannot meet B26 (parabolic shorts aside). | See 8.8. |
| D48: skip hard-to-borrow shorts | Applies to any IPO short. | No. |
| E56: 3 tries a week, 6 a month; B21: re-buy only on a new trigger | Applies. IPO bases shake out often. | No. |
| F65, B18: the market reading | IBD: new issues fall hardest in corrections. Prefer Green. | No. |

---

## 8. Proposed rules for our course

Each line is measurable and tagged with its basis. Where sources disagree, the options are given and one is
recommended.

### 8.1 What it is

- **Listing.** The stock's first trading day is known from the app's `first_trade_date` (or `list_date`), not from the
  first stored bar. [my proposal]
- **Which listings count.** Traditional IPOs, spin-offs and exchange uplistings. [UCT] (owner on AMRZ, SOLS; Kedia on
  demerged stocks; Stockbee 2007 on spin-offs). De-SPACs: owner to decide (Q2); Ritter's de-SPAC numbers are poor.
- **Window.** Options: (a) the left-side high forms within the first 25 trading days [originator: IBD, MSI]; (b) the
  base forms within the first 252 sessions (about a year) [UCT: the owner's "first year or so"; our detector].
  **Recommend (b) as the setup, and teach (a) as the A+ version**, because the owner's own examples (SPCX, NTSK) and
  Bracco's weekly CRCL base are months after listing while IBD's classic cases are weeks (though IBD's CBRE base began
  about eight weeks after listing).
- **Structure.** A sideways rest whose top is the highest high since listing (the IPO high), with no close above that
  high since it formed. [originator; UCT; our detector]
- **First base.** No earlier base since listing: no earlier stretch of 15+ sessions that pulled back 10% or more from a
  high and then took that high out. [my proposal, using our round-3 test] A later base is graded lower, not banned
  (Q1). (Kedia counts later bases in the "IPO base family" [source: Kedia].)
- **Length.** At least 10 sessions from the left-side high to the trigger. [source: Minervini's 10 days (repo record);
  originator: IBD 2014 "as short at nine or 10 days", IBD 2015 "They usually run two to five weeks."] Options: 7 (IBD's
  rare case), 10, 15 (our detector). **Recommend 10.** No upper limit inside the 252-session window; 2 to 5 weeks is
  typical [source consensus: IBD 2015, IBD/MSI 2018 "often less than five weeks", Kedia "up to five weeks"].
- **Depth.** From the left-side high to the base's lowest low. At most 35%. [my proposal; our detector; Kedia's deep
  class, 30% to 35%] Options: 20% (IBD's usual), 35%, 50% (IBD's volatile-market ceiling). **Recommend 35% as the cap,
  under 20% for A+.** Over 35% is not an IPO base in this course.
- **The IPO price.** The base's low stays above the IPO price (offer price; where only bars exist, the IPO open, which is
  also how the owner used "IPO price" for TTAN, 6.1). [originator: MSI 2019 "should not undercut", IBD 2018 "should
  generally form the base above"; source: Minervini] A brief undercut that closes back above in 1 to 3 sessions is a
  U&R, graded B [my proposal] (Q12). Kedia dissents for listings below the issue price (3.11).
- **Right side.** The last close of the base is in the top half of the base's range [our drawing rule] and the last 5
  sessions hold no two days of 4% or more in either direction [source: Stockbee 2010].
- **Volume in the base.** On the right half of the base, total volume on up-close days exceeds total volume on
  down-close days. [source consensus: IBD 2014 "quiet action during declines and heavy volume on the upside" and "Volume
  should be light during pullbacks and heavy during the stock's upside"; MSI 2019 right-side accumulation; UCT: Dark
  Oblivion "Low sell volume and high buy volume"]
- **Location.** Close above the rising 10-day and 21-day averages, and above the 50-day once it exists. [my proposal;
  source: Krull's 21-day EMA screen (Deepvue)] (No house rule requires this: C29 is a stretch limit and E52 a trail.)
  Close above the IPO AVWAP. [UCT: Bracco "Clean above the IPO anchored VWAP", the owner on HNGE; source: Shannon via
  Optuma] The 200-day: see Q3.
- **Liquidity.** Price at least $10 and average dollar volume at least $20 million over the base's sessions, leaving out
  the first three sessions after listing. [house rule B23; originator: MSI 2019 on days 1 to 3, IBD 2015 leaving out the
  IPO week]
- **Strength.** RS 80 or more when the RS exists (63+ bars); before that, see Q4. [house rule C31]
- **Fundamentals and theme.** Growing sales and earnings [house rule D40; Stockbee; IBD 2007]; in a leading group or
  theme [house rule C31; UCT; MSI; Stockbee]. To make it measurable: the latest reported quarter's sales and EPS up
  year over year (D40 is a preference, "the chart comes first", so a miss lowers the grade rather than voids the setup)
  [my proposal]; the group in the top quarter of the app's group ranking [my proposal; MSI's "top 40" of 164 groups is
  about the top quarter, Stockbee's "Top 20 ranked sector"].

### 8.2 The buy

- **Trigger.** Price trades above the left-side high (the IPO high). IBD sets the buy point 10 cents above it.
  [originator]
- **Order.** Market order once it trades through. [house rule E57]
- **Volume.** Breakout-day volume at least 1.4 times the average of the base's sessions, leaving out the listing week.
  [originator: IBD's 40%, and its advice to compare with recent sessions when no 50-day average exists, leaving out the
  IPO week (2015); my proposal: measuring the 40% against the base's own sessions] A+ at 2 times or more of the 10-day
  average, or the highest volume of any session after the listing day [source: Stockbee 2010 (his rule: highest or
  second highest, for IPOs under 10 days old); Deepvue's tip]. If the trigger fires early in the day, judge volume by the
  pace at the time of the buy [my proposal].
- **No chasing.** Not more than 4% above the buy point [house rule C28] and not more than 10% above the 10-day average
  [house rule C29].
- **Never on the listing day or in the listing week.** [originator: MSI 2019; also IBD 2007 and 2015; source: Donnelly's
  91% statistic]
- **Earlier entries, if the owner wants them taught (Q7).** Options: (a) only the IPO-high break; (b) also the PDH or
  30-minute ORB out of a tight handle under the IPO high [UCT: the owner's hourly flag and ORB notes; Kedia]; (c) also a
  U&R of a flat level or the IPO open [UCT: the owner on SPCX]; (d) the first higher low above the IPO AVWAP
  [source: Shannon, whose notes say "VWAP" without naming the anchor; UCT: Bracco]. **Recommend (a) and (b).** They have a clear trigger and a tight stop. (c) is our U&R setup, and (d) is close to
  our AVWAP-reclaim scanner (`detectors/uct/avwap_reclaim.py`), so both can be taught there.

### 8.3 The stop

- A few cents under the breakout day's low; the prior day's low is the house's other default. [house rule A3, F62;
  UCT: the owner's "LOD stop"]
- If the honest stop does not fit the risk, skip. Never move it up to fit. [house rule A3]
- Ceiling. Options: (a) house guideline, about 3% [A13]; (b) 8% [originator: MSI 2019]; (c) none. **Recommend (b): skip
  the trade if the honest stop is more than 8% below the entry**, and teach that most good IPO breakouts give less [my
  proposal] (Q8).
- A gap through the stop: the B20 rule. [house rule]

### 8.4 Trims and trail (house defaults)

- Breakeven between 2R and 5R. [house rule B19]
- A third at 3R, a third at 5R; take a trim at the open if it gaps past the level. [house rule B19, E51, F63]
- Trail the last third under the 10-day average, sold on a close below it; the 21-day if the stock is trending steadily.
  [house rule E52] IPOs are usually fast movers, so the 10-day is the default [my proposal].
- O'Neil's 8-week hold (a 20% gain in under 3 weeks) is not a house rule; teach it only as the source's idea (Q10).
- A climax run: sell a big part into it. [house rule C34]

### 8.5 What invalidates it

Before the trigger:
- The low undercuts the IPO price and does not close back above it within 3 sessions. [originator: MSI 2019; my
  proposal for the 3 sessions]
- Depth goes past 35%. [8.1]
- 252 sessions pass since listing without a trigger. [8.1]
- A V-shape: the right side goes from the base low back to within 5% of the pivot in 5 sessions or fewer with no pause.
  [source: Kedia's "time compression" failure (his example: three bars from the bottom); my proposal for the numbers]
- The market reading is Red. [house rule D46, F65]
- Earnings within 3 days. [house rule B22]

After the buy:
- The stop. [house rule A4] The owner struck "cut at least half if the stock falls back into its base" ("15, eh, my stop
  is my stop most of the time.", verdict log 2026-11-09), so MSI's "would not like to see a stock breach the pivot
  price" is a warning, not an exit. (IBD's Habit case, 3.4a, shows its own exit for a breakout that gives back a 10%
  gain: the round-trip sell signal. Not a house rule.)
- Under 1R after 10 trading days. [house rule C33]

### 8.6 Best market conditions

- A Green reading; margin only in Green. [house rule F60, F65]
- Best: a market turning up after a correction. [UCT: Bracco 2026-04-12; the owner 2025-10-15; Stockbee 2010]
- Be careful when the IPO calendar is crowded late in a long advance. [source: TraderLion 2025, summarizing the
  Lifecycle team]
- A hot theme helps. [UCT: Bracco 2026-04-05; source: Kedia "trending or futuristic themes"]

### 8.7 Common mistakes

1. Buying the listing day or the first heated days. [IBD 2015; MSI; Donnelly; Stockbee]
2. Buying a stock that already made a massive run with no base. [IBD 2014]
3. Using the first two or three days' volume as the volume yardstick. [MSI 2019]
4. A deep V straight into the pivot. [Kedia]
5. Chasing a gap breakout past 4% or 10% over the 10-day. [house rule C28, C29]
6. Widening the stop to sit through the base's depth. [our playbook's mistakes list; house rule A4]
7. Trading thin, low-priced new issues. [house rule B23, D42]
8. Treating a later base as the first, or forcing the label on an old stock (our detector's backfill trap). [section 5]
9. Ignoring the IPO AVWAP and the IPO open as levels. [UCT]
10. Buying in a weak market, where new issues fall hardest. [IBD 2007]

### 8.8 The short mirror

**Recommend no short mirror in this course for now.** Reasons: a young IPO has no 200-day, so a short cannot satisfy
B26 [house rule]; D48 skips hard-to-borrow shorts, and Stockbee flags thin trading on the short side ("One of the
problems for trading IPO on short side is liquidity"); and no source defines a "failed IPO base" short with rules
(Stockbee's IPO shorts are "Concept IPO's" fading after the hype, with no entry rule given). The mirror
that does exist in our library is Bracco's parabolic short, which B26 exempts. If the owner wants one later: a close
below the base low and the IPO price, on volume, after a failed breakout, once the 200-day exists (Q13).

---

## 9. Grading: A+ versus B-

The owner ruled that grading is discretionary (E50). This is a guide of observable signs, not a checklist.

| Sign | A+ | B- |
|---|---|---|
| Timing | left-side high in the first 25 sessions; first base [IBD, MSI] | later base, months after listing |
| Depth | under 20% [IBD, MSI] | 30% to 35% |
| Length | 2 to 5 weeks, tightening [IBD] | under 10 sessions, or a loose base |
| IPO price | never undercut [MSI 2019; Minervini] | brief undercut and reclaim |
| Right side | inside days on very low volume [Minervini]; weekly ranges under 10% [IBD on CBRE] | a fast V into the pivot [Kedia] |
| Volume | up-volume clearly above down-volume; breakout 2x or more the 10-day, or the highest since listing [Stockbee] | breakout volume only modestly above average |
| Breakout day | closes near the high [IBD 2018, copied by MSI 2018] | closes mid-range |
| Location | above the IPO AVWAP, the rising 10-day and 21-day [UCT; Krull] | at or under the IPO AVWAP |
| Liquidity | $100M+ a day [Donnelly screen] | near the $20M house floor |
| Fundamentals | 100% EPS or sales growth [Stockbee]; 35% quarter-over-quarter [Boboch] | modest growth |
| Group and theme | leading group or hot theme [MSI; Stockbee; UCT] | no group support |
| Market | Green, turning up after a correction [UCT; Stockbee] | Yellow |
| Stop [my proposal] | 3% to 5% from entry | 6% to 8% |

---

## 10. Questions for the owner

1. **Which IPO base do we teach?** (a) IBD's early one, left-side high within 25 sessions; (b) your "first year or
   so"; (c) both, (a) as A+. And is a later base (second base since listing) still an "IPO base" or a regular base?
2. **What counts as a new listing?** Spin-offs, uplistings, de-SPACs: yes or no to each.
3. **The 200-day hard rule (B26) for stocks under 200 sessions.** (a) Not applicable until the 200-day exists, use the
   IPO AVWAP and the IPO price instead; (b) skip until 200 sessions (this removes nearly every classic IPO base);
   (c) another proxy you prefer.
4. **RS 80 or more (C31) before 63 sessions exist.** (a) Waive until it exists; (b) use performance since listing
   against the S&P 500 or Nasdaq; (c) skip until it exists.
5. **Depth cap.** 20%, 35% or 50%?
6. **Minimum length.** 7, 10 or 15 sessions?
7. **Entries.** Only the IPO-high break, or also the PDH/ORB out of a tight handle, the U&R of a level or the IPO open,
   and the first higher low above the IPO AVWAP?
8. **Stop distance.** The house guideline is about 3%. For IPO bases: allow up to 8% (MSI), skip past a number you
   choose, or keep 3%?
9. **C29 and gap breakouts.** A gap-and-go IPO breakout (FIGR closed up over 21% that day) can sit more than 10% over its
   10-day. Keep the skip, or allow a day-1 30-minute ORB entry while it is still within 10%?
10. **O'Neil's 8-week hold.** Leave it out (house trims only), or teach it as an exception for IPO breakouts that gain
    20% in under 3 weeks?
11. **Scope of E53.** Does "No rule for new listings" also mean no setup-level changes (smaller size, a lock-up check)?
    Should the lesson mention lockups as context only (Field and Hanka; Bracco's contrarian SPCX note)?
12. **The IPO price.** Use the offer price (needs a data source), the IPO open (in our bars), or Stockbee's listing-day
    close? (Your TTAN note used "IPO price" for the open: $100 against a $71 offer price.)
13. **A short mirror.** None (recommended), or a failed-IPO-base short once the 200-day exists?
14. **The examples.** Which 10 of the candidates in 6.6 do you want, and which failures beside them?
15. **The app.** Replace the AI-written Model Book playbook with your rules once you rule (and rebuild the 4 draft
    Study recall items that quote it)? Tighten the experimental
    detector to these rules (house liquidity, 4% zone, a volume test, the real listing date) and turn on the rare
    preview so you can approve live cases?

---

## 11. Sources

All read on 2026-11-09. "Saved" = downloaded and checked word for word. "Reader" = read through a page-reading tool.
"Repo record" = quoted from a file in our repo, not re-read.

**Originators (IBD and the O'Neil firm)**

| # | Source | Publisher, author, date | Notes |
|---|---|---|---|
| S1 | ["IPO Bases Are Unconventional, But They Can Lead To Big Gains"](https://finance.yahoo.com/news/ipo-bases-unconventional-lead-big-224800356.html) | IBD, syndicated on Yahoo Finance, 2015-09-21; Yahoo names no author, IBD's own copy [S36] names Vincent Mao | Saved from the Internet Archive copy of 2015-09-25 (Yahoo refused the download). Cold check: re-read, every quote exact. High. |
| S2 | ["MasterCard's IPO Base In '06 Sparked A 'Priceless' Uptrend"](https://finance.yahoo.com/news/mastercards-ipo-06-sparked-priceless-220300547.html) | IBD via Yahoo, no author named, 2014-06-05 | Saved from the Internet Archive copy of 2014-06-13. High. |
| S3 | ["CBRE Soared From IPO Base, But Investors Needed Patience"](https://finance.yahoo.com/news/cbre-soared-ipo-investors-needed-214100286.html) | IBD via Yahoo, 2015-04-21, no byline | Reader; no archive copy; Yahoo answered HTTP 429 to a download. Cold check: the reader tool confirmed both quotes (one with a comma restored) and the short date fragments in 3.4. High source; check the live page before a lesson quotes it. |
| S4 | ["IBD on IPO"](https://stockbee.blogspot.com/2007/07/ibd-on-ipo.html) | Stockbee (Pradeep Bonde) reproducing IBD's Investor's Corner of 2007-07-20 | Saved. Medium-high: IBD's text as copied by a third party. |
| S5 | ["How To Trade: IPO Bases Are Unusual But Can Result In Rich Gains"](https://blog.marketsmithindia.com/trade-ipo-bases-unusual-can-result-rich-gains/) | MarketSmith India, 2018-08-06 | Saved from the Internet Archive (2021-04-23); the host no longer resolves. High (O'Neil firm), but a near copy of IBD's own column [S39], so not an independent voice. |
| S6 | ["Learning Article : Missed IPO is Not a Missed Opportunity"](https://blog.marketsmithindia.com/learning-article-missed-ipo-is-not-a-missed-opportunity/) | MarketSmith India (William O'Neil India), 2019-10-21 | Saved from the Internet Archive (2021-03-04). High. Indian examples. |
| S7 | ["Investor’s Business Daily Announces New Stock List: IPO Leaders"](https://www.prweb.com/releases/investor_s_business_daily_announces_new_stock_list_ipo_leaders/prweb11567308.htm) | IBD press release via PRWeb, 2014-02-10 | Saved from the Internet Archive. Medium (marketing text). |
| S8 | William J. O'Neil, *How to Make Money in Stocks*, 3rd ed. (McGraw-Hill, 2002), [Internet Archive record](https://archive.org/details/howtomakemoneyin00mcgr) | McGraw-Hill | Not read (lending only; the Archive's search-inside answered "Item not available" and the Google Books API refused the query in the cold check too). Nothing quoted. |
| S36 | ["IPO Bases Can Be Brief But Profitable"](https://www.investors.com/how-to-invest/investors-corner/ipo-bases-can-be-short/) | IBD, Vincent Mao, 2015-09-21 (page metadata) | Saved from the Internet Archive copy of 2016-06-16. IBD's own copy of S1, same text. High. Added in the cold check. |
| S37 | ["Google's IPO Base Brought About Big Gains"](https://www.investors.com/how-to-invest/investors-corner/ipo-bases-can-produce-large-gains/) | IBD, Vincent Mao, 2014-05-30 | Saved from the Internet Archive copy of 2021-02-20. High. Added in the cold check. |
| S38 | ["Buying IPO Stocks Can Be Tricky, So Do Your Homework"](https://www.investors.com/how-to-invest/investors-corner/ipo-bases-can-produce-big-winners/) | IBD, Scott Stoddard, 2015-12-01 (page metadata) | Saved from the Internet Archive copy of 2016-03-05. High. Added in the cold check. |
| S39 | ["IPO Bases Are Unusual But Can Result In Rich Gains"](https://www.investors.com/how-to-invest/investors-corner/ipo-bases-rich-gains/) | IBD, Juan Carlos Arancibia, page metadata 2018-03-02 | Saved from the Internet Archive copy of 2018-03-03. High; the original that S5 copies. Added in the cold check. |

**Other originators and established educators**

| # | Source | Publisher, author, date | Notes |
|---|---|---|---|
| S9 | Mark Minervini, *Think & Trade Like a Champion* (Access Publishing, 2017), section "THE 'LOW CHEAT'" | Minervini | Repo record: `docs/superpowers/research/bases/03-minervini-vcp-powerplay.md`, which read an unofficial online PDF of the book. Not re-read. High author, check against a bought copy. |
| S10 | Mark Minervini, *Trade Like a Stock Market Wizard* (McGraw-Hill, 2013) | Minervini | Not read; only secondary summaries seen. Nothing quoted. |
| S11 | ["How to trade IPO's"](https://stockbee.blogspot.com/2007/07/how-to-trade-ipos.html) | Stockbee, Pradeep Bonde, 2007-07-19 | Saved. High (originator of his own method). |
| S12 | ["How to find profitable IPO trading opportunities using Telechart"](https://stockbee.blogspot.com/2010/08/how-to-find-profitable-ipo-trading.html) | Stockbee, Pradeep Bonde, 2010-08-23 | Saved. High. |
| S13 | ["Why you should not rush to buy a IPO on first day"](https://stockbee.blogspot.com/2010/11/why-you-should-not-rush-to-buy-ipo-on.html) | Stockbee, Pradeep Bonde, 2010-11-24 | Saved (via the blog's search page). High. |
| S14 | ["Jesse Livermore IPO b/o setup"](https://stockbee.blogspot.com/2011/12/jesse-livermore-ipo-bo-setup.html) | Stockbee, 2011-12-01 | Saved; an image plus one line of text ("A complete setup idea for trading IPO's"). No Livermore wording claimed. |
| S15 | [*The Lifecycle Trade*, Google Books page](https://books.google.com/books/about/The_Lifecycle_Trade.html?id=7OLcwgEACAAJ) | Boboch, Donnelly, Krull, Daill; Blanca Graciela Inc., 2018-12-21 | Saved; the book itself not read. Statistics quoted from Jack Schwager's blurb. Medium. |
| S16 | [thelifecycletrade.com](https://www.thelifecycletrade.com/) | The authors | Saved. Media list only. |
| S17 | ["Kathy Donnelly"](https://beyondthetrades.wordpress.com/2019/05/05/kathy-donnelly/) | Beyond the Trades (interview blog), 2019-05-05 | Saved. Medium: her words in a Q&A. |
| S18 | ["Trading IPO Stocks: Capitalize on The 3 IPO Phases"](https://traderlion.com/technical-analysis/trading-ipo-stocks/) | TraderLion staff, 2025-06-11 | Saved from the Internet Archive (2025-07-15). Medium: a summary of the Lifecycle team's work. |
| S19 | ["3 Powerful IPO Screeners That Uncover New Growth Potential"](https://deepvue.com/screener/ipo-screeners/) | Deepvue, "Last Updated: May 12, 2025" | Saved. Medium: a vendor article built with the Lifecycle team's screens; its general tips ($20M, RS 85, highest volume since IPO) are Deepvue's, not credited to the authors. |
| S20 | Alphatrends: ["Why Price Is King: Brian Shannon’s Market Outlook & IPO Strategy"](https://alphatrends.net/archives/why-price-is-king-brian-shannons-market-outlook-ipo-strategy/) (2025-06-30); ["Brian Shannon Shares His Approach to Evaluating New IPOs"](https://alphatrends.net/archives/brian-shannon-shares-his-approach-to-evaluating-new-ipos/) (2026-06-14); ["Trading IPOs With The Anchored VWAP"](https://alphatrends.net/archives/trading-ipos-with-the-anchored-vwap/) (2020-08-07, an embedded document with no readable text) | Alphatrends (Brian Shannon's firm) | Saved. Medium-high: his firm's show notes. |
| S21 | ["Scripting and Anchored VWAPs"](https://docs.optuma.com/scripting-avwap/) | Optuma | Saved. Medium: a vendor paraphrasing Shannon's book. |
| S22 | ["IPO Bases – A Comprehensive Study"](https://traderlion.com/profile/chhirag-kedia/master-ipo-base-trading/) | TraderLion, Chhirag Kedia, 2025-03-08 | Saved from the Internet Archive (2025-03-23). Medium-low: one practitioner, Indian market, examples only. |
| S23 | ["The Power of the 8 Week Hold Rule for Investors"](https://traderlion.com/trading-strategies/the-8-week-hold-rule/) | TraderLion, Nick Schmidt, 2024-10-02 | Saved from the Internet Archive (2025-03-23). Medium. |
| S24 | [qullamaggie.com](https://qullamaggie.com/) (site search and all 8 posts in its sitemap) | Kristjan Kullamägi | Saved. No IPO material. |
| S25 | Searches for Oliver Kell, Stan Weinstein, Morales and Kacher on IPO bases | various | Nothing found. |
| S26 | [thepatternsite.com chart pattern index](https://www.thepatternsite.com/chartpatterns.html) | Thomas Bulkowski | Reader (the site refused a download). No IPO pattern. **The page states a notice against AI use:** "shall not be used to train artificial intelligence (AI) systems, technologies, large language models, or similar systems". |
| S27 | [TradingView post on IPO buy points ("JS-Masterclass #8")](https://www.tradingview.com/chart/NOW/TxjzSbrs-Perfect-Buy-Points-IPO-s-The-Primary-Base/) | JS_TechTrading, 2022-11-10 (date not re-checked) | Reader. Low: copies IBD and MSI text without credit. Not used. |

**Measured evidence**

| # | Source | Publisher, author, date | Notes |
|---|---|---|---|
| S28 | ["Initial Public Offerings: Updated Long-run Statistics"](https://site.warrington.ufl.edu/ritter/files/IPOs-long-run-returns-on-IPOs.pdf) | Jay R. Ritter, University of Florida, dated 2026-10-05 | Saved (PDF). High. Tables 15c, 16a, 16e, 20 used. |
| S29 | ["The New Issues Puzzle"](https://ideas.repec.org/a/bla/jfinan/v50y1995i1p23-51.html) | Loughran and Ritter, Journal of Finance 50(1), 1995 | Saved (abstract). High. |
| S30 | ["The Expiration of IPO Share Lockups"](https://ideas.repec.org/a/bla/jfinan/v56y2001i2p471-500.html) | Field and Hanka, Journal of Finance 56(2), 2001 | Saved (abstract). High. |
| S31 | [SEC Investor.gov, "Initial Public Offerings: Lockup Agreements"](https://www.investor.gov/introduction-investing/investing-basics/glossary/initial-public-offerings-lockup-agreements) | SEC | "The terms of lockup agreements may vary, but most prevent insiders from selling their shares for 180 days." The live site answers HTTP 403; the cold check confirmed the sentence word for word in the Internet Archive copy of 2026-10-26 (it also matches `docs/study/courses/F1/F1.06.json`). High. |
| S40 | ServiceTitan (TTAN) pricing: [Renaissance Capital, "Software platform ServiceTitan prices IPO at $71, above the upwardly revised range"](https://www.renaissancecapital.com/IPO-Center/News/108194/software-platform-servicetitan-prices-ipo-at-71-above-the-upwardly-revised); [IPOScoop, "The IPO Buzz: ServiceTitan Prices IPO at $71"](https://www.iposcoop.com/?p=34185) | 2024-12-11/12 | Saved. IPOScoop: "ServiceTitan’s stock surged to open at $101". Used only to show what the owner meant by "IPO price" (6.1). Added in the cold check. |

**UCT and the house**

| # | Source | Notes |
|---|---|---|
| S32 | [UCT Substack](https://unchartedterritoryy.substack.com), all 103 posts in the [sitemap](https://unchartedterritoryy.substack.com/sitemap.xml), read through Substack's post feed | Saved. The house voice. One subscriber-only post not read. |
| S33 | `docs/study/sizing_rule.md` section 9; `docs/study/TRADE_PLANS.md`; `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | The owner's rulings. TRADE_PLANS.md has no IPO Base row. |
| S34 | `api/services/screener/base_catalog.py`; `api/services/pattern_engine/shape_draw.py`; `api/services/auto_structures.py`; `api/services/rare_preview.py`; `api/services/pattern_engine/primitives/liquidity.py`; `api/services/rs_weighted_return.py`; `api/services/screener/snapshot_builder.py`; `api/services/ticker_ipo.py`; `api/services/ipo_calendar.py`; `api/services/ipo_maintenance.py`; `api/services/scan_ipo.py`; `api/services/scan_volume.py`; `api/routers/scans.py`; `app/src/components/StockChart.jsx` | Our code, read on branch feat/study-content. |
| S35 | `app/src/pages/modelbook/setupCatalog.js`; `app/src/pages/modelbook/setupPlaybooks.js` (commit 291af0c34c); `app/src/constants/setupGroups.js`; `docs/curriculum/uct_method_scripts.json`; `docs/study/UNITS-method.md`; `docs/superpowers/research/setups/setup_criteria.json`; `docs/superpowers/research/setups/setup_sources.json`; `docs/study/bank/recall.playbooks.json`; `app/src/pages/charts/widgets/presetScans.js` | Our app text and earlier research. |

One more house fact: the "Recent IPOs & Spinoffs" theme (`themes_taxonomy.json`, id `recent_ipos`) drops holdings 12
months after their listing date (`api/services/ipo_maintenance.py`). Those listing dates are typed by hand in that
file's `IPO_DATES` and some look like month placeholders (for example SNDK "2025-02-01", KLAR "2025-11-01", CRIS
"2025-06-01"), so they are not checked facts.

---

## Fixed in checking (cold check, 2026-11-09)

1. CBRE quote (3.4): the first draft split one sentence into two quotes and dropped the comma after "trading"; now one
   quote, comma restored (reader tool).
2. Stockbee 2007 (3.8, 3.13, 3.14): "IPOed in last 2 years" was presented as his universe rule. It is context ("25% of
   the stocks in Double Trouble universe have IPOed in last 2 years"); the post states no age limit.
3. Stockbee's Livermore post (2, S14): not "no text"; it has one line of text, quoted now.
4. MarketSmith India 2018 (2, 3.5, S5): described as MSI's "own words"; it is a near copy of IBD's own column
   (Arancibia, S39), which also keeps the "adding 10 cents" MSI dropped.
5. Shannon (3.10, 3.13, 3.14, 8.2): his notes say "VWAP" without naming the anchor; "IPO AVWAP" is now marked as an
   inference.
6. Tags (8.1, 8.2, 8.5, 8.6): Minervini, Stockbee, Kedia and TraderLion were tagged [originator], which the file defines
   as IBD and the O'Neil firm only; now [source: name]. The Location line was tagged [house rule C29/E52], but neither
   rule asks for a close above the averages; now [my proposal]. The breakout-volume line's 1.4x against the base's
   sessions is now marked as an adaptation [my proposal], not IBD's rule.
7. Length (8.1): "2 to 8 weeks is typical [source consensus]" had no source for 8 weeks; now "2 to 5 weeks" with the
   sources named.
8. Study bank (4, 5.3): "the Study bank has no IPO-base items" was wrong; it holds 4 draft recall items built from the
   AI-written playbook.
9. The chart's IPO badge (5.1): it matches `list_date`, not `first_trade_date`.
10. The research catalogue's Stockbee mis-cite (5.3 item 12): the URL sits in `setup_sources.json`, reached through the
    source key in `setup_criteria.json`; the file reference now says so.
11. The struck rule (8.5): the owner's words were cut to "my stop is my stop"; now quoted in full, "most of the time"
    included.
12. Section 6 intro: `sizing_rule.md` quotes Sunday Scans as the owner's published rules; it does not name the TSDR
    section. The "Patrick (TSDR)" heading appears from 2026-10-25 on.
13. Minervini's depth in table 3.13 was quoted as "not too excessively"; his words are "don't correct too excessively".
14. Window (8.1): CRCL was listed among the owner's months-after-listing examples, but his CRCL flag note (2025-06-15)
    came within weeks of its June 2025 listing ("the close of IPO day in June of 2025"); the months-later CRCL base is
    Bracco's weekly one (2026-05-31).

Added in checking: IBD's own investors.com columns (S36 to S39: Mao 2014 and 2015, Stoddard 2015 with the Habit
failure and the IPO-week volume rule, Arancibia 2018); the app's live "IPO in Last 1-Year" scan (5.1); Kedia's
multiple-base, theme, stop and below-issue-price points (3.11); Stockbee's catalyst guideline and concept-IPO shorts
(3.8); the owner's TTAN usage of "IPO price" for the first trade (6.1, S40); the owner's SKHY and Q notes (6.1); the
CBRE listing and breakout dates (3.4, reader tool); the SEC lockup sentence confirmed through the Internet Archive (S31).

## Removed in checking

Nothing in the first draft was found to be invented. Every quote it gave was found on its page, word for word apart
from the CBRE comma and Minervini's depth fragment above (all 432 quoted fragments in this file were then scanned by
script against the saved pages and the repo; the only ones not matched by machine are the reader-tool quotes, the
code strings split across lines, the git commit message, and pages whose markup breaks the text, each checked by hand),
and every UCT quote sits under the section heading of the writer it names. Removed or withdrawn as unsupported:
1. "within 2 years" as a Stockbee rule (table 3.13 and 3.14): not his rule (item 2 above).
2. "2 to 8 weeks is typical [source consensus]": no source gives 8 weeks.
3. The [house rule C29/E52] basis for the Location line: those rules do not say it.
4. "the Study bank has no IPO-base items": false.

Still unverified, and labelled so in the text: the Minervini quotes (repo record from an unofficial PDF of the book;
the cold check could not reach a copy), the CBRE column's wording (reader tool only), and the TradingView post's date.

---

## 12. Examples (from our data)

**The scan's rule (section 8 made measurable, plus the house rules).** The listing day is the ticker's first stored
daily bar, accepted as a real listing only when it carries the listing-day signature (first-day volume at least 3 times
the median of the next 30 sessions, and a first bar after mid-1995, so data backfills, de-SPACs and most ETFs drop out;
the app's `first_trade_date` was not available in the sandbox). Inside the first 252 sessions, the IPO high is the
highest high since listing and the base runs from that high to the trigger: at least 10 sessions long, at most 35% deep,
its low above the listing-day low (the offer price is not in the bars, so the listing-day low stands in for the "IPO
price" floor; whether the base also held the listing-day OPEN is recorded for grading), the last close in the top half
of the base, no two 4% days in the last five sessions, up-close volume beating down-close volume on the right half,
and the trigger-day close above the 10- and 21-day EMAs, the 50-day where it exists and the IPO anchored VWAP. House
rules: price at least $10 and at least $20M a day over the base (leaving out the first three sessions after listing,
B23); the buy is 10 cents over the IPO high as a market order when the stock trades through it (E57), or the open on a
gap, skipped if more than 4% past the buy point (C28) or more than 10% above the 10-day average (C29); breakout volume at
least 1.4 times the base's average (listing week left out); the stop a few cents under the lower of the breakout day's
and prior day's lows, or under the breakout day's low alone when that is more than 8% away, skipped past 8% (8.3). The
outcome is a fixed stop with no trims: the first of stop, 3R or 5R over the next 60 sessions, walking forward from the
day after the entry. Not tested, because the data cannot: the market reading (D46), RS 80+ (C31, no benchmark series in
the sandbox), earnings within 3 days (B22), fundamentals (D40), and the 200-day rule (B26), which a young IPO cannot meet
(Q3). A full-day volume figure is used where a live trade would judge the pace at the time of the buy.

**Base rate.** 2,630 of 2,630 liquid names scanned (the names that ever met the house liquidity rule since 2002; the
scan took 103 seconds, so nothing ran out). 57 hits, 1999 to 2026 (most in 2013, 2020, 2021 and 2024): 26.3% reached 3R
and 17.5% reached 5R before the stop; 48 of the 57 were a ticker's first base (12 reached 3R, 8 reached 5R); 36 were
stopped before 3R. Caveat: this is a fixed stop with no trims, no breakeven move and no trail, over 60 sessions, so it
understates what the house plan (B19, E51, E52) would keep on the winners and says nothing about the trims. The rule is
strict (one hit per 46 liquid names ever), which is the point of the setup: a real listing, a first base at the IPO
high, a clean right side and a breakout on volume do not line up often. Loosening the listing-day signature or the
"two 4% days" line would raise the count and lower the rate.

**The 10 examples** (charts and the three phone sheets are in the scratchpad at
`_study-resume/scratchpad/setups/05-ipo-base/final/`; `examples.json` holds every number). Buy = the market-order fill
(10 cents over the IPO high, or the open on a gap). Stop = under the lower of the two lows, with its distance. Best R =
the best excursion before the stop within 60 sessions.

| # | Ticker | Breakout | Listing, base | Structure | Buy | Stop | Vol | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|
| 1 | LULU | 2007-09-19 | listed 2007-07-27, day 37, first base | 5.8 weeks, 26% deep; IPO high 19.42, low 14.35, held the IPO open | 19.53 | 18.10 (7.3%) | 2.9x | 7.6R, 3R in 10 days | The classic shape: a hot listing, five weeks sideways under the first-week high, a quiet pullback, then the high taken on nearly three times the base's volume. The stop is wider than the house likes (7.3%); 8.3's ceiling still allows it. |
| 2 | KRMN | 2025-09-05 | listed 2025-02-13, day 140, first base | 6.8 weeks, 22% deep; IPO high 57.32, low 44.43, held the IPO open | 57.42 | 56.05 (2.4%) | 2.2x | 22.9R, 3R the next day | A tight breakout day (2.4% stop) out of a seven-week base on the IPO high, in a hot theme (defence); the move that followed is the one the dossier's UCT quotes describe. The base is months after listing: the (b) window. |
| 3 | VIK | 2024-06-28 | listed 2024-05-01, day 40, first base | 2.0 weeks, 9% deep; IPO high 33.28, low 30.42, held the IPO open | 33.38 | 32.62 (2.3%) | 2.8x | 5.1R, 3R in 10 days | The A+ version from 8.1: the base forms inside the first weeks, shallow, tight, with a 2.3% stop and the breakout on 2.8 times the base's volume. Reached 5R, then rolled over: the trail matters. |
| 4 | LSPD | 2020-12-22 | listed 2020-09-11, day 71, first base | 2.4 weeks, 12% deep; IPO high 62.54, low 54.87, held the IPO open | 62.64 | 60.76 (3.0%) | 1.7x | 10.6R, 3R the next day | Two and a half weeks of tight sideways action under the high after a steady climb; a 3% stop and 3R the next day. Note: this first US bar is, as I understand it, the New York listing of a stock already trading in Toronto, an exchange cross-listing of the kind 8.1 counts (owner on GLXY); I could not verify that in this session. |
| 5 | NET | 2020-06-15 | listed 2019-09-13, day 189, first base | 4.0 weeks, 16% deep; IPO high 30.78, low 25.85, held the IPO open | 30.88 | 28.76 (6.9%) | 3.0x | 6.8R, 3R in 3 days | The first real base at the high since listing, nine months in, with the right side above every average and the breakout on three times the base's volume. Shows the (b) window: the IPO high here is a high made in May 2020, not the first-day high. |
| 6 | STX | 2003-05-28 | listed 2002-12-11, day 114, first base | 2.0 weeks, 10% deep; IPO high 14.22, low 12.83, held the IPO open | 14.32 | 13.28 (7.3%) | 2.1x | 8.1R, 3R in 14 days | A two-week shelf at the high since listing after the stock recovered its listing-day range; the breakout came at the start of the 2003 bull market (8.6: a market turning up after a correction). Short base, wider stop. |
| 7 | FWONA | 2013-04-30 | listed 2013-01-10, day 75, first base | 2.4 weeks, 6% deep; IPO high 20.30, low 19.11, held the IPO open | 20.40 | 19.54 (4.2%) | 1.9x | 6.0R, 3R in 11 days | A spin-off listing (the first bar is the January 2013 Liberty Media separation; the ticker was renamed later, from memory, unverified), then 15 weeks flat within 6% before the high was taken. The flattest example: a learner can see the shelf at a glance. |
| 8 | BSY | 2021-05-24 | listed 2020-09-23, day 167, first base | 17.8 weeks, 29% deep; IPO high 54.62, low 38.63, held the IPO open | 54.72 | 52.50 (4.1%) | 1.9x | 5.5R, 3R in 8 days | The long, deep end of the rule: 18 weeks and 29% from the IPO high, still inside 35%, with a rounded right side above the 50-day and a 4% stop. Teaches that the base can be long when the right side is orderly. |
| 9 | AXTA | 2015-02-23 | listed 2014-11-12, day 68, first base | 6.4 weeks, 12% deep; IPO high 28.00, low 24.74, held the IPO open | 28.10 | 26.28 (6.5%) | 1.9x | 3.7R, 3R in 56 days | A plain six-week cup under the IPO high with a quiet right side; a slower winner that took 56 sessions to reach 3R and never saw 5R. Useful as the "ordinary" example beside the fast ones. |
| 10 | SABR | 2015-03-19 | listed 2014-04-17, day 231, first base | 4.2 weeks, 8% deep; IPO high 22.71, low 21.00, held the IPO open | 22.81 | 21.73 (4.7%) | 1.6x | 3.7R, 3R in 39 days | Late in the first year (day 231), a four-week, 8% shelf at the high since listing in a steady uptrend; a steady mover where the 21-day trail (E52) fits better than the 10-day. The volume ratio (1.6x) is the minimum end of the rule. |

Picking notes: one hit per ticker, winners of at least 3R, chosen for a clear shape; the two VIK hits are the same
stock (the second, 2024-10-07, is a later base and was left out), and later bases (MRVI 2021-08-03 was a third base,
ZIM 2021-08-25 a second) were set aside because 8.1 grades them lower. Years repeat (2015 twice, 2020 twice, 2021
twice) because the rule finds few hits in any single year. No ETF or split problem was seen in the ten charts; every
chart was looked at.

**Notable failures (in words).**
- MA 2007-01-17 (listed 2006-05-25, day 161): a 6.6-week, 17% base at the IPO high, breakout on 1.6 times the base's
  volume, a 5% stop; stopped in the next sessions at 0R before the stock went on to a years-long advance. The textbook
  stock, the textbook base, and still a stop: the rule is a probability, not a promise.
- APTV 2012-11-02 (listed 2011-11-17, day 240): a 5.6-week, 10% base, breakout on 2.8 times the base's volume with a
  tight 2.3% stop, stopped at 0R. The first APTV base in February 2012 had also stopped (0.99R). Two clean-looking
  failures in a flat 2012 market: 8.6 (the market reading) is the missing line in the scan.
- MDB 2018-07-24 (listed 2017-10-19, day 190): a 5.4-week, 20% base, 1.8 times volume, 6.7% stop, 0.6R and out. The stop
  was near the 8% ceiling, which is the risk 8.3 warns about: a wide honest stop on a volatile new issue.
- Also stopped at or near 0R: VRSK 2009-11-12 (a base inside the first 26 sessions whose low had undercut the listing-day
  open), NAVN 2026-08-27 and BIRK 2024-02-21 (0.76R).

**Data limits.** The listing day is inferred from the bars, not from the app's listing date, so a stock whose first
stored bar is a later data start is excluded by the volume signature rather than by knowledge of its listing. The offer
price is not in the data, so the listing-day low stands in for it. RS, the market reading, earnings dates near the
trigger and fundamentals were not applied. The base rate counts a fixed stop with no trims over 60 sessions.

## 13. Failures and near-misses (from our data)

Charts in `_study-resume/scratchpad/setups/05-ipo-base/final/`: `fail_1-4.png` (the four failures, one column),
`near_1-4.png` (the four near-misses), `pair_04-cup-handle.png` (an IPO base above a cup with handle). Every chart
carries the same IPO-high buy line, stop, 3R, 5R and listing-day-low lines and the base box the winners carry.
Numbers are read off the daily bars; "N sessions later" counts from the day after the entry day. The scan found only
57 hits (36 stopped before 3R), so the failures are what the data gives: three are the ones section 12 names, the
fourth (NAVN) is the most recent clean stop.

**Four failures (every rule in section 12 passed; the stop was hit before 3R).**

| # | Ticker | Breakout | Buy / stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|
| 1 | MA | 2007-01-17 | 10.96 / 10.41 (5.0%) | 1 session later, 2007-01-18, low 10.18 | Listed 2006-05-25; a 6.6-week, 17% base at the IPO high broke out on 1.6x the base's volume and closed near its high, then the next session fell through the 5% stop. Best 0.0R. The stock went on to a years-long advance. | ipo.after_entry_stop (the rule is a probability, not a promise) |
| 2 | APTV | 2012-11-02 | 28.05 / 27.41 (2.3%) | 1 session later, 2012-11-05, low 26.92 | Listed 2011-11-17; a 5.6-week, 10% base, 2.8x volume, a tight 2.3% stop; the breakout day closed in the lower third of its range and the next session took the stop. Best 0.0R. The first APTV base, 2012-02-17, had also stopped (0.99R). | ipo.market_reading (a flat 2012 market; not in the scan) |
| 3 | MDB | 2018-07-24 | 59.64 / 55.66 (6.7%) | 4 sessions later, 2018-07-30, low 53.81 | Listed 2017-10-19; a 5.4-week, 20% base, 1.8x volume, closed near its high; the honest stop was 6.7% away, the trade reached 0.6R and fell to the stop four sessions later. | ipo.stop_width (a wide honest stop on a volatile new issue, near the 8% ceiling) |
| 4 | NAVN | 2026-08-27 | 30.09 / 28.70 (4.6%) | 1 session later, 2026-08-28, low 28.43 | Listed 2025-10-30; a 2-week, 7% shelf at the IPO high on day 206 broke out on 2.1x volume and closed near its high, then fell through the 4.6% stop the next session. Best 0.0R. | ipo.after_entry_stop (nothing in the setup was wrong) |

**Four near-misses (each looks like an IPO base and fails exactly one gate of the card).** Found by re-running the
section 12 scan with every gate relaxed and keeping the candidates that fail one and only one (2,630 of 2,630 names,
224 seconds); the IPO-price case comes from the strict scan itself, whose floor was the listing-day low where the
card's rule is the IPO price (the offer price, else the IPO open). VRSK 2009-11-12, named in section 12, is the same
kind of case (base low under the listing-day open).

| # | Ticker | Date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | SPOT | 2018-05-02 | ipo.above_ipo_price | base low 135.51 under the IPO open 165.90 | A direct listing (2018-04-03) whose first base undercut the IPO open by 18%; the breakout on day 21 reached 0.0R. The card's ipo.above_ipo_price says the base low stays above the IPO price. |
| 2 | CAVA | 2024-09-20 | ipo.window | breakout on session 318 after listing; the rule needs 252 or fewer | A clean 3.6-week, 14% shelf on 2.2x volume, but 318 sessions after listing: a regular base on a stock past its first year (a flat base or cup, judged by its own rules). Best 0.77R. |
| 3 | NWSA | 2013-10-24 | ipo.breakout_volume | breakout volume 0.75x the base's average; the rule needs 1.4x | A spin-off listing (2013-06-19); a 6-week, 10% base at the high, but the breakout came on 0.75x the base's volume: no demand on the day. Best 0.82R. |
| 4 | CRWD | 2019-08-09 | ipo.length_min | 8 sessions from the IPO high to the trigger; the rule needs 10 | Listed 2019-06-12; the high was taken only 8 sessions after it was set: a pause, not a base. The 7% stop was hit; best 0.78R. |

**What the failures have in common.** None of the four broke a rule; all four were out within four sessions, three
of them the day after the buy with a best of 0.0R. Three broke out on volume of 1.6x to 2.1x and closed near the
high of the day, which is what the card asks for, and still gave nothing back the next morning: on a young stock the
breakout day's strength is not the tell it is on a seasoned one. Two carried the wide stops the setup is known for
(5.0% and 6.7%), so the loss in dollars was larger than on a cup or flat base, which is the point of 8.3's ceiling and
of sizing from the stop. The one line the scan cannot read, the market reading, is the one section 12 blames for
APTV; the learner's read is that an IPO base is a probability trade with a quick answer, and the answer is more often
no than on the older setups (26% reached 3R against 30% for the cup).

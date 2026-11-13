# Setup 24: High Volume Edge (HVE / HVC) (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page
or file named next to it and checked word for word against a saved copy (the check script and the copies are in the
session scratchpad, not in the repo). Nothing here is a ruling. Where I could not read a source, I say so and give no
wording from it.

**Cold check, 2026-11-09.** A second reader re-opened every source cited here (fresh copies of every readable outside
page, Bulkowski's through a fetch tool because the site refuses plain downloads; the 36 UCT Substack posts now quoted;
the house files and the code), re-checked every quote word for word, re-measured the model examples and the kept-vs-cut
table on the bars, and recomputed the universe tables from the raw scan records (the scan itself was not re-run).
Every quote in the first draft was found on its page. What was wrong or unsupported is fixed in place and listed at the end ("Corrected in
checking", "Removed in checking"); sources the first pass missed are added (TraderLion's own 2024 definition, Bonde's
own stop and exit words, the Gervais-Kaniel-Mingelgrin working paper).

**Second cold check, 2026-11-09 (a third reader).** Every outside page was downloaded again (23 pages, Bulkowski's through
a fetch tool, the X posts through X's public oEmbed, the Wharton PDF converted to text), all 36 Substack posts were
re-fetched and each quote, post date and section heading re-read, the 18 brain-KB rows were re-read from the repo's JSON
files, the detector, the common helpers, the finder, the deep-scan guard, the playbook, the catalog, the plain rules, the
trade plan and the rulebook were re-read, and the kept-vs-cut table, the entry tables, the universe tables, the subset,
extension and climax figures, the PLTR bars and the post-event dollar volumes were recomputed from the saved gallery and
scan records and the bars database. Every quote was found word for word on its page. Four small things were loose and
are fixed in place (listed as items 30-34 under "Corrected in checking"); nothing had to be removed.

This file goes deeper than the earlier levels dossier (`docs/study/levels/dossiers/hve.md`, entry and stop only), the
outside notes (`docs/study/levels/external_research.md` section 4) and the 2026-10-25 analysis
(`docs/study/analysis/2026-10-25-setup-differentiation.md`). Where they overlap, this file adds sources that the earlier
notes could only see as excerpts, UCT's public posts, the app's code, and new measurements, including the day-2 entries
that the levels dossier said were never replayed.

Tags used in section 8: **[source consensus]** at least two outside sources agree; **[originator]** the own words of
the trader who originated the idea named (here Bonde, for the Episodic Pivot); **[outside: name]** one outside trader's
or educator's own rule, not a consensus and not shown to be the originator (Duncan, for example); **[UCT]** UCT's own
writers or the owner's verdict log; **[house rule]** the account rulebook, `docs/study/sizing_rule.md` section 9;
**[my proposal]** my recommendation, for the owner to accept or change.

Words used below. **HVE day**: the record-volume day. **HVC** (high volume close): that day's closing price, the level.
**HVE low**: that day's low. **Day 2**: the session after the HVE day. **Record**: volume above every prior session in a
lookback. **x50**: the day's volume divided by the 50-day average volume before it. **Edge ratio**: the day's volume
divided by the old record (the largest prior volume in up to 252 sessions). **All-history record**: above every session
in the data. **DCR** (daily closing range): where the close sits in the day's range, 0 = the low, 1 = the high. **R**:
the risk on a trade (entry minus stop); 3R is a gain of three times that risk. **Kept / cut**: the owner's verdicts on
the bank's charts (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`).

---

## 1. What it is

A stock that nobody was watching suddenly trades far more shares in one up day than it has ever traded, usually on
news that changes its story: a contract, a trial result, a partnership, or an earnings report so big the volume is
extreme. The close of that day, the HVC, is marked on the chart as a level, and later trades are planned around it.

The owner's own words for it: "Any up day on record volume" (2026-10-23), then, on COMP, "This is much better, sudden
major increase" and, on CVX, "they can go below the HVC that is fine. It is meant to be a major level to mark out on your
chart" (owner_verdicts.jsonl lines 123-124; spot.fixtures.jsonl line 5). The Model Book card says: "An up day on volume
that dwarfs everything before it, often on a lesser-known name, the start of a new story; the close is a level to mark.
Not an HVC, not a PEG." (`app/src/pages/modelbook/setupCatalog.js`).

**Why it works (the psychology).** The points below are reasoning backed where shown. Section 4 shows how little of it
is measured, and that the measured part is mostly a premium in the weeks after, not a level that holds.

- **New owners arrive all at once.** A record day means many large buyers took positions on one day. Greg Duncan, who
  publishes the HVC setup: "When a stock experiences a gap up in price on exceptionally high volume, it's a clear sign of
  institutional accumulation." ([Upside Unlimited, 2 Dec 2023](https://upsideunlimitednewsletter.com/p/trading-the-high-volume-close-setup))
- **Attention brings later buyers.** Academic work finds that a volume shock makes a stock more visible, and more buyers
  follow. Gervais, Kaniel and Mingelgrin: "We find that stocks experiencing unusually high (low) trading volume over a day
  or a week tend to appreciate (depreciate) over the course of the following month."
  ([Journal of Finance, 2001](https://ideas.repec.org/a/bla/jfinan/v56y2001i3p877-919.html)) Barber and Odean show
  individual investors are "net buyers of attention-grabbing stocks, e.g., stocks in the news, stocks experiencing high
  abnormal trading volume, and stocks with extreme one-day returns."
  ([Review of Financial Studies, 2008](https://ideas.repec.org/a/oup/rfinst/v21y2008i2p785-818.html))
- **Why the close becomes a level.** Most of the day's shares changed hands near the day's prices. When price comes back
  to that area, the new owners are at breakeven: some defend it, some sell to get out even. That is why the level is
  where the next decision happens, not a promise that it holds. The owner says the same: price "can go below the HVC".
  (Reasoning; Brian Shannon's anchored VWAP rests on the same idea, see section 3.10.)
- **Who is trapped.** Short sellers in a neglected or beaten-down stock are caught by a sudden new story and must buy
  back. Sellers who sold the HVE day near its low watch the stock climb away. (Reasoning, not a sourced fact.)
- **Who is selling into it (the other side).** Not every record day is a beginning. Wyckoff's buying climax: "A BC often
  coincides with a great earnings report or other good news, since the large operators require huge demand from the
  public to sell their shares without depressing the stock price."
  ([ChartSchool, The Wyckoff Method: A Tutorial](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial))
  Bracco makes the same point on OKLO (section 6.3): a record at the start of a move is a beginning; a near-record (the
  second-highest volume ever) after a huge run is often the end.

---

## 2. Origin and naming

**Short answer: I could not establish who coined either name.** The pieces I could date:

| date | who, where | what it shows |
|---|---|---|
| 12 Feb 2010 | Pradeep Bonde (Stockbee), "What are Episodic Pivots and how to find them" | The idea without the name: the volume on a big earnings day "might be the highest volume in the history of the stock or multi year high volume". |
| 7 Feb 2021 | TraderLion, "TraderLion's Enhanced Volume" (TradingView script) | First version labels only "HV" (highest volume in over a year). |
| 9 Feb 2022 | same script, update | Adds the "HVE" label (Highest Volume Ever), renames HV to "HV1", adds "HVIPO". |
| 11 Dec 2022 | Greg Duncan (@GregDuncan_), X thread "3 setups every trader must know" | The thread opens a list whose first setup, in his 27 Jan 2023 blog version of it, is the "High Volume Close (HVC)". Only the first post of the thread could be read. |
| 12 Dec 2022 (UTC) | TraderLion TikTok (date decoded from the video ID) | Seen only as a search-result title (not read): a short video presenting the HVC as a TraderLion setup, using MDB. |
| 27 Jan 2023 | Greg Duncan, "3 Trading Setups Every Trader Must Know" (feather.blog) | Full HVC rules with the HVE / HV1 / HVIPO / HVLE labels. |
| 23 Mar 2023 | Ameet Rai (@AmeetRai), X | "I've mastered the HV edge - a setup I noticed when studying historical market winners." He says he classified the variants. |
| 2 Dec 2023 | Greg Duncan, "Trading The High Volume Close Setup" (Upside Unlimited) | The fullest numeric spec found (section 3.3). |
| 6 Feb 2024 | TraderLion, X (PLTR) | "We teach 3 main setups at TraderLion." The first is "The Gapper/High Volume Setup". |
| 27 Jul 2024 | Manrav (UCT trader), Discord, as summarised in the repo's KB (row 11027) | "high-volume edge" used inside UCT (the summary's wording, not a quote of his). |
| 11 Oct 2024 | Ameet Rai, X | "Ways to Enter High-Volume Edge": the setup's name in a trader's own post. |
| 28 Oct 2024 | TraderLion, X (full text read through Thread Reader App) | Four volume ranks (HVE, HVIPO, HV1, HVLE) plus "a huge gap up in price (with a strong closing range)": TraderLion's fullest definition found (section 3.2). |
| 2025-2026 | UCT Substack (Sunday Scans, The Rest of the Week) | HVE and HVC used weekly (section 6). |

**What the letters mean, source by source.**
- **HVE** = "Highest Volume Ever" in TraderLion's script and its 2024 post, Duncan, UCT's own volume indicator and almost
  every UCT post. Ameet Rai uses the letters but the parts of his posts I could read do not spell them out. The owner and
  the app use **High Volume Edge** for the setup, and so does Ameet Rai ("HV edge", 2023; "High-Volume Edge", 2024), as
  does a TraderLion lesson title I could not open ("Entering The High Volume Edge Setup"). One KB summary (row 5355) and
  the summary of UCT's volume tool (row 12315) say "High Volume Event". So "HVE" means three things in the house material.
- **HVC** = "High Volume Close" in every source I read, with two variants: one UCT post expands it as "highest volume
  close" (The Rest of the Week, 2025-10-01, HOND, signed AMT), and the KB summary of a Richard Moglen post reads "HVC (High
  Volume Close/Candle)" (row 18131). Duncan and TraderLion use HVC as the name of the whole setup; the owner uses it for
  any high-volume close and rules that it is NOT the same as an HVE ("Just a PEG and HVC. Not a real HVE", line 130).
- **HV1** = highest volume in about a year ("Highest Volume in Over a Year", TraderLion's script; "In The Past Year",
  TraderLion 2024; "in 1 Year", Duncan). **HVIPO** = highest since the IPO ("Since IPO", the script; "Since IPO Day/Week",
  TraderLion 2024; "Since IPO Week", Duncan). **HVLE** = highest since the last earnings ("Since Last EPS", Duncan's blog;
  "Since Last Earnings", TraderLion 2024; Ameet Rai lists HVLE without spelling it out). **HVQ** = "Highest Volume Since
  Last Quarter" (Duncan's newsletter). The same KB summary of a Moglen post reads "HV1 (High Volume day 1)" (row 18131); I
  could not read the post, so I cannot say if that is his wording or the summary's.

**A house claim I could not support.** `docs/superpowers/research/setups/setup_sources.json` calls Greg Duncan "THE
ORIGINATOR OF HVC". Its own entry is marked "reported", not read. TraderLion's labels predate Duncan's earliest dated
HVC post that I found, and Ameet Rai says he classified the variants himself. Treat "originator" as unproven.

**The house's name conflict.** The vocabulary file records it: the Model Book says "High Volume Edge", the authors say
"High Volume Close" (`docs/wisdom/vocabulary/setup-vocabulary-v1.json`, entry "High Volume Close (HVC)", which marks it a
"NAME CONFLICT"). The journal's tag list has "HVC" and no "High Volume Edge"
(`app/src/constants/setupGroups.js`), though the owner rules they are different things (section 5.4).

---

## 3. Every definition I could find, source by source

### 3.1 The owner (UCT; the primary source for how we trade it)

His words, in order (owner_verdicts.jsonl lines 118-153; spot.fixtures.jsonl lines 5, 21, 22; chat rulings lines 459
and 534):

- 2026-10-23, with META and AMZN on screen: "Any up day on record volume". The ruling recorded with it: long only, an up
  close, "a strong close is NOT required" (spot.fixtures.jsonl line 5; that last phrase is the analyst's record, not his
  words).
- 2026-10-25, pass 2 (16 charts on the detector's definition, 3 kept): "Most of these so far are just HVC (high volume
  close) and PEGS (POWER EARNINGS GAPPERS)". On the kind of stock: "It's usually on some lesser known stocks like BFLY
  recently or even MRNA." He then corrected himself on BFLY: "okay maybe BFLY wasn't a great example, NAVN was though"
  (spot.fixtures.jsonl line 21; BFLY's 2026-06-18 day was not even a one-year record on our bars, section 6.2). On COMP:
  "This is much better, sudden major increase". On LRCX (an options-expiry day): "Make
  sure we do not have end of month and OPEX days marked as HVE days". On AAPL: "Not part of the high volume edge". On
  ASML: "Again, just a PEG". On ORCL: "Just a peg but it is an HVC". On earnings: "Close, but earnings days can count".
- On CVX: "No. Btw, they can go below the HVC that is fine. It is meant to be a major level to mark out on your chart.
  Again NAVN from earlier this year is a good example" (line 124). The log adds that the "must work" rule used to pick
  examples does not apply to HVE. (The two house records word his lines slightly differently: owner_verdicts.jsonl
  writes "do not" and "that is", spot.fixtures.jsonl line 21 "don't" and "that's"; the quotes here follow
  owner_verdicts.jsonl. COMP's grade "good" is the analyst's: the verdict line says "grade good assumed".)
- Pass 3 (18 charts on his definition, 15 kept): NAVN 2026-03-26 "Yes this is perfect"; FSLY 2026-02-12 "This. This is
  100% A+"; on WVE, "I like the 2nd one better the one that comes a little later in the chart shown" (he picked the second
  surge, 2024-10-16).
- 2026-10-25, the chart drawings: "slap a horizontal ray on the close of the HVC candle and also put an AVWAP on it from
  the HVC candle day" (quoted in `app/src/pages/study/hveOverlay.js`).
- 2026-11-07, the liquidity cut for the bank: "If the examples under the liqudity rule are good enough we can use them
  btw but i am also fine leaving them out. But if they are great visuals of the concept then it is okay to use them"
  (line 459; the applied note exempts HVE because of "often on a lesser-known name").
- 2026-11-09, on the Trade Story game stopping at the first return to the HVC: "yes add those stops too, keep going"
  (line 534). **He has not said what to do there** (section 10, question 7).

**Criteria the analysts wrote down from these words** (the bank lesson in `scripts/study/gen_setup_examples.py` and
`docs/study/bank/spot.setups.json`): "ten times normal and above the prior record", up close, no OPEX (third Friday) or
month-end sessions, earnings days count "when the volume is truly massive", the close is a level, "price may trade under
it later". The "ten times" is the analysts' number, not his words: COMP, which he kept ("This is much better, sudden
major increase"; the grade "good" is the analyst's), measured 7.8x in the
verdict log and 9.0x on the local bars. The finder that picked pass 3 (`scripts/study/find_hve_examples.py`) encodes
"dwarfs" as **10x the 50-day average OR 2.5x the old record**, plus a record of the available lookback (up to 252
sessions, at least 60). The confirmed-definition note in spot.fixtures.jsonl line 21 words it as "10x+ the 50-day average,
well above the prior record", which reads as AND; the finder's OR is the analysts' encoding.

What his 19 kept charts look like is measured in section 4.3 (a).

### 3.2 TraderLion (educator; its 2021-2022 volume tool is the earliest dated use of the HV labels found)

TraderLion's own pages were blocked to every tool I am allowed to use (HTTP 403, re-tried in the cold check), so the
lesson "Entering The High Volume Edge Setup", the article "3 Early Entry Techniques To Improve Win Rate" and the article
"Finding Your Trading Edge: Proven Setups That Work" were **not read**. I give no wording from them. What I could read:

- **The definition**, X, 28 Oct 2024 ([post](https://x.com/TraderLion/status/1851022013168582699); the embed shows only the
  opening, so the full text was read through Thread Reader App's copy,
  [threadreaderapp.com/thread/1851022013168582699](https://threadreaderapp.com/thread/1851022013168582699.html), whose
  opening matches the embed word for word). Under "Gap Up Volume" it lists four ranks: "The Highest Volume Ever (HVE)",
  "The Highest Volume Since IPO Day/Week (HVIPO)", "The Highest Volume In The Past Year (HV1)", "The Highest Volume Since
  Last Earnings (HVLE)". Then: "When you couple one of these 4 volume signatures above with a huge gap up in price (with a
  strong closing range), it's likely the name will be much higher over the coming days/weeks if the market holds up." Its
  reason: a name with one of these ranks "is likely going to see Follow On Follow Through Volume (repeat buying from
  institutions) in the coming days/weeks." Example given: OKLO. No entry, stop or exit in this post.

- **The volume labels**, "TraderLion's Enhanced Volume", TradingView, 7 Feb 2021, updated to 7 Apr 2022
  ([script page](https://www.tradingview.com/script/yzjhAo0E-TraderLion-s-Enhanced-Volume/)). HVE: "Look for HVE
  letters on top of the volume bar to identify this powerful characteristic (this is really the highest volume in the past
  10 years due to TradingView's lookback limitation. However, this is a good spot to check to see if this volume is in
  fact the highest volume ever)." (The script's own authors say "ever" means ten years on their tool.) HV1: "Another powerful characteristic we look for at TL showing new
  information and interest in a particular stock." HVIPO: "A very important characteristic for young stocks that might
  turn into big winners."
- **The day-2 trade**, X, 6 Feb 2024 ([post](https://twitter.com/TraderLion/status/1754980182694277617), read through
  X's public embed, which cuts the text short): "$PLTR traded the Highest Volume Ever (HVE) today, and now fits into the
  Day 2 Gapper/High Volume Setup." The rest of the post appeared only in a search result, so I give it without quotes:
  watch a whole number the stock respects ($20 for PLTR), watch "volume support" on the morning of day 2 (the price area
  where the gap day's volume traded, $21 for PLTR), and take the final entry when price moves back above the prior day's
  close, the HVC ($21.88). Treat that part as unverified. (The bars agree with it, which is not the same as reading it:
  PLTR closed 6 Feb 2024 at $21.87 on our bars, an all-history record at 8.1x; on 7 Feb it opened under that close, traded
  down to $21.38 and closed at $23.60.)

Criteria: a gap day ("a huge gap up in price"); a strong closing range; an HVE, HVIPO, HV1 or HVLE volume rank; better
"if the market holds up"; entries on day 2 at volume support, a whole number, or back over the HVC (the day-2 details
unverified). No stop, trim or trail could be read.

### 3.3 Greg Duncan (publishes the HVC setup in full)

Two primary posts, both read in full:
[Upside Unlimited, "Trading The High Volume Close Setup", 2 Dec 2023](https://upsideunlimitednewsletter.com/p/trading-the-high-volume-close-setup)
and [feather.blog, "3 Trading Setups Every Trader Must Know", 27 Jan 2023](https://gregduncan.feather.blog/3-best-trading-setups).

Unless marked "(blog)", the quotes below are from the newsletter; the blog repeats the ranks and the examples but not
these sentences.

- **Volume:** "Our focus in the HVC setup is not just on any high volume but on the highest volume." The ranks: HVE,
  HV1, HVIPO and HVQ (newsletter) or HVLE (blog).
- **Prior event:** "This pattern occurs after a stock gaps up on huge volume due to earnings or another major news event."
  (blog)
- **Price move:** "Anything over 10% is notable, but the higher the percent change on the day, the better."
- **Close:** "We ideally want to see the stock closing at 75% or higher of its daily range on the gap day. 50% is usually
  the lowest end DCR that I’ll trade."
- **Location:** "A gap to new highs is preferable, but a gap within 20% of prior highs is also significant." He adds:
  "There are also instances in which trades coming out of bottoms perform incredibly well, as sentiment undergoes massive
  changes — quickly."
- **Entry:** "The closing price of the gap-up day serves as our primary entry point."
- **Stop:** "I typically set a hard stop-loss at 3-5% below the HVC." Also: "An additional exit criterion is an
  end-of-day close below the HVC. This tactic depends on market conditions and overall sentiment."
- **Exits** (newsletter): a third at 1R ("usually 5%"), a third at 2R ("usually 10%"), "Let the rest run vs. the 10EMA…"
- **Market:** "If a stock is showing the above characteristics, and the market is favorable, there is a massive chance you
  have found a huge winner." (blog)
- **A down-gap variant:** "BROS is an example of an HVE gap down that resolved to the upside." (blog)
- A risk per trade of "0.25-0.5% of the account, up to 0.75% when performing well" is recorded against him in the house's
  research file (`docs/superpowers/research/setups/setup_criteria.json`, entry `hvc.risk`, no quote attached); neither
  number appears in these two posts, so I do not repeat it as his.

### 3.4 Ameet Rai (trader; claims to have classified the variants)

Read through X's public embed (the text is cut short):
- 23 Mar 2023 ([post](https://x.com/AmeetRai/status/1638962498094133255)): "I've mastered the HV edge - a setup I noticed
  when studying historical market winners." and "I then classified them as HVE, HV1, HVIPO, HVLE - all variants have some
  level of success but nothing beats HVEs." It goes on: "All 5 figure percent winners in the market over many years had
  2-3 HVEs along" (the embed cuts the sentence there). "5 figure percent" means gains of 10,000% or more, a claim about a
  handful of chosen winners, not a test.
- 11 Oct 2024 ([post](https://x.com/AmeetRai/status/1844751959619682395)), "Ways to Enter High-Volume Edge": "Volume
  Support: Pull up a 15 minute chart identify areas of price / volume support. Very basic and it works" and "High Volume
  Close: Lots of traders use this now but its best used as a secondary entry area not primary." The third way (whole
  numbers) is cut off.
- His TraderLion write-ups (search results list High Volume Edge case studies on ASTS, CAVA and WGS) were blocked
  (403); not read.

Criteria: the volume rank (HVE best), entries at intraday volume support first, the HVC second, whole numbers third.

### 3.5 Pradeep Bonde, Stockbee (originator of the Episodic Pivot; the idea behind the volume)

[“What are Episodic Pivots and how to find them”, 12 Feb 2010](https://stockbee.blogspot.com/2010/02/what-are-episodic-pivots-and-how-to.html).
On earnings breakouts that go on to big moves: they "will have huge volume surge, typically of 10 times or more compared
to average volume" and "In many cases the volume on earnings day might be the highest volume in the history of the stock
or multi year high volume." Also: "If volume is very high, you can assume move has legs." His sample Telechart scan in the
same post has two branches joined by OR: a $5 gain on a stock at $62.50 or more with volume above the prior day's, OR an
8% gain on volume at least 300% of the 100-day average. On the kind of stock: "Stocks with no analyst coverage are
typically smaller companies or companies which are out of favor." And: "Earnings breakout on companies with significant
analyst coverage do not do as well as the first kinds." (This is the originator's support for the owner's
"lesser-known" rule.)

His own replies under the post (comments on the same page, read): "I buy less than 1% stocks from that scan. Tere are
additional criteria like eps growth, sales growth, extent of neglect, nature of catalyst which are used to narrow the scan
candidates further." (22 Feb 2010.) On stops and exits: "Because we track earnings daily most of the time we enter these
kind of trades in pre market or at open. In such cases the stop is the low of last 2 days before entry." Then: "The exits
are in 4 parts with profit target of 20% plus." (30 Sep 2010.) So the originator's own trade is the event day itself,
at the open, not a level to come back to.

Deepvue's page on Bonde's scans ([Deepvue, 21 Apr 2025](https://deepvue.com/screener/pradeep-bonde-screens/); educator,
secondary): "A 9 Million Episodic Pivot is when a stock trades 9 million+ shares in one day, usually after a big event."
And: "Find stocks that haven’t traded 9M+ shares before." Entry: "Enter near the breakout level with a stop below the low
of the day."

This is the closest originator match for the house's "ten times normal and above the prior record".

### 3.6 Kristjan Kullamagi (Qullamaggie; trades the Episodic Pivot)

[“How to master a setup: Episodic Pivots”, 2 Nov 2021](https://qullamaggie.com/how-to-master-a-setup-episodic-pivots/):
"My definition (this may differ from Pradeeps) is a gap up of 10% or more. There has to be massive volume near the open,
ideally the stock should trade the average daily volume the first 15-20 minutes or even quicker." Entry at the
opening-range high ("I rarely trade in extended hours but prefer to wait for the opening range highs"); "Stop is always
at the lows of the day." The cap: "Make sure your stop is no more than 1x, or maximum 1.5x the average daily range or the
average true range." "Volume is the #1 thing to focus on." No level at the close; his trade is the gap day itself.

### 3.7 UCT's other traders (house; Discord via the repo's KB, and Substack)

Full quotes in section 6. The rules they use:
- **Manrav** (KB 11027, summary of 2024-07-27): high-volume closes, especially on highest-volume-ever candles, are major
  pivots; if day 2 opens above day 1's close it is a buy with that close as the stop; give room for an undercut (his
  example: a $4 entry with a $3.75 stop); a high close on the HVE makes the pivot stronger. His own words (KB 11545):
  "Use/add high volume close as major pivot pivots on your charts". His HVE scan, as summarised there, is "HVE and
  close > 3".
- **TSDR, the owner** (desk logs): day 2 red-to-green through the HVC, stop a few cents under the day-2 low (KB 10097);
  reclaims of an earnings HVC (KB 10089); trims into the first days of the move and a breakeven stop (KB 10146, 10171);
  trail the 20 EMA (KB 10252).
- **Bracco**: a record or near-record day after a long run is a climax, not a start (section 6.3).

### 3.8 Wyckoff (StockCharts ChartSchool tutorial by Roman Bogomazov and Michael Lipsett; educator)

[The Wyckoff Method: A Tutorial](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial).
Not an HVE source, but it names the two readings of a huge volume day. Demand: "a price bar that has wide spread, closing
at a high well above those of the previous several bars and accompanied by higher-than-average volume, suggests the
presence of demand." The sign of strength is "a price advance on increasing spread and relatively higher volume". The
retest: "Backing up to an LPS means a pullback to support that was formerly resistance, on diminished spread and volume."
The warning is the buying climax quoted in section 1.

### 3.9 The app's own sources (house)

- The detector's code calls its rule a "[trader rule: N=252]" record with "close > 3", ported from "an offline study of
  how experienced discretionary traders define and scan for this setup" (`uct_hve.py`, `uct_setups_common.py`). The
  "$3" matches Manrav's scan above. The 26-week variant is "a second trader's scan", not named.
- UCT's own TradingView volume tool ("Uncharted Volume", by the UCT member AtTheAsk; the scripts are test fixtures in
  `tests/fixtures/member/`): "HVE = highest volume in ALL recorded history for this symbol." and "HV1 = highest volume in
  the last ~1 year (252 trading days)." Version 2 (2026-09-12) caps "ever" at a member-set window, 2,500 bars (about ten
  years) by default. It flags a day that meets or exceeds the prior maximum (the app's detector needs strictly above). No
  direction or price condition.

### 3.10 Brian Shannon (Alphatrends; author of *Maximum Trading Gains With Anchored VWAP*)

(Whether he invented the anchored VWAP I did not verify; his page names the book as his.)
[Anchored VWAP / AVWAP explained](https://alphatrends.net/anchored-vwap/): "We can fix our anchor from meaningful market
events, not just fixed time periods." One of his examples "is anchored to a large price movement event." The owner's
AVWAP from the HVE day is an anchor of this kind (his ruling does not cite Shannon). Shannon gives no HVE rule.

### 3.11 Comparison table

| | Owner (UCT) | App detector `uct_hve` | Duncan (HVC) | TraderLion | Ameet Rai | Bonde (EP) | Qullamaggie (EP) |
|---|---|---|---|---|---|---|---|
| Volume | "dwarfs everything before it"; record; analysts encode 10x the 50-day or 2.5x the record | above the max of the prior 252 sessions (199 in production), at least 190 prior | the highest: HVE, HV1, HVIPO, HVQ/HVLE | HVE, HVIPO, HV1, HVLE (2024 post) | HVE best, then HV1, HVIPO, HVLE | typically 10x+; often the highest in history | massive at the open (a day's average in 15-20 minutes) |
| Direction | up close only (2026-10-23) | either; a down close is "bearish" | gap up (one gap-down example) | "a huge gap up" | not read | up | gap up 10%+ |
| Price move | none stated; kept charts +8% to +177% | none | over 10% | a huge gap (no number) | not read | 8%+ in one branch of his scan | gap 10%+ |
| Close | a low close in a huge range was cut; "a strong close is NOT required" (analyst's record, 2026-10-23) | labelled only (DCR 0.70) | DCR 75% ideal, 50% min | "a strong closing range" | not read | not stated | not stated |
| Location | "the start of a new story"; often beaten down | none | at or within 20% of highs; bottoms can work | not read | not read | neglect is good | not stated |
| Stock | "lesser known", not a mega-cap | close > $3 (plus a near-meaningless floor: last close $2+, $10,000 a day) | none | none | none | no analyst coverage does better; neglected, small | none |
| Excluded days | OPEX, month-end | none | none | none | none | none | none |
| Earnings | counts only if truly massive; else a PEG | any | earnings or major news | earnings or a news report | any | earnings EP | any catalyst |
| Entry | none ruled: "a major level to mark" | the HVE close | the HVC (day 1 close) | "Day 2" (details unverified: volume support, whole number, back over the HVC) | volume support first, HVC second | pre-market or at the open (his 2010 reply) | opening-range high on the gap day |
| Stop | not ruled; price may go under the HVC | the HVE low | 3-5% under the HVC, or a close under it | not read | not read | "the low of last 2 days before entry" (his reply); Deepvue's 9M summary: low of the day | low of the day, at most 1-1.5x ADR or ATR |
| Targets / trail | not ruled | 2R, 3R; none | 1/3 at 1R, 1/3 at 2R, rest vs the 10 EMA | not read | not read | "exits are in 4 parts with profit target of 20% plus" | not in this post |
| Drawing | ray at the HVC + AVWAP from the HVE day | a line at the HVC | none | none | none | none | none |

### 3.12 Where they disagree

1. **Rank or multiple.** TraderLion, Duncan, Ameet Rai and UCT's indicator define the volume by rank (ever, one year,
   since the IPO, since the last earnings). The owner's analysts use a multiple (10x); Bonde observes 10x as typical of
   big winners but his scan asks only 3x the 100-day average. The app uses a rank over
   about nine and a half months only. The owner's kept charts satisfy both, mostly: median 27x and 4.3x the old record.
2. **Ever or one year.** "HVE" literally means ever; the app's detector and the finder use up to 252 sessions. On his
   charts the all-history record separates kept from cut far better (16 of 19 kept vs 5 of 16 cut; section 4.3).
3. **Gap and price move.** Duncan and TraderLion want a gap day (Duncan over 10%); the owner ruled "any up day". ERAS
   (good) gapped 2.8% and FUN (good) 0.5%.
4. **Location.** Duncan prefers new highs or within 20% of them; the owner's best examples are often far below their highs
   (median 26% off the 52-week high; NAVN 60%, RUM 57%).
5. **The entry.** The app and Duncan buy the HVC on day 1. Bonde, the EP's originator, buys the event day at the open.
   Ameet Rai calls the HVC a secondary entry. TSDR and Manrav buy on day 2 against the HVC; TraderLion names a "Day 2"
   setup (its day-2 details are unverified). The owner's playbook says "The edge is a level, not a buy signal"
   (`setupPlaybooks.js`).
6. **Is a close under the HVC a failure?** Duncan: a close under it is an exit. Manrav: the HVC is the stop. The owner:
   "they can go below the HVC that is fine." The data side with the owner (98% trade under the HVC within 60 sessions,
   section 4.3).
7. **Down-close record days.** The app reads them as bearish; Duncan's BROS and Bracco's TEM, IGV and ETHU notes read
   them as possible bottoms; the data side with the bottom reading (section 4.3 d). Campbell, Grossman and Wang's model
   points the same way, but it is about next-day returns of indexes and large stocks, not a 20-session test.
8. **Climax or start.** Wyckoff and Bracco warn that a record or near-record day after a long run is a climax. None of the
   HVE teachers I could read says how to tell them apart.

---

## 4. Measured evidence

### 4.1 Published statistics

No published test of the HVE or HVC setup as a trade was found. What exists:

- **Gervais, Kaniel and Mingelgrin (2001)**, *Journal of Finance* 56(3), 877-919
  ([abstract](https://ideas.repec.org/a/bla/jfinan/v56y2001i3p877-919.html); [author page](https://sites.duke.edu/sgervais/?p=64)).
  Stocks with unusually high volume over a day or a week rose more over the following month (quote in section 1).
  "Return autocorrelations, firm announcements, market risk, and liquidity do not seem to explain our results." The
  design, read in the December 1998 working paper (Rodney L. White Center 001-99,
  [PDF](https://rodneywhitecenter.wharton.upenn.edu/wp-content/uploads/2014/04/9901.pdf); the published version I did
  not see): NYSE stocks from CRSP, August 1963 to December 1996, cut into 50-day intervals; a stock is "high volume" when
  the last day's dollar volume is "among the top (bottom) 10% daily volumes over the whole trading interval"; returns are
  measured over the next 1, 10 and 20 trading days. Stocks whose price fell under $5 in the interval's first 49 days,
  with under a year of NYSE history, or whose firm had "a merger, a delisting, partial liquidation, or a seasoned equity
  offerings during, or within one year prior to, that trading interval" were dropped. Limits: the top 10% of 50 days is far milder than a 10x record; a monthly
  return, not a level; no stops; seasoned NYSE stocks only, the opposite of a young, little-known name.
- **Kaniel, Ozoguz and Starks (2012)**, *Journal of Financial Economics* 103(2), 255-279
  ([abstract](https://ideas.repec.org/a/eee/jfinec/v103y2012i2p255-279.html)): "We examine the high volume return premium
  across 41 different countries and find it to be a phenomenon found in both developed and emerging markets." Abstract
  only.
- **Barber and Odean (2008)**, *Review of Financial Studies* 21(2), 785-818
  ([abstract](https://ideas.repec.org/a/oup/rfinst/v21y2008i2p785-818.html)): who buys after an attention event (quote in
  section 1). A mechanism, not a return test of this setup.
- **Campbell, Grossman and Wang (1993)**, *Quarterly Journal of Economics* 108(4), 905-939
  ([abstract](https://ideas.repec.org/a/oup/qjecon/v108y1993i4p905-939..html)): "The model implies that a stock price
  decline on a high-volume day is more likely than a stock price decline on a low-volume day to be associated with an
  increase in the expected stock return." Its scope, in the same abstract: "This paper investigates the relationship
  between aggregate stock market trading volume and the serial correlation of daily stock returns", for "stock indexes and
  individual large stocks". Relevant in direction to down-close record days (the app calls them bearish), but it is a
  model of next-day returns, not a test of record days.
- **Llorente, Michaely, Saar and Wang (2002)**, *Review of Financial Studies* 15(4), 1005-1047
  ([abstract](https://ideas.repec.org/a/oup/rfinst/v15y2002i4p1005-1047.html)): "returns generated by risk-sharing trades
  tend to reverse themselves, while returns generated by speculative trades tend to continue themselves." In plain words:
  a big-volume move driven by trading on private information (speculative trades) tends to continue; one driven by
  hedging or risk-sharing trades tends to reverse. (NYSE and AMEX stocks, daily returns.)
- **Bulkowski, "Volume Study"** ([thepatternsite.com/VolumeStudy.html](https://thepatternsite.com/VolumeStudy.html), read
  twice through a fetch tool because the site refuses plain downloads; same numbers both times, and again in the cold
  check). About 8,000 ("I looked over 8,000 chart patterns") rectangles
  and double and triple tops and bottoms, July 1991 to May 2011, breakout-day volume against the prior 31 calendar days.
  Upward breakouts on above-average volume rose 37.6% vs 35.8% on below-average volume; 14% vs 5% failed to rise 10%;
  throwbacks came 57% vs 18% of the time. His summary: "Failures nearly triple after an above average volume breakout."
  Limits: chart-pattern breakouts on merely above-average volume, not records; his own trades' definitions. It does
  support one thing the owner said: after a heavy-volume day, price usually comes back. **The site states that it "shall
  not be used to train artificial intelligence (AI) systems"; I read and cite it with a link and short quotes only.**
- **Anecdotes, not statistics.** Duncan's examples (TWLO +165%, UPST +43% in 2 sessions, DXCM +55%, BROS +115%) and
  Ameet Rai's claim about "5 figure percent winners" are chosen winners. Bonde's line about earnings breakouts that make 100%
  moves is an observation about winners, not a test of all 10x days.

### 4.2 UCT's own measurements (in the repo, not published)

| file | sample | entry / stop | n | median risk | stop hit (60 sessions) | 1R / 2R / 3R | median best R |
|---|---|---|---:|---:|---:|---|---:|
| `docs/study/levels/evidence.md` | the bank's 56 Yes charts | HVE close / HVE low | 56 | 9.1% | 43% | 84% / 66% / 52% | 3.7 |
| `evidence_kept.md` | his 19 kept | HVE close / HVE low | 19 | 19.7% | 37% | 89% / 63% / 53% | 3.5 |
| same | same | HVE close / low, at most 3.5% | 19 | 3.5% | 89% | 79% / 53% / 42% | 2.3 |
| `evidence_atlas.md` | 512 deep-scan instances | HVE close / HVE low | 512 | 2.9% | 81% | 62% / 42% / 33% | 1.4 |

**A flaw in the atlas sample.** The deep scan (`scripts/study/bank_v2/scan_history.py`, `clean_window`) refuses any
instance whose 140-session window holds a one-day move over 40%, as a guard against unadjusted splits. The local bars are
split-adjusted (checked on NVDA, AAPL, TSLA and GE), and the HVE day itself is in that window. So the atlas throws out
every HVE that rose more than 40% on the day: 13 of his 19 kept charts, and at least 316 of the 2,181 owner-definition days
in my scan below. Its 2.9% median risk describes small-move record days, not his picture. `docs/study/bank_v2/ATLAS.md`
also records that the Bear gap fires on the same bar as an HVE 770 times; that count comes from the detector's down-close
side (section 5.4).

### 4.3 New measurements for this dossier (local daily bars, read-only)

Scripts and outputs are in the session scratchpad (`setups/24-high-volume-edge/tools/`). The bars are the workbench copy
of the app's bars database (`bars.db`, daily, 3,897 tickers, to 6 Nov 2026 at the time of the runs; split-adjusted; the
database has since been refreshed and now reaches 9 Nov 2026 with 4,284 tickers carrying daily bars; the cold check
re-measured the gallery on bars to 6 Nov and got the same numbers, and the second cold check recomputed every table in
this section from the saved gallery and scan records, with the same results). Same replay rules as the
launchpad dossier: the stop is not checked on the fill day; a day that opens under the stop exits at the open; stops sit
5 cents under the named low (F62). **The house plan** (simplified from the rulebook): breakeven once 2R trades (B19), a
third at 3R and a third at 5R, at the open if it gaps past (B19, E51, F63), after the first trim the rest sold on a close
under the 10-day EMA (E52, fast movers; the 21-day version is within a few hundredths of an R everywhere), under +1R at
the 10th close sold (C33), at most 120 sessions. "Best R" is the largest gain before the stop within 60 sessions.

The entries replayed:
- **A, the engine**: market order at the HVE close; stop under the HVE low. **A3**: same, stop capped at 3% (A13).
- **B, Manrav**: day 2 opens over the HVC; buy at the open; stop under the HVC. **B2**: same, stop under the HVE low.
- **C, TSDR (and TraderLion's PLTR post, unverified)**: day 2 opens at or under the HVC, trades under it and then back
  over it (red to green); market order a cent over the HVC; stop under the day-2 low. Daily bars cannot tell if the low
  came before or after the fill, so I give two numbers: optimistic (the low came first) and **conservative** (any reclaim
  day that closed back under the entry counts as a full loss).
- **D, the return that holds**: the first return to the HVC (after at least one close above it, the first later session
  whose low reaches it, as the Trade Story game defines it) whose close is back at or over the HVC; buy that close; stop
  under that day's low.
- **F, a later pullback that the rules allow**: sessions 3 to 40, the prior day closed no more than 3% under the HVC and
  no more than 10% over its 10-day EMA (C29); buy a cent over the prior day's high (skipped if the open is more than 4%
  over it, C28); stop under the prior day's low.

**(a) His 19 kept charts vs his 16 cuts** (the gallery; all 35 have local bars).

| measure on the HVE day | kept: median (range) | cut: median |
|---|---|---|
| day's gain | +50% (+8% to +177%) | +13% |
| gap at the open | +28% (+0.5% to +84%) | +7% |
| volume vs the 50-day average | 27x (4.4x to 649x) | 5.9x |
| volume vs the old record (up to 252 sessions) | 4.3x (1.1x to 12.5x) | 1.3x |
| all-history record in this data | 16 of 19 | 5 of 16 |
| DCR (close in the range) | 0.80 (0.35 to 0.97) | 0.83 |
| price | $13.11 ($5.17 to $174) | $172 |
| 50-day dollar volume before the day | $14.6M ($0.8M to $459M) | $315M |
| off the 52-week high (prior close) | -26% (-69% to -2%) | -9% |
| prior close above the 200-day SMA | 9 of 19 (5 below; 5 with no 200-day in this data) | 13 of 16 |
| HVE close above the 200-day (those with one) | 12 of 14 | 14 of 15 |
| stop a few cents under the HVE low, % of the close | 19.9% (2.6% to 36.7%) | 6.3% |
| close over the 10-day EMA | +41% (+8% to +113%) | +13% |
| the house finder's definition test accepts it (`facts()`: up close, record, 10x or 2.5x, no OPEX or month-end) | 17 of 19 | 4 of 16 |
| the app detector fires (local data) | 14 of 19 | 15 of 16 |

What separates them: the size of the day (gain, x50, edge ratio), the all-history record, and the kind of stock
(lesser-known: a median $15M a day before the event vs $315M). Not the close in the range. The detector fires on nearly
every cut (it fires on any year-high volume). The finder misses two kept charts, COMP (9.0x, 2.26x the old record) and
CPNG (4.4x, 1.31x). (The full finder adds more than this test: $5 and $5M a day, bars from 2019 on, and no 80%+
one-day move within the chart window, which alone would drop MRNA, +177%; NAVN and MRNA were added to pass 3 by hand as
references.) The detector's five misses: NAVN had only 100 sessions of history (the detector needs 190); VKTX, CPNG,
APLD and LIFE start late in this database (LIFE's local bars begin in January 2021 at about $4, so it had about 160
sessions; nothing here shows it was a new listing).

After the HVE day (kept charts): 18 of 19 traded under the HVC within 60 sessions; 7 of 19 traded under the HVE low (6
closed under it); 14 of 19 came back to the HVC by the Trade Story definition, a median 9.5 sessions later. After that
first return, with no time limit: a new high came before a break of the HVE low on 8 of the 14 (NAVN, RUM, WVE, EVGO,
VKTX, CLPT, INOD, and NTRS, whose new high took 43 sessions); the HVE low broke first on 5 (COMP, FUN, CPNG, CRBU, NTLA,
the last 58 sessions later); LIFE cannot be decided (its local bars stop in December 2021 and resume in January 2026,
apparently another listing under the same ticker). Within 40 sessions of the return, the new high came on 7.

The entries on his kept charts (chosen by him, and the pass-3 finder ranked charts that went on to rise higher, so these
flatter every entry):

| entry | n | median risk | stop hit | reached 3R | house plan, mean R | median R | winners |
|---|---:|---:|---:|---:|---:|---:|---:|
| A: HVE close / HVE low | 19 | 19.9% | 7 | 10 | +1.25 | +0.83 | 15 |
| A3: HVE close / 3% stop | 19 | 3.0% | 17 | 6 | +0.05 | -1.00 | 7 |
| B: day-2 open over the HVC / HVC | 6 | 1.3% | 5 | 3 | +9.66 (one +45.9R) | +0.89 | 3 |
| C: day-2 reclaim / day-2 low | 11 | 6.2% | 6 | 9 | +2.82 | +3.76 | 9 |
| D: the return that holds / its low | 11 | 4.7% | 8 | 4 | +0.47 | 0.00 | 5 |
| F: later pullback, rules allowed | 19 | 6.5% | - | 4 | -0.20 | -1.00 | 4 |

Row C is the optimistic version. Counting a reclaim day that closed back under the entry as a full loss (NAVN, WVE and
APLD did), C's mean on his kept charts is +2.68R.

**(b) The owner's definition on the whole universe** (the house finder's rule, unchanged: up close, a record of up to
252 sessions with at least 60 prior, 10x the 50-day or 2.5x the old record, no OPEX or month-end; $5 and $5M a day; every
stock in `api/data/cap_universe.json` with local bars, any year from 1985; one per stock per 60 sessions; NOT filtered for
working). The finder's own data guard (bars from 2019 on, no 80%+ one-day move) was replaced by the scan's: no gap of
more than 7 calendar days between bars within 60 sessions either side, and no one-day move over 60% on under twice the
50-day volume (a bad print or an unadjusted event). **2,181 instances.**

Profile: median gain only +8% (914 of 2,181 rose under 5%: not "a new story"), gap +2.8%, 14x the 50-day, 2.6x the old
record, DCR 0.70; 57% all-history records; 77% closed above the 200-day; 4% fell on the last Friday of June (index
reconstitution); 5% looked like acquisition pins (the next 20 sessions inside a 6% box, the 20-session return within 3%).
Afterward: 98% traded under the HVC within 60 sessions, 78% came back to it (median 5 sessions), 75% traded under the HVE
low (69% closed under it); 20-session return median -0.5%, 49% positive. Only 16% never closed under the HVC in the
first 20 sessions; those rose a median +24.7% at best within 60 sessions, the rest +10.1% (hindsight, but it is what
"holding the HVC" is worth).

| entry (all 2,181) | n | median risk | risk 3% or less | stop hit | 1R | 2R | 3R | 5R | house plan mean R | winners |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A: HVE close / HVE low | 2,181 | 4.5% | 36% | 75% | 47% | 32% | 23% | 13% | +0.04 | 33% |
| A3: 3% stop | 2,181 | 3.0% | 100% | 88% | 40% | 32% | 25% | 17% | -0.03 | 26% |
| B: day-2 open / HVC | 949 | 1.0% | 80% | 90% | 37% | 34% | 30% | 25% | -0.16 | 30% |
| B2: day-2 open / HVE low | 949 | 5.6% | 25% | 71% | 48% | 32% | 22% | 12% | +0.03 | 34% |
| C: day-2 reclaim (optimistic) | 805 | 2.3% | 60% | 84% | 53% | 44% | 37% | 27% | +0.60 | 36% |
| C: day-2 reclaim (conservative) | 804 | | | | | | | | **+0.37** | 29% |
| D: the return that holds | 888 | 2.1% | 65% | 87% | 44% | 32% | 25% | 17% | -0.07 | 26% |
| F: later pullback | 1,816 | 3.1% | 48% | | | | 23% | | -0.09 | 26% |

The same, on the subsets that look like his picture (house plan, mean R per trade; conservative C):

| subset | n | A (close / low) | A median risk | C conservative | B | after the first return, new high came first |
|---|---:|---:|---:|---:|---:|---:|
| all owner-definition days | 2,181 | +0.04 | 4.5% | +0.37 (804) | -0.16 | 47% (786 of 1,667) |
| day up 20% or more | 686 | +0.32 | 14.1% | +0.43 (242) | +0.91 | 55% |
| all-history record and up 20%+ | 440 | +0.49 | 15.4% | +0.50 (144) | +1.26 | 51% |
| same + HVE close over the 200-day, $10+, $20M a day after | 209 | +0.81 | 13.6% | +0.82 (64) | +1.83 | 51% |
| up 20%+, 10x+, DCR 0.5+ (*gallery-like*) | 486 | n/a | | +0.42 (184) | | 61% |
| gallery-like + over the 200-day, $10+, $20M a day after | 254 | n/a | | +0.64 (96) | | 62% |

Means with win rates near 30% to 40% are driven by a few big winners; B in particular swings from -0.21 (all-history
records up 20%+ with 10x and DCR 0.5+, 124 trades) to +1.83 between neighbouring subsets. Read the signs, not the decimals.

**(c) Baselines: is the record worth anything?**

| group | n | x50 | edge | A mean R | C conservative | 20-session return > 0 |
|---|---:|---:|---:|---:|---:|---:|
| owner definition | 2,181 | 14x | 2.6x | +0.04 | +0.37 | 49% |
| a year record under 10x and under 2.5x the old record (the kind he calls "just HVC"; the app detector also fires on these) | 12,361 | 4.3x | 1.18x | +0.07 | +0.30 | 54% |
| a strong day that is NOT a record (up 5%+, 3x+ volume, top-half close) | 14,665 | 3.8x | 0.55x | +0.05 | +0.27 | 52% |

On the plain close entry, the record adds nothing measurable. The day-2 reclaim is positive in every group, a little
better after a record. Where the record seems to matter is **extension**: day-2 reclaims more than 25% over the 10-day
EMA made +0.35R (conservative) after an owner-definition HVE (115 trades) but -0.30R after an ordinary strong day (125).
(Year records under his thresholds, the "just HVC" group, made +0.66R on 44 such trades, so on this measure it is the
record itself, not the 10x, that matters; small samples.)
And **after a long run** it hurts: when the stock had already risen 60% or more in the 60 sessions before, the 20-session
return was a median -5.7% (37% positive, 95 cases) against +0.3% (52%) after runs of 0-30%. That is Bracco's climax.

**(d) Down-close record days** (same thresholds, down close): 3,071. Median day -9.5%. 20 sessions later: median +1.1%,
55% positive (up-close HVEs: -0.5%, 49%). Within 10 sessions 44% closed back over the down day's high (55% within 20);
52% closed under its low within 10 sessions. Not bearish on average. (Campbell, Grossman and Wang's model points the
same way, for next-day returns of indexes and large stocks; it does not test this.)

**(e) Market and era.** With SPY over its 200-day (1,769): A +0.01, C +0.63 (optimistic). Under it (395): A +0.18, C
+0.48. Before 2010 (511, 1985-2009; the script labels this bucket "1995-2009" but it holds every year before 2010):
A -0.02, C +0.42; 2010-2026 (1,670): A +0.06, C +0.66. Earnings days where the cache knows
(166): A +0.20, C +0.87; non-earnings (831): A -0.02, C +0.49. No condition flips the sign of C.

**Limits of everything in 4.3.** Daily bars only; the order of moves inside a day is unknown (C, and any day that hit
both a target and a stop). Survivors only: stocks that delisted are missing, which flatters old years. Local history is
shorter than the real one for some names, so an all-history record means all history in this database. The earnings flag
covers only names in the cache. One instance per stock per 60 sessions per group. No commissions, slippage or borrow.
The finder's thresholds were tuned on his picks. None of this tests his eye: he picks the story, the stock and the
moment, and the mechanical tests above cannot see those.

---

## 5. Our app

### 5.1 The scanner: `api/services/pattern_engine/detectors/uct/uct_hve.py`

What it tests (with `uct_setups_common.hve_bar`):
- **Fires** on a session whose volume is above the maximum of the prior N sessions, N = min(252, the bars passed), with
  at least 190 prior sessions (`HVE_DETECTOR_MIN_PRIOR`), and a close above $3. Production's daily scan passes 200 bars
  (`registry.SCAN_BASE_DEPTH`), so in production N is 199 (about nine and a half months); the code says so and reports
  the lookback it used. A shared liquidity gate also applies (`liquidity_floor`: last close $2 or more and a 20-day average
  of $10,000 a day), low enough to change nothing here.
- **A side effect in production:** with only 200 bars passed, the "all the data on file" record (`ever_in_data`) is the
  same test as the 199-session record, so every production firing carries that label, earns its 10 score points, and
  tells the member "It is also the highest volume in all the data on file", while seeing nine and a half months.
- **The 50-day multiple shown to members includes the day itself** (`S["v50"]` is a 50-day average ending on the HVE
  day), so it reads lower than the x50 in this dossier (prior 50 days): NAVN's 12.9x would show about 10x, LIFE's 649x
  about 47x.
- **Direction follows the bar**: an up close is bullish with the stop at the bar's low; a down close is "bearish" with
  the stop at the bar's high. Entry, in both cases, is the HVC.
- **Labels only** (never a reason to fire): `hve_252` (a full 252-session record), `hve_26wk` (volume at least the max
  of the prior 130 sessions, over 250,000 shares, an up close; "a second trader's scan"), `ever_in_data`, `high_close`
  (DCR 0.70 or more).
- Reported only if it fired in the last 3 sessions (`MAX_TRIGGER_AGE`) and no later bar traded through the stop.
- **Levels** (`make_levels`): entry the HVC, stop the bar's low (or high), targets 2R and 3R. A horizontal line is drawn
  at the HVC to the newest bar.
- **Score**: geometry 70 plus points for a high close, an all-data record, a full 252 lookback and the 26-week label;
  volume by the 50-day multiple; context by trend stage. The confidence floor is 50, but the lowest possible score is
  53.5 (0.40 x 70 + 0.25 x 40 + 0.20 x 40 + 0.15 x 50), so **the floor never removes an HVE**.
- **The narrative** tells the member: the HVC "becomes a reference level"; follow-ups "within roughly 25 sessions" (a day-2
  open above, an undercut reclaimed the same day, a reclaim from below, a pullback that tests and holds); a dip "that
  undercuts it by no more than about half an ATR and closes back above is a classic entry"; "the first return to them,
  often weeks later, is usually the cleanest decision point"; and "Edge bars driven by an acquisition announcement -
  after which the stock pins in a tiny range near the deal price - are not trading signals at all and should be ignored."

The member catalog (`api/routers/patterns.py`) describes it as "A session whose volume is the highest in roughly the last
10-12 months of daily data, close above $3."

### 5.2 Other places the app defines it

- **The study finder** `scripts/study/find_hve_examples.py` (the owner's definition, 2026-10-25): up close, a record of the
  available lookback (at least 60 sessions, so young IPOs count), 10x the 50-day or 2.5x the old record, no OPEX (third
  Friday) or month-end, close $5+, $5M a day (averaged over 120 sessions ending on the day); only bars from 2019 on, and
  no chart window with a one-day move over 80% (so MRNA's +177% day could not pass; it and NAVN were added by hand as
  references); ranked by a score that includes how far it rose afterward. Its docstring calls it "pass 4"; the verdict
  log calls the review it fed "pass 3".
- **The chart drawings** `app/src/pages/study/hveOverlay.js`: a gold dashed ray at the HVC and an anchored VWAP from the
  HVE bar, on the reveal and on the review screen (his 2026-10-25 ruling).
- **The plain rules** `app/src/pages/study/studyPlainRules.js` (not yet approved): "An up day on huge volume: about ten
  times normal and a new record, often a lesser-known name starting a new story." Then mark the close; "Price can trade
  under it later; the level still matters." Not it: "an ordinary high-volume close, an earnings gap on big but ordinary
  volume, or an options-expiry or month-end day."
- **The trade plan** `api/services/study_trade.py` and `docs/study/TRADE_PLANS.md`: entry the HVC, stop the edge bar's low
  (its high on a down close), targets 2R and 3R, "the first return to the high-volume close, often weeks later, is the
  cleanest decision point" (`study_trade.py`; TRADE_PLANS.md's table drops "often weeks later"), trail "not named by the
  detector".
- **The Trade Story game** `app/src/pages/study/challenges/games/tradeStory.js`: stops at the first return and asks; the
  call is `HVE_RETURN_CALL = null` until he rules, and nothing is scored there.

### 5.3 The Model Book card and the journal tags

- Card (`setupCatalog.js`): family "Gaps & Catalysts", direction long, the essence quoted in section 1, a glyph with a
  pivot line at the big candle's close.
- Playbook (`setupPlaybooks.js`): context "Usually a lesser-known stock where a new story arrives all at once"; criteria
  "Volume ten times the 50-day average and well above the prior record, an up close, and a close in the upper part of the
  day's range"; entry "The edge is a level, not a buy signal: mark the HVE close with a ray and run an AVWAP from the
  edge day; trades are taken on the setups that form around that level later."; stop "For a position taken on the edge
  day itself, the bar's low. The HVE close is not the stop"; four named mistakes (an HVC called an HVE, a PEG called an
  HVE, an OPEX or month-end day, erasing the level when price trades under it).
- Journal tags (`setupGroups.js`): "HVC" is in the Swing list; there is no "High Volume Edge" tag.

### 5.4 Where the app disagrees with the sources or looks wrong

1. **The detector fires on down closes.** He ruled HVE long only (2026-10-23). The data (section 4.3 d), Campbell,
   Grossman and Wang, Duncan's BROS and UCT's own TEM and IGV notes all say a down-close record day is not bearish on
   average. Calling it "bearish" with a stop at its high teaches the wrong lesson. (Flagged before in the 2026-10-25
   analysis; still in the code.)
2. **It fires on what he calls "just HVC".** Any year-high volume qualifies. In my scan, for every owner-definition day there were
   about six year records under 10x and under 2.5x the old record (12,361 vs 2,181; one per stock per 60 sessions per
   group, so the ratio is rough). He cut 13 of 16 detector-picked charts.
3. **It is not "ever".** Production sees 199 sessions, yet labels every firing "the highest volume in all the data on
   file" (section 5.1). The name HVE, TraderLion's labels and UCT's own volume tool mean the all-history (or ten-year)
   record, and that is what separated his kept charts from his cuts.
4. **It cannot see young listings.** The 190-session minimum hides an IPO's first nine months; his "perfect" NAVN had 100.
5. **No OPEX or month-end exclusion**, against his ruling. No index-reconstitution or acquisition-pin exclusion either
   (the narrative warns about pins but the code does not test for them).
6. **No price move or close test.** 914 of 2,181 owner-definition days rose under 5%; none of his kept charts rose under 8%.
7. **The close entry fights the rulebook.** On his kept charts the stop under the HVE low is a median 19.9% (A13 says
   about 3%) and the close is a median 41% over the 10-day EMA (C29 says skip over 10%).
8. **Targets 2R and 3R** predate the rulebook (B19, E51: a third at 3R and 5R). The trade plan should follow the rulebook.
9. **The score is decoration**: the confidence floor can never be reached from below.
10. **Unsourced numbers in the narrative**: "half an ATR", "roughly 25 sessions", "often weeks later". I found no source for
    them, and the data say the first return is usually within a week (median 5 sessions in the universe; 9.5 on his
    kept charts).
11. **The catalog says "roughly the last 10-12 months"**; production uses 199 sessions.
12. **The journal has only "HVC"**, the thing he says an HVE is not. A member who trades an HVE must tag it as an HVC.
13. **A KB attribution looks wrong.** KB 7057 tags the WULF note (the HVC held for several sessions; let the 20 EMA guide
    the position) to Bracco and dates it 2025-09-07; the Substack post (2025-09-14) prints it under "Charts Covered", the
    part the house manifest (`docs/wisdom/PROGRAM-MANIFEST.md`) files under TSDR's Weekly Outlook & Watchlist (section
    6.2). The levels dossier repeats the Bracco attribution.
14. **The deep-scan atlas guard** drops every HVE day over +40% (section 4.2), so the atlas's HVE numbers are not his
    setup.

---

## 6. UCT's own words

All Substack posts below are public. I searched all 103 posts in the sitemap on 2026-11-09 for HVE, HVC, "high volume
close", "highest volume" and "High Volume Edge": 111 paragraphs in 65 posts. Sunday Scans carry the byline "Uncharted
Territory"; the house treats the intro, "TSDR's Weekly Outlook & Watchlist" and "Charts Covered" as the owner's own
writing, and "Bracco's Breakdown & Top Ideas" as Bracco's. "The Rest of the Week" posts are signed by section; the signer
is named below. Prices are as written in the post.

### 6.1 The owner's verdicts and rulings
Section 3.1.

### 6.2 The owner (TSDR) on the Substack

| date | ticker | words | link |
|---|---|---|---|
| 2025-06-08 | PL | "Highest Volume Ever (HVE) on earnings day followed up by inside day on Friday. $5.96 is HVE trigger for the trade." | [sunday-scans](https://unchartedterritoryy.substack.com/p/sunday-scans) |
| 2025-07-20 | LCID | "Thursday was LCID’s HVE (Highest Volume Ever) day. The close of that candle is $3.12. If we see Lucid hold $3.00 and $2.85 and push through $3.12 then I think this can really push higher." | [sunday-scans-c82](https://unchartedterritoryy.substack.com/p/sunday-scans-c82) |
| 2025-08-03 | BE | "Earnings gap down was bought aggressively at the HVC (High Volume Close). In at $33.7 and looking for the hourly to build out further and tighten. Would be willing to add with stop below ER low." | [sunday-scans-726](https://unchartedterritoryy.substack.com/p/sunday-scans-726) |
| 2025-09-14 | WULF | "Held the HVC (High Volume Close) for multiple sessions and build a perfect high tight flag." Then: "Nothing to do but let 20EMA guide the position." | [sunday-scans-461](https://unchartedterritoryy.substack.com/p/sunday-scans-461) |
| 2025-10-26 | NBIS | "Again, such as NBIS off the 50SMA, HVE level at $95.72, down 8 days in a row." Before it: "You can easily capture 10-15-20% moves in stocks off these spots." | [sunday-scans-13e](https://unchartedterritoryy.substack.com/p/sunday-scans-13e) |
| 2025-11-09 | PUMP | "Pretty straight forward flag following the HVE (highest volume ever). Long on a tap and hold of the 9EMA and through the HVE at $11.08." | [sunday-scans-720](https://unchartedterritoryy.substack.com/p/sunday-scans-720) |
| 2025-11-12 | PUMP (signed TSDR Trading) | "Simple HTF on daily with the HVE (Highest Volume Ever) close at $11.08. Over that is a long to $14 and $16." | [the-rest-of-the-week-045](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-045) |
| 2026-01-11 | AEVA | "Followed by two inside days above the 200SMA with lower wicks and then explosion again on Friday through the highs and the AVWAP from it’s peak in June." Then: "Remember, stocks with HVE, HVC, and recent headlines are very very worthy of watch. You will get away with more and get rewarded more." | [sunday-scans-0b3](https://unchartedterritoryy.substack.com/p/sunday-scans-0b3) |
| 2026-02-25 | FSLY (signed TSDR Trading) | "Fastly had an impressive move on day 1 and day 2 post earnings. This was it’s highest volume ever and has garnered significant attention, rightfully so." | [the-rest-of-the-week-b24](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b24) |
| 2026-03-08 | DELL | "If we get to $148 and close above the HVC where this will show strength and trigger a bit more momentum, then we are already green with $6 when that triggers." | [sunday-scans-dcf](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf) |
| 2026-03-15 | YOU | "Trading below the HVC at $46.50." Then: "What I like to see is a hold, slight push higher, then hourly higher low to give a clear area to risk against and a presence of buyers." | [sunday-scans-af4](https://unchartedterritoryy.substack.com/p/sunday-scans-af4) |
| 2026-03-22 | FSLY | "A strong name then as an earnings gapper pulled into the HVC and the MAs. Bought with tight risk and let the trade play out." | [sunday-scans-cab](https://unchartedterritoryy.substack.com/p/sunday-scans-cab) |
| 2026-03-29 | FSLY | "The power of the HVC!" | [sunday-scans-352](https://unchartedterritoryy.substack.com/p/sunday-scans-352) |
| 2026-04-01 | NAVN (signed TSDR Trading) | "More importantly, HVE at $13.11 with support in the $12 range." | [the-rest-of-the-week-13b](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-13b) |
| 2026-04-05 | DELL | "Then pushed through the HVC pulled back and held the HVC as support! Very clean spot at $148." | [sunday-scans-356](https://unchartedterritoryy.substack.com/p/sunday-scans-356) |
| 2026-04-19 | LWLG | "The HVC (High Volume Close) is a very real edge in the market." | [sunday-scans-33a](https://unchartedterritoryy.substack.com/p/sunday-scans-33a) |
| 2026-04-19 | NAVN | "See how a stock completely resets and becomes a new stock after an HVE and earnings gap up like this. Especially one that is unknown, neglected, or beaten down." | same |
| 2026-04-26 | NEXA | "Pulling back into the HVE level and a bit orderly of a flag here. Can get an Oops Reversal signal to buy as early as this week." | [sunday-scans-f2d](https://unchartedterritoryy.substack.com/p/sunday-scans-f2d) |
| 2026-05-17 | INOD | "Gave a very nice entry opportunity on Friday as it was showing relative strength and a nice little oops reversal setup against the HVC at $85." | [sunday-scans-679](https://unchartedterritoryy.substack.com/p/sunday-scans-679) |
| 2026-05-24 | VELO | "Speculative and thin stock but made a significant move on their earnings, putting in its HVE at $21. Followed by four days of pullback into the 20 EMA and that gap support just below $16." | [sunday-scans-ffb](https://unchartedterritoryy.substack.com/p/sunday-scans-ffb) |
| 2026-06-21 | UMAC | "With the HVE (Highest Volume Ever), gap support, and the 20EMA with a strong hammer close this is worth of risk to Thursday’s low imo." | [sunday-scans-bc0](https://unchartedterritoryy.substack.com/p/sunday-scans-bc0) |
| 2026-07-12 | BFLY | "High Volume Edge. Multiple ER Gappers." Then: "Things like FSLY NAVN APPS BLZE recently." | [sunday-scans-898](https://unchartedterritoryy.substack.com/p/sunday-scans-898) |
| 2026-08-30 | BFLY | "Stopped on Wednesday, tried again through the HVC on Thursday and stopped by EOD. Not broken per se but not ready." | [sunday-scans-d40](https://unchartedterritoryy.substack.com/p/sunday-scans-d40) |
| 2026-10-11 | PENG | "HVE, ER Gapper and RS. That’s trader speak for Highest Volume Ever, Earnings Gapper, Relative Strength." | [sunday-scans-31b](https://unchartedterritoryy.substack.com/p/sunday-scans-31b) |
| 2025-11-02 | (about Manrav) | "If there is a Launchpad, Slingshot, HVC edge, or Oops Reversal he will be slapping it." | [sunday-scans-b99](https://unchartedterritoryy.substack.com/p/sunday-scans-b99) |
| 2025-08-24 | ZETA | "Love the volume pattern here and if this can take out the HVC (high volume close) at $20.23 then I think this can really kick into gear." | [sunday-scans-ffa](https://unchartedterritoryy.substack.com/p/sunday-scans-ffa) |

**Checked on the bars** (`tools/uct_examples.py`): the levels he names are the closes of the record days. PL 2025-06-05
closed at $5.96 (18x, 2.8x the old record, an all-history record); NAVN 2026-03-26 at $13.11; NBIS 2025-09-09 at $95.72;
PUMP 2025-10-29 at $11.10 ($11.08 in the post); INOD 2026-05-08 at $84.89 ("$85"); BFLY 2026-06-18 at $8.90; LAC
2025-09-24 at $6.01 (an HVC he named in 2026-01). Two things this shows:
- **In his own writing, "HVE" means a record, not 10x.** NBIS (7.4x, 1.5x the old record), PUMP (9.1x, 1.39x), VELO
  (6.8x, 1.3x) and APLD 2025-06-02 (7.0x, 1.6x; Manrav's "Highest Vol Ever Close (10.14)") are called HVEs but fail the
  finder's 10x / 2.5x test. BFLY 2026-06-18 was 0.94x the prior-year maximum on these bars, so not even a one-year record
  here.
- **"HVC" is used for big closes whether or not they are records**: QBTS 2025-05-08 (4.2x, 0.88x the old record, so not
  a record; "$10.42 HVC (High Volume Close)" on his chart, KB 11364), OSCR 2025-05-07 (6.4x, 1.68x: a one-year record
  below his thresholds), ZETA 2025-08-06 (5.6x, 1.04x: a bare record). That fits his "Just a PEG and HVC. Not a real
  HVE".

**What his trades show.** He rarely buys the HVE close. He buys day 2 through the HVC (QBTS), a reclaim of an earnings HVC
(OSCR), or a later pullback or Oops at the level (NAVN, INOD, NEXA, UMAC, PUMP), with the stop under that day's low. He
trims into the first days of the move and trails the 20 EMA (WULF, FSLY). He gets stopped too (BFLY).

His desk logs (Discord, as stored in the repo's KB; his own words where quoted):
- 2024-08-28 (KB 14459), on why: "Marked by like stupid volume HVE (highest volume ever) or 52 week volume highs. You can
  make mistakes and still win"
- 2025-05-13 (KB 10089): "OSCR reclaiming 17 is the HVC (high volume colse from earnings. 16.20 as stop, but prepared to
  rebuy as that would be 9 ema and 20 sma."
- 2025-05-22 (KB 10097; the excerpt does not name the stock, but its "$10.42 the HVC" and day-2 low of 9.83 match QBTS's
  8-9 May 2025 bars, and KB 11364 names QBTS's "$10.42 HVC"): "Let's assume a r/g entry through the HVC of $10.45 and
  risk to LOD at 9.83. Let's give it a few pennies below so place stop at $9.80"
- 2025-07-26 (KB 10146): "COUR did its Highest Volume Ever (HVE) and has room to $17. Planning on breakeven stop but
  havent moved it yet from $10.98."
- 2025-08-26 (KB 10171): "Trimmed portion of WULF into day 3 move a week ago. No moving averages have caught up and holding
  the HVE spot." And: "taking 1-2% losses then letting nice winners like this play out."
- 2025-11-29 (KB 10252): "WIll be looking for this to push highs and $350 then trail the 20EMA for as long as it lets me."
- 2026-01-14 (KB 12270, summary): he shared Ameet Rai's AEVA breakdown: the stock pulled back to its HVE level for two
  sessions, held, and ran from $15 to $20.
- 2026-09-30 (KB 12911, summary): what to watch on high-volume names: the AVWAP from the high-volume day, the moving
  averages, the HVC, round numbers and gap supports, "the juice on the high volume stuff."

### 6.3 Bracco

| date | ticker | words | link |
|---|---|---|---|
| 2025-06-08 | TEM | "On 5/28, it was down -19% on it’s highest volume ever. It then recovered the entire move only 3 sessions later… Immediately added to the focus list and hunted for an entry." | [sunday-scans](https://unchartedterritoryy.substack.com/p/sunday-scans) |
| 2025-09-21 | OKLO | "The big difference between the two is that on May 23rd it was breaking out of a base with a huge catalyst, which suggested the start of a move." Then: "When you see that signifigant of a volume spike after a massive move up, it likely signals exhaustion or climax behavior." | [sunday-scans-88a](https://unchartedterritoryy.substack.com/p/sunday-scans-88a) |
| 2025-11-05 | ETHU (signed Bracco) | "Today, ETHU (Ethereum 2x ETF) traded its highest volume ever while ETHA traded its 2nd highest volume ever." Then: "Think potential rubber band / capitulation long setup here for a short term trade opportunity." | [the-rest-of-the-week-9c9](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9) |
| 2026-02-04 | IGV (signed Bracco) | "IGV traded it highest volume in its 26-year history today on its 6th consecutive down day and 4th consecutive down weak." (a mean-reversion long idea) | [the-rest-of-the-week-732](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-732) |
| 2025-06-13 | (The Parabolic Short) | On the climax day: "the climax day almost invariably showing the highest opening volume of the entire run." | [the-parabolic-short](https://unchartedterritoryy.substack.com/p/the-parabolic-short) |

The OKLO note is the clearest rule anyone in the house wrote for telling a starting HVE from a climax: the same stock, a
record at a base breakout with a catalyst (start) vs a near-record after 80% in seven days and 200% over the 200-day (end).

### 6.4 The Rest of the Week, other signers

| date | signer | ticker | words | link |
|---|---|---|---|---|
| 2025-06-02 | unsigned ("Week Ahead") | SMR, NNE, OKLO, LTBR | "All 4 of these names put in their highest daily volume ever on that 5/23 move… That is not something to be ignored." Then: "Watching for U&R’s (undercut and rallies) at key pivots like 9EMA and HVC (high volume close) from 5/23 ignition day." | [week-ahead](https://unchartedterritoryy.substack.com/p/week-ahead) |
| 2025-10-01 | AMT | HOND | "A close above it’s HVC (highest volume close) and is now pressing the AVWAP from peak." | [the-rest-of-the-week](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week) |
| 2025-10-15 | ChartMaster | PATH | "After the HVE gap up has pulled back in to the 8ema. This looks like a tight risk spot." | [the-rest-of-the-week-39d](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-39d) |
| 2025-10-22 | ChartMaster | MDB | "HVE Weekly Earnings flag. Love the sideways action as the 8 week comes in to support the next move." | [the-rest-of-the-week-481](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-481) |
| 2025-10-29 | ChartMaster | MDB | "HVE Weekly earnings flag." | [the-rest-of-the-week-757](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-757) |
| 2025-11-12 | Manrav | LMND | "Watch for a push above the HV close to initiate a long/add to your position with 8 EMA stop." | [the-rest-of-the-week-045](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-045) |
| 2026-01-14 | Dark Oblivion | IREN | "AVWAP from HVE (Highest Volume Ever) gap from beginning of run, 30w and 65ema." | [the-rest-of-the-week-305](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305) |
| 2026-03-25 | ChartMaster | LASR | "Back to back HVE monthly candles and March has 5 trading sessions to go." | [the-rest-of-the-week-ecf](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-ecf) |

One writer, ChartMaster, also marks weekly and monthly HVE candles (MDB, LASR). The "Week Ahead" post carries no
signature (the byline of every post is "Uncharted Territory"); other dossiers also treat it as unsigned.

### 6.5 UCT traders in the brain (Discord, as stored in the repo's KB files)

Manrav: the day-2 rule and the undercut room (KB 11027, summary); "Anyone here understands what high volume close edge
is?" (KB 11820, his words); HVE closes as risk levels (KB 15651, summary: they do not always follow through at once, but
the HVE close is a good level to risk against); APLD's 2025-06-02 HVE, undercut and reclaimed the next day and up 52% in
four days (KB 13613, summary); his "! HVE" scan, "HVE and close > 3" (KB 11545, summary).

---

## 7. How it fits the account rulebook (`docs/study/sizing_rule.md` section 9)

| rule | what it says | fit with the HVE |
|---|---|---|
| B26 (hard) | no longs below the 200-day SMA (except parabolic longs) | **Partial conflict.** 5 of his 19 kept charts had the prior close under the 200-day (RUM, CLPT, VRDN, INOD, CRBU) and 5 had no 200-day in this data (NAVN was a young listing; VKTX, CPNG, APLD and LIFE start late here). Of the 14 with a 200-day, 12 closed the HVE day above it (RUM and CRBU did not), so a day-2 entry usually qualifies. Question 6. |
| B23 | $10+ and $20M+ a day | **Conflict.** 7 of 19 kept charts closed under $10 (RUM, EVGO, VKTX, ERAS, LIFE, CRBU, APLD). 12 of 19 traded under $20M a day before the event; only 1 of 19 (INOD) under $20M in the 20 days after. He exempted HVE from the bank's liquidity cut (2026-11-07). Question 5. |
| C31 | leaders, RS 80+ (except parabolic and mean reversion) | **Likely conflict.** His HVEs are often "unknown, neglected, or beaten down" before the day (median 26% off the 52-week high). Not measured (no RS history here). Question 6. |
| A3, F62 | stop a few cents under the day's low or the prior day's low | Fits the day-2 entry (under the day-2 low) and later entries. Under the HVE day's own low it is huge. |
| A13 | stops usually within about 3% | **Conflict for the close entry**: median 19.9% on his kept charts; capping it at 3% gets stopped 88% of the time. The day-2 reclaim: median 2.3% overall, but 5-7% on days up 20%+ (25% of those within 3%). Question 4. |
| A5, A7 | size from the stop; full size at one price; max 40% | A 6% stop at 1% risk = a 17% position. Fine. Rules out adding (TSDR added to WULF and AEVA in his posts). |
| E57 | market orders | The day-2 trigger is a market order the moment price trades a cent over the HVC. |
| C28 | no chasing more than 4% past the buy point | The buy point is the HVC: no buy more than 4% over it. A day 2 that opens 4%+ over the HVC is not a buy. |
| C29 | skip a long more than 10% over its 10-day average | **Conflict.** The HVE close sits a median 41% over the 10-day EMA on his kept charts (16 of 19 more than 10% over); 97% of owner-definition days up 20%+ close more than 10% over it; day-2 reclaims on big HVEs are a median 24-28% over. The data say extension hurts ordinary strong days but not record days (section 4.3 c). Question 3. |
| B19, E51, E52 | a third at 3R, a third at 5R, trail the rest under the 10-day (fast) or 21-day; breakeven at 2R to 5R | Fits; HVE names are fast movers, so the 10-day. TSDR trails the 20 EMA in his posts. Question 10. |
| B20 | a gap through the stop: the first 30-minute low is the new stop; out past 2R | Applies. HVE names gap often. |
| B22 | no new buys in the 3 days before earnings | Applies to later entries. An earnings HVE falls just after a report, so the next one is weeks away; where the cache knows the dates, 17% of owner-definition days were earnings days. |
| C33 | under 1R after 10 trading days: sell | Applies. 78% come back to the HVC within 60 sessions; a trade that goes nowhere for 10 days is out. |
| C34 | a climax run on your own long: sell a big part into it | Fits Bracco's OKLO point. |
| D42 | never own more than 1% of a stock's average daily volume | Matters for "lesser-known" names; measure it on the post-event average. |
| D47 | shorts are the long setups reversed | **No mirror** (section 8.6). |
| B18, F65 | the market filter | No HVE-specific condition found (section 4.3 e). |
| E50 | grading is his judgment; no fixed checklist | Section 9 gives cues, not a checklist. |

---

## 8. Proposed rules for our course

Every line is measurable from daily bars unless it says otherwise. Thresholds marked *his kept charts* come from section
4.3 (a). Where sources disagree, the options and my recommendation follow the line.

### 8.1 What it is (the HVE day)

- **Volume: a record.** Higher than every session in the stock's history, or since the IPO for a stock listed under a
  year. At least higher than the prior 252 sessions. [source consensus: TraderLion, Duncan, Ameet Rai, UCT's indicator;
  his kept charts 19 of 19 above the prior-year record, 16 of 19 all-history]
- **Volume: it dwarfs the past.** About 10x the 50-day average or more (his great charts 12.7x to 46.5x), or at least
  2.5x the old record. [UCT, the analysts' encoding of "dwarfs"; originator (of the Episodic Pivot): Bonde's "typically
  of 10 times or more", said of earnings breakouts that went on to 100% moves]
  Options: (a) 10x OR 2.5x the record (the finder; misses COMP and CPNG); (b) a record only, any multiple (his own
  Substack usage: NBIS 7.4x, PUMP 9.1x); (c) 10x AND an all-history record (the strictest; four of his five greats pass,
  RUM was a one-year record on these bars). **Recommend (a) as the rule and (c) as the A+ cue**: (a) is the encoding his
  pass 3 was drawn with (he kept 15 of 18), and (c) is what most of his best charts share. His own words fix no number.
- **Direction: an up close** (close over the prior close). [UCT ruling 2026-10-23]
- **The move: up at least 8% on the day.** [my proposal; his kept minimum is +8.0%, NTRS] Up 20% or more is the A+ cue
  (all five "great" charts rose 33% to 177%). [my proposal from his kept charts] Duncan says over 10%. [outside: Duncan]
- **The close: in the upper half of the day's range (DCR 0.5 or more); 0.7 or more preferred.** [source consensus on a
  strong close: Duncan (50% floor, 75% ideal) and TraderLion ("a strong closing range"); the numbers are Duncan's; his
  cuts of TVTX at 0.18 and DYN at 0.38] But he kept CRBU at 0.35 ("okay") and COMP at 0.41 ("good"), and the 2026-10-23
  record says "a strong close is NOT required" (the analyst's words), so this is a grade cue, not a hard line. [UCT]
- **The story: a fresh catalyst** (a contract, a trial result, a partnership, a government stake, an IPO-year re-rating,
  or earnings so big the volume is extreme). [UCT] Earnings on ordinary big volume is a PEG, not an HVE. [UCT ruling]
  Not measurable from bars: a judgment on the news.
- **The stock: lesser-known.** Measurable stand-in: a 50-day dollar volume under about $100M a day before the event (15
  of 19 kept, 5 of 16 cut). [my proposal from his kept charts] Not a mega-cap. [UCT] Bonde says the same of earnings
  breakouts: "Earnings breakout on companies with significant analyst coverage do not do as well as the first kinds."
  [originator, Episodic Pivot]
- **Not these days:** the monthly options expiry (third Friday) and the last session of a month [UCT ruling]; the last
  Friday of June (index reconstitution) [my proposal: 4% of mechanical hits fall there; his cut RCL 2025-06-27 was that
  day]; an acquisition announcement (the next sessions pin in a tiny range) [the app's own narrative; my proposal to test
  it].
- **Not a climax.** Not after a run of 60% or more in the prior 60 sessions, and not on the third to fifth day of a
  straight-up burst. [UCT, Bracco's OKLO note and "The Parabolic Short"; Wyckoff's buying climax; measured: after 60%+
  runs the 20-session return was a median -5.7%]
- **Prior trend: none required.** The HVE is often the first day of a new story in a stock that was neglected or beaten
  down. [UCT; his kept charts a median 26% off the 52-week high]
- **Location vs the averages:** the trade (not the HVE day) must be above the 200-day SMA (B26). [house rule] No 10, 21 or
  50-day requirement. [my proposal; none found in any source]
- **Liquidity:** apply B23 to the trade, measured on the 20 sessions after the HVE rather than the 50 before. [my
  proposal; question 5] Keep D42 (1% of average daily volume). [house rule]
- **Mark the level:** a ray at the HVC and an anchored VWAP from the HVE day, kept on the chart for months. [UCT ruling
  2026-10-25; Shannon's anchor at a large price movement event]

### 8.2 The buy

Options, all measured in section 4.3:
- **A. The HVE close** (the app). Stops of 15-20% under the HVE low, 40% over the 10-day EMA. Mean +0.04R on all
  owner-definition days, +0.49R on all-history records up 20%+. Breaks A13 and C29.
- **B. Day 2 opens over the HVC** (Manrav), stop under the HVC: stopped 90% of the time; results swing on a few huge
  winners.
- **C. Day 2 red-to-green through the HVC** (TSDR's desk log; TraderLion's PLTR guide points the same way, unverified;
  Ameet Rai ranks the HVC a "secondary entry", without naming day 2): the best and steadiest entry in every group, +0.37R
  a trade (conservative) on all 804, +0.82R on the filtered set; on his kept charts +2.82R optimistic, +2.68R conservative.
- **D. Later setups at the level** (his Substack practice: Oops, a tap of the 9 or 20 EMA, a flag over the HVC). The two
  mechanical stand-ins (D and F) were flat. That does not mean his discretionary later entries are flat; it means the
  bars alone do not show their edge.

**Recommend C as the taught trigger, D as the taught follow-up**:
- **Trigger:** on day 2 (the session after the HVE), price opens at or under the HVC, trades under it and then back over
  it. [UCT: TSDR's desk log, KB 10097, on QBTS; TraderLion's PLTR post points the same way but its text past the first
  line is unverified, so this is not a source consensus] A day 2 that opens over the HVC and never trades under it is not
  a C trigger; it may become a later D entry. [my proposal]
- **Order:** a market order the moment price trades a cent over the HVC. [house rule E57]
- **No chase:** no buy more than 4% over the HVC. [house rule C28]
- **Later entries (D):** after day 2, the house's own setups at the level (an Oops Reversal or an undercut and rally at
  the HVC, a hold of the 9 or 20 EMA near the HVC, a tight flag over the HVC), each with its own trigger and stop.
  [UCT, his posts on NAVN, INOD, NEXA, UMAC, PUMP]

### 8.3 The stop

- **C:** a few cents under the day-2 low (the low made before the reclaim). [UCT, TSDR KB 10097; house rule A3, F62]
- **D:** the stop of the setup used (a few cents under that day's low or the prior day's low). [house rule A3]
- **Not the HVC itself**: price trades under it in 98% of cases within 60 sessions, and he says that is fine. [UCT
  ruling; measured]
- **Not the HVE low for a close entry**, unless he accepts a median 15-20% stop (question 4).
- **If the honest stop is wider than the plan allows, skip** (A3). How wide is too wide is his call (question 4); on days
  up 20%+, the C stop is a median 5.2% and 25% of them are within 3%.

### 8.4 Trims and trail (house defaults)

- Breakeven at 2R to 5R; a third at 3R; a third at 5R; at the open if it gaps past a level. [house rule B19, E51, F63]
- Trail the last third on a close under the **10-day** average (HVE names are fast movers). [house rule E52] TSDR's posts
  trail the 20 EMA (WULF; FSLY, "am trailing the 20EMA for now", 2026-03-22; KB 10252) [UCT]; Duncan trails the 10 EMA
  [outside: Duncan]. Question 10.
- Time stop: under 1R after 10 sessions, sell. [house rule C33]
- **At the first return to the HVC** (the open question): on his kept charts a new high came first 8 times in the 13
  that can be decided (NTRS's took 43 sessions; 7 within 40 sessions); on the *gallery-like* universe 61% (197 of 321); on
  all mechanical HVEs 47%. Holding the close-entry trade through the return averaged +0.05R to +0.35R across the stronger
  subsets (-0.08R on all owner-definition days). **Recommend: hold, with the stop where the plan put it.** [my proposal;
  question 7]

### 8.5 What invalidates it

- **For the trade:** the stop. [house rule A4]
- **For the level (stop treating it as support):** a close under the HVE day's low. [the app's stop line; my proposal]
  Within 60 sessions this happened on 6 of his 19 kept charts and 69% of mechanical HVEs (trading under it: 7 of 19 and
  75%), so it is common; after it, the HVC is overhead, not support.
- **Not an invalidation:** trading or closing under the HVC. [UCT ruling]
- **Before the trade:** day 2 never trades back over the HVC (no trigger); the day was OPEX or month-end; the move was an
  acquisition pin; the volume came after a long run (a climax).

### 8.6 The short mirror: none

He ruled HVE long only. The mirror image, a record-volume DOWN day, is not bearish on average: in 3,071 cases the median
20-session return was +1.1% (55% positive), 44% closed back over the down day's high within 10 sessions; Campbell,
Grossman and Wang's model points the same way (for next-day returns, not tested here). Bracco treats such days as
possible bottoms (TEM, IGV, ETHU), and Duncan shows one (BROS). **Recommend: no short mirror; teach the down-close
record day as a capitulation watch for a long, a different setup.** [my proposal; data; UCT] D47 does not apply here.

### 8.7 Best market conditions

- Follow the market filter. [house rule B18, F65] I found no HVE-specific condition: C stayed positive with SPY above and
  below its 200-day. [measured]
- A group or theme moving at the same time helps (an unsigned UCT note on four nuclear names that all set volume records
  on 23 May 2025, "Week Ahead", 2025-06-02: "the group will likely move in unison so makes our job a little easier").
  [UCT, author unknown] TraderLion adds "if the market holds up". [outside: TraderLion] Not measured.

### 8.8 Common mistakes

1. Calling any year-high volume an HVE (a 3x day on a mega-cap is an HVC). [UCT]
2. Calling an earnings gap on ordinary big volume an HVE (a PEG). [UCT]
3. Marking an OPEX, month-end or index-reconstitution day. [UCT; my proposal]
4. Buying the HVE close with a 3% stop: stopped 88% of the time. [measured]
5. Buying the HVE close with the HVE-low stop and full size: a 20% stop. [measured; A5]
6. Treating a close under the HVC as a failure and erasing the level. [UCT ruling]
7. Buying a record-volume day that comes after a 60%+ run (a climax). [UCT, Bracco; measured]
8. Shorting a down-close record day because the app called it bearish. [measured; section 5.4]
9. Chasing day 2 more than 4% over the HVC. [house rule C28]
10. Forgetting the level: the HVC and its AVWAP matter for months; later setups form there. [UCT]

---

## 9. Grading: what makes an A+ versus a B-

He said grading is discretionary (E50). These are observable cues from his verdicts and the sources, not a checklist.

| cue | A+ (his "perfect", "100% A+", "great") | B- (or cut) |
|---|---|---|
| volume | an all-history record (four of his five greats), 10x to 100x+ the 50-day; his greats ran 1.1x to 5.3x the old record | a one-year record at 3x to 6x; under the old record |
| the day | up 30%+ with a big gap | up under 10% |
| the close | upper part of the range (greats 0.59 to 0.96; FSLY, his "100% A+", 0.59) | lower half of a huge range (TVTX, DYN cut) |
| the story | a fresh, specific catalyst; a story that "resets" the stock | an index day, an expiry day, an ordinary earnings beat |
| the stock | lesser-known, small dollar volume before the day | a mega-cap or a well-owned large cap (AAPL, ASML, ORCL cut) |
| timing in the move | early in a new story (on WVE he preferred the second, larger surge, 16 sessions after the first) | after a long run (a climax) |
| after | holds near the HVC and builds a flag | slices back under the HVE low quickly |

**Ten model examples** (all graded by him; measured on the local bars; "first return" as the Trade Story game defines it):

| # | chart | his grade | day | gap | x50 | x old record | all-history | DCR | what followed (60 sessions) |
|---|---|---|---:|---:|---:|---:|---|---:|---|
| 1 | NAVN 2026-03-26 | great, "perfect" | +43% | +23% | 12.9x | 1.2x | yes (100 sessions old) | 0.80 | best +87%; came back on day 4, 8.8% under the HVC, then made a new high; HVE low held |
| 2 | FSLY 2026-02-12 (earnings) | great, "100% A+" | +72% | +45% | 27.4x | 5.3x | yes | 0.59 | best +117%; never came back to the HVC |
| 3 | MRNA 2026-08-19 | great | +177% | +84% | 27.5x | 4.1x | yes | 0.96 | best +53% on bars to 6 Nov (+61% with the 9 Nov bar added since); within 20 sessions closed as much as 23.5% under the HVC |
| 4 | RUM 2024-01-23 | great | +33% | +22% | 46.5x | 3.8x | no (one-year) | 0.72 | best +42%; came back on day 7, new high the next day |
| 5 | WVE 2024-10-16 | great (his second surge) | +74% | +41% | 12.7x | 1.1x | yes | 0.82 | best +12%; came back on day 3; HVE low broke within 60 |
| 6 | EVGO 2024-10-03 | good | +61% | +29% | 40.1x | 9.5x | yes | 0.90 | best +44%; came back on day 2, new high 3 sessions later; HVE low broke within 60 |
| 7 | VKTX 2022-12-19 | good | +74% | +36% | 111x | 9.9x | yes (short local history) | 0.87 | best +72%; came back on day 2, new high the next day |
| 8 | ERAS 2026-01-07 | good | +42% | +3% | 19.9x | 4.7x | yes | 0.52 | best +252%; never came back |
| 9 | CLPT 2025-09-24 | good | +59% | +34% | 35.1x | 3.0x | yes | 0.65 | best +56%; came back on day 2, new high the next day; HVE low broke within 60 |
| 10 | COMP 2026-01-07 | good (the analyst's grade, "assumed"), "sudden major increase" | +9% | +9% | 9.0x | 2.3x | yes | 0.41 | best +18%; came back on day 19, then the HVE low broke |

Counter-examples he cut: AAPL 2024-06-11 (+7%, 2.9x; "Not part of the high volume edge"), ASML 2024-01-24 (earnings,
8.8x, 2.7x; "Again, just a PEG"), LRCX 2025-12-19 (an expiry day), TVTX 2021-08-16 and DYN 2024-01-03 (big days that
closed low in the range), WVE 2024-09-24 (the first surge; he chose the second).

UCT-named examples verified on the bars (not graded by him in the bank): PL 2025-06-05, LAC 2025-09-24, AEVA 2026-01-06,
LWLG 2026-03-12, INOD 2026-05-08, BLZE 2026-05-05.

---

## 10. Questions for the owner

1. **The volume rule.** (a) 10x the 50-day OR 2.5x the old record (the finder; misses COMP and CPNG, which you kept);
   (b) any record, no multiple (your Substack usage: NBIS, PUMP, VELO); (c) 10x AND an all-history record (four of your
   five great charts; RUM was a one-year record). Recommend (a) as the rule and (c) as the A+ cue.
2. **"Ever" or "one year"?** The app looks back about nine and a half months. Your kept charts were all-history records
   16 times in 19. Should the course say highest volume ever (or since the IPO), with the one-year record as a lesser
   grade?
3. **C29 (10% over the 10-day).** Nearly every big HVE breaks it (97% of owner-definition days up 20%+; 16 of your 19
   kept charts closed more than 10% over it). Options: (a) an HVE exception for the day-2 entry
   only; (b) no exception: wait for later entries (D); (c) an exception for A+ HVEs only. The data favour (a): extension
   did not hurt day-2 entries after an HVE.
4. **The stop.** For the day-2 entry, under the day-2 low (median 2.3%; 5.2% on days up 20%+). Is there a ceiling? Options:
   (a) none, size from the stop (A5); (b) skip over a set percent (you name it); (c) cap at 3% (A13) and accept more
   stop-outs. And should the close entry with a 15-20% stop be taught at all?
5. **B23 ($10 and $20M a day).** 7 of your 19 kept charts closed under $10; 12 of 19 traded under $20M a day before the
   event, 1 of 19 after. Options: (a) B23 on the 20 days after the HVE; (b) waive the $10 floor for HVEs; (c) keep B23 as
   written and drop those charts from the course.
6. **B26 and C31.** Five of your kept charts started under the 200-day; young IPOs have none. Is the rule that the trade must
   be above the 200-day (most qualify by day 2), and is an IPO under a year old exempt? Does C31 (RS 80+) apply to a
   neglected stock on its HVE day?
7. **The call at the first return to the HVC** (the Trade Story game waits on this). Options: (a) hold with the plan's stop;
   (b) take some off; (c) sell the rest. Data: on your kept charts a new high came first 8 times in the 13 that can be
   decided; on HVEs like yours, 61%; on all mechanical ones, 47%. Recommend (a).
8. **Down-close record days.** The app calls them bearish. Options: (a) stop firing on down closes; (b) relabel them as a
   capitulation watch (a different setup); (c) leave as is. Recommend (a) for this setup and (b) as a separate idea.
9. **More excluded days.** Add the last Friday of June (index reconstitution) and acquisition announcements (a pin) to
   OPEX and month-end?
10. **The trail.** House default 10-day (fast movers), or the 20 EMA you use in your posts?
11. **The minimum move.** Up 8% (your kept minimum), 10% (Duncan), or 20% (all your greats)?
12. **The journal.** Add a "High Volume Edge" tag next to "HVC", or rename?
13. **The detector.** Change it to your definition (up close, record of the available history with at least 60 sessions,
    10x or 2.5x, no OPEX or month-end, a minimum move), or keep it as a broad "HVC" marker and let the course teach the
    narrower HVE?
14. **Weekly and monthly HVEs.** ChartMaster uses them (MDB weekly, LASR monthly). Part of this setup, or not?

---

## 11. Sources

All read on 2026-11-09 unless marked. Reliability: **originator** = the person or firm that named or teaches the setup;
**educator** = an established educator or data provider; **study** = peer-reviewed research; **secondary** = a summary
of someone else; **house** = UCT's own material.

**UCT (house)**
- Owner verdict log, `docs/study/audits/2026-10-24/owner_verdicts.jsonl`, lines 118-153 (HVE passes 2 and 3), 459
  (2026-11-07) and 534 (2026-11-09). House, primary.
- Owner rulings, `docs/study/corrections/spot.fixtures.jsonl`, lines 5, 21 and 22. House, primary.
- Account rulebook, `docs/study/sizing_rule.md` section 9. House, primary.
- `docs/study/TRADE_PLANS.md`; `docs/study/levels/dossiers/hve.md`; `docs/study/levels/external_research.md`;
  `docs/study/levels/evidence.md`, `evidence_kept.md`, `evidence_atlas.md`; `docs/study/bank_v2/ATLAS.md`;
  `docs/study/analysis/2026-10-25-setup-differentiation.md`; `docs/study/workbench/SESSION-MEMORY.md`;
  `docs/study/research/definitions.json`; `docs/wisdom/vocabulary/setup-vocabulary-v1.json`;
  `docs/superpowers/research/setups/setup_criteria.json` and `setup_sources.json`. House.
- Code: `api/services/pattern_engine/detectors/uct/uct_hve.py`, `uct_setups_common.py`; `api/routers/patterns.py`;
  `api/services/study_trade.py`; `scripts/study/find_hve_examples.py`; `scripts/study/bank_v2/scan_history.py`;
  `app/src/pages/study/hveOverlay.js`, `studyPlainRules.js`, `challenges/games/tradeStory.js`;
  `tests/fixtures/member/uncharted-volume.pine` and `uncharted-volume-v2.pine`; `docs/pine/uncharted-volume-v1-to-v2.md`.
  House.
- Model Book: `app/src/pages/modelbook/setupCatalog.js`, `setupPlaybooks.js`; journal tags
  `app/src/constants/setupGroups.js`. House.
- Brain KB files in the repo: `docs/study/levels/brain_kb_2026-11-06.json`, `brain_kb_rules_2026-11-06.json`,
  `brain_kb_cycle_2026-11-06.json` (rows 5355, 7057, 10089, 10097, 10146, 10171, 10252, 11027, 11364, 11545, 11820,
  12270, 12315, 12911, 13613, 14459, 15651, 18131). House; mostly summaries of Discord posts, with the trader's own words
  where quoted. All rows re-read in the cold check.
- `docs/wisdom/PROGRAM-MANIFEST.md` (which Sunday Scans sections are the owner's). House.
- UCT Substack, https://unchartedterritoryy.substack.com, all 103 posts in the sitemap (the sitemap re-checked
  2026-11-09: unchanged); posts quoted in section 6 are linked there. House, primary.
- Bracco, "The Parabolic Short", 13 Jun 2025, https://unchartedterritoryy.substack.com/p/the-parabolic-short. House.

**Outside**
- Greg Duncan, "Trading The High Volume Close Setup", Upside Unlimited (Substack), 2 Dec 2023,
  https://upsideunlimitednewsletter.com/p/trading-the-high-volume-close-setup. Outside trader-educator who publishes the
  setup in full (not shown to be its originator, section 2); read in full.
- Greg Duncan, "3 Trading Setups Every Trader Must Know", feather.blog, 27 Jan 2023,
  https://gregduncan.feather.blog/3-best-trading-setups. Same; read in full. Its list labels the one-year rank "(HVIPO)",
  a typo for HV1.
- Greg Duncan, X thread, 11 Dec 2022, https://x.com/GregDuncan_/status/1602015384093151232. First post only, through X's
  public embed.
- TraderLion, "TraderLion's Enhanced Volume", TradingView, 7 Feb 2021, updated 7 Apr 2022,
  https://www.tradingview.com/script/yzjhAo0E-TraderLion-s-Enhanced-Volume/. Educator; read in full.
- TraderLion, X post (PLTR), 6 Feb 2024, https://twitter.com/TraderLion/status/1754980182694277617. Educator; read
  through X's public embed (cut short); the rest seen only in a search result, marked as unverified.
- TraderLion, X post on volume patterns, 28 Oct 2024, https://x.com/TraderLion/status/1851022013168582699. Educator; the
  opening read through X's public embed, the full text through Thread Reader App's copy,
  https://threadreaderapp.com/thread/1851022013168582699.html (a third-party mirror; its opening matches the embed).
- TraderLion, lesson "Entering The High Volume Edge Setup", https://traderlion.com/lesson/entering-the-high-volume-edge-setup/
  and "3 Early Entry Techniques To Improve Win Rate",
  https://traderlion.com/trading-strategies/3-early-entry-techniques-to-improve-win-rate/, and "Finding Your Trading Edge:
  Proven Setups That Work", https://traderlion.com/technical-analysis/finding-your-trading-edge/ (a search summary says it
  gives a numeric screen; not read, no numbers used). **Not read** (HTTP 403 to every allowed tool, re-tried in the cold
  check). No wording used.
- TraderLion TikTok, video 7176050662612962602 (12 Dec 2022 by its ID). Title seen in a search result only; not read.
- Ameet Rai, X, 23 Mar 2023, https://x.com/AmeetRai/status/1638962498094133255 and 11 Oct 2024,
  https://x.com/AmeetRai/status/1844751959619682395. Trader; read through X's public embed (cut short). His TraderLion
  profile posts: not read (403).
- Pradeep Bonde, "What are Episodic Pivots and how to find them", Stockbee, 12 Feb 2010,
  https://stockbee.blogspot.com/2010/02/what-are-episodic-pivots-and-how-to.html. Originator (Episodic Pivot); read,
  including his own replies in the comments (22 Feb 2010 and 30 Sep 2010).
- Deepvue, "Pradeep Bonde: 4 Screens to Find Momentum Stocks", 21 Apr 2025,
  https://deepvue.com/screener/pradeep-bonde-screens/. Educator / data provider; secondary on Bonde.
- Kristjan Kullamagi, "How to master a setup: Episodic Pivots", 2 Nov 2021,
  https://qullamaggie.com/how-to-master-a-setup-episodic-pivots/ and "My 3 timeless setups that have made me tens of
  millions", 8 Jan 2021, https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/. Trader of the
  Episodic Pivot; read.
- Roman Bogomazov and Michael Lipsett, "The Wyckoff Method: A Tutorial", StockCharts ChartSchool,
  https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial.
  Educator (the Wyckoff school); read.
- Brian Shannon, "Anchored VWAP / AVWAP explained", Alphatrends, https://alphatrends.net/anchored-vwap/. Author of
  *Maximum Trading Gains With Anchored VWAP*, as his page states (whether he invented the method was not verified);
  read.
- Thomas Bulkowski, "Volume Study", https://thepatternsite.com/VolumeStudy.html. Measured statistics by the author; read
  twice through a fetch tool (the site refuses plain downloads). **The site states it "shall not be used to train
  artificial intelligence (AI) systems"**; cited with a link and short quotes only.
- Simon Gervais, Ron Kaniel and Dan Mingelgrin, "The High-Volume Return Premium", *Journal of Finance* 56(3), 877-919,
  2001, https://ideas.repec.org/a/bla/jfinan/v56y2001i3p877-919.html and https://sites.duke.edu/sgervais/?p=64. Study;
  abstract; the design read in the December 1998 working paper, Rodney L. White Center 001-99,
  https://rodneywhitecenter.wharton.upenn.edu/wp-content/uploads/2014/04/9901.pdf.
- Ron Kaniel, Arzu Ozoguz and Laura Starks, "The high volume return premium: Cross-country evidence", *Journal of
  Financial Economics* 103(2), 255-279, 2012, https://ideas.repec.org/a/eee/jfinec/v103y2012i2p255-279.html. Study;
  abstract only.
- Brad Barber and Terrance Odean, "All That Glitters: The Effect of Attention and News on the Buying Behavior of
  Individual and Institutional Investors", *Review of Financial Studies* 21(2), 785-818, 2008,
  https://ideas.repec.org/a/oup/rfinst/v21y2008i2p785-818.html. Study; abstract only.
- John Campbell, Sanford Grossman and Jiang Wang, "Trading Volume and Serial Correlation in Stock Returns", *Quarterly
  Journal of Economics* 108(4), 905-939, 1993, https://ideas.repec.org/a/oup/qjecon/v108y1993i4p905-939..html. Study;
  abstract only.
- Guillermo Llorente, Roni Michaely, Gideon Saar and Jiang Wang, "Dynamic Volume-Return Relation of Individual Stocks",
  *Review of Financial Studies* 15(4), 1005-1047, 2002, https://ideas.repec.org/a/oup/rfinst/v15y2002i4p1005-1047.html.
  Study; abstract only.

**Data**
- Local daily bars: the workbench copy of the app's `bars.db` (read-only), 3,897 tickers to 6 Nov 2026 at the time of
  the runs (since refreshed to 9 Nov 2026), split-adjusted (re-checked on NVDA, AAPL, TSLA and GE in the cold check). Universe: `api/data/cap_universe.json` names with local bars. Earnings dates:
  `docs/study/setups/earnings_dates_cache.json` (992 tickers). Scripts and outputs: session scratchpad
  `setups/24-high-volume-edge/` (`tools/hve_lib.py`, `gallery.py`, `scan.py`, `analyze.py`, `deeper.py`, `later.py`,
  `uct_examples.py`; `scan/analysis.txt`, `scan/deeper.txt`, `scan/later.txt`).

**Searched but not used:** a TradingView script of daily HVC levels (an indicator vendor; there HVC means High Volume
Candle); a third-party upload of a TraderLion PDF (not the publisher's copy; not opened).

---

## Corrected in checking (cold check, 2026-11-09)

Every quote in the first draft was found word for word on its page; these are the claims around them that were wrong
or loose, and what replaced them.

1. **Option (c) and "his greats pass"** (sections 8.1, 10): RUM, one of his five greats, was a one-year record, not an
   all-history record, on these bars. Now "four of his five greats".
2. **"(a) is his confirmed definition"** (8.1): the confirmed note reads "10x+ the 50-day average, well above the prior
   record"; the 10x-OR-2.5x is the analysts' encoding. Reworded.
3. **HOND's signer** (6.4, 2): the post signs it "AMT", not Dark Oblivion.
4. **"Two writers" use weekly and monthly HVE candles** (6.4, question 14): both MDB and LASR are ChartMaster's.
5. **"His nuclear group note"** (8.7): the "Week Ahead" post of 2025-06-02 is unsigned. Now attributed as unsigned.
6. **The WULF note's heading** (5.4 #13): it sits under "Charts Covered", which in that post follows the heading
   "TSDR's Weekly Outlook & Watchlist" (the house manifest files both under TSDR); Bracco's section ends before it. KB
   7057's date is also a week early. (The first cold check wrote that the TSDR heading was not in the post; the second
   check found it there, above "Charts Covered".)
7. **"HVC is used for big closes that are not records"** (6.2): OSCR (1.68x) and ZETA (1.04x) were records; only QBTS
   was not. Reworded, and the ZETA post (2025-08-24) added as its source.
8. **LIFE "a young listing"** (7, 4.3): its local bars start in January 2021 at about $4 and break off from December 2021
   to January 2026. Now "starts late in this data".
9. **"A new high came first on 9 of 14"** after the first return (4.3, 8.4, question 7): LIFE's "new high" came only
   after its four-year data gap. Now 8 of the 13 that can be decided (NTRS's after 43 sessions).
10. **"Holding through the return averaged +0.11R to +0.35R"** (8.4): the stronger subsets ran +0.05R to +0.35R; all
    owner-definition days -0.08R.
11. **"A close under the HVE low on 7 of 19 and 75%"** (8.5): those counts are for trading under it; closes under it
    were 6 of 19 and 69%.
12. **Kept-chart day-2 reclaim +2.82R** (4.3, 8.2): that is the optimistic count; the conservative one is +2.68R.
13. **Era bucket "1995-2009"** (4.3 e): the script's label; it holds every year before 2010 (1985-2009).
14. **Bonde's scan** (3.5, 3.11): it has two branches joined by OR; the 300%-of-100-day and 8% rule is one of them.
15. **Bonde's entry and stop** (3.11): the table gave Deepvue's summary as his; his own 2010 replies (pre-market or at
    the open; stop at the low of the last 2 days; exits in 4 parts) now lead.
16. **Ameet Rai's winners** (3.4, 4.1): his words are "All 5 figure percent winners", not "the biggest winners".
17. **What the letters mean** (2): Ameet Rai's posts as read do not spell out HVE or HVLE; the expansions are now
    credited to Duncan and TraderLion, and Moglen's "Close/Candle" variant of HVC is noted.
18. **Campbell, Grossman and Wang "predict exactly that"** (3.12, 4.3 d, 8.6): their model is about next-day returns of
    indexes and large stocks; now "points the same way".
19. **Llorente et al. in plain words** (4.1): "driven by news" / "forced trading" replaced by the abstract's speculative
    (private-information) vs risk-sharing trades.
20. **Grading cues** (9): the A+ close was "top third" but his "100% A+" FSLY closed at 0.59; "several times the old
    record" but NAVN and WVE were 1.2x and 1.1x; "a second, smaller record" as a B- cue, but on WVE he chose the second
    surge. All three reworded.
21. **C29 "every real HVE breaks it"** (question 3): 16 of his 19 kept charts; 97% of big owner-definition days.
22. **B22 "the HVE is usually just after earnings"** (7): 17% of owner-definition days with known dates were earnings
    days. Reworded.
23. **Day-2 trigger tagged [source consensus]** (8.2): TraderLion's day-2 details are unverified, so it rests on TSDR's
    desk log; tag changed to [UCT].
24. **Duncan tagged [originator]** (8.1, 8.4): the dossier itself finds his originator status unproven; new tag
    [outside: Duncan].
25. **The finder "accepts" 17 of 19** (4.3 a) is its definition test only; the full finder also needs bars from 2019
    on and no 80%+ one-day move (so MRNA could only be a hand-added reference). Stated.
26. **The universe scan's data guard** (4.3 b) differs from the finder's; now stated.
27. **MRNA's best gain** (9): +53% on bars to 6 Nov; the bars were refreshed after the run (+61% with 9 Nov). Noted.
28. **COMP's grade "good"** (3.1, 9) is the analyst's ("grade good assumed"). Noted.
29. **Section 1, Bracco's OKLO**: the late-run day was his second-highest volume ever, a near-record, not a record.

Second cold check (a third reader, 2026-11-09):

30. **The Gervais-Kaniel-Mingelgrin exclusions** (4.1): the working paper drops firms with "a merger, a delisting,
    partial liquidation, or a seasoned equity offerings", not a "secondary offering"; the $5 test is on the interval's
    first 49 days; returns are shown over 1, 10 and 20 trading days. Reworded with the paper's words.
31. **Correction 6 itself** (the WULF heading): the 2025-09-14 post does carry the heading "TSDR's Weekly Outlook &
    Watchlist", and "Charts Covered" sits inside it; the first check said the heading was absent. Reworded.
32. **Duncan's risk per trade** (3.3): "the house's 2026 research file" is `docs/superpowers/research/setups/
    setup_criteria.json`, whose `hvc.risk` entry reads "0.25-0.5% of the account, up to 0.75% when performing well";
    the file and its wording are now named. Neither number is in his two posts (re-checked).
33. **TraderLion's HVE sentence** (3.2) was cut mid-sentence; the rest ("However, this is a good spot to check to see if
    this volume is in fact the highest volume ever") is now quoted, and three paraphrases are replaced by the sources'
    own words: Duncan on bottoms and on the close-under-HVC exit, Kullamagi on the 1x-1.5x stop cap.
34. **The bars database** (4.3): the refreshed copy holds 4,284 tickers with daily bars (3,897 at the time of the runs);
    stated.

Checked and found right in the second pass, so nothing was changed: the TradingView release notes (7 Feb 2021 "HV" only;
9 Feb 2022 adds HVE, "changed syntax from HV to HV1", adds HVIPO); Bonde's comment dates (22 Feb 2010 8:52 AM, 30 Sep
2010 3:36 PM); the TikTok id's date (2022-12-12 UTC); the detector's 53.5 floor arithmetic (volume and context scores
floor at 40, history 50); `S["v50"]` including the day; the kept-chart stop of 19.9% (2.6% to 36.7%) as a share of the
close (the saved gallery's `stop_pct_low` column is the same distance as a share of the stop, 24.9% median, and is not
what the table uses); the PLTR bars (6 Feb 2024 close $21.87, record, 8.1x; 7 Feb open $21.60, low $21.38, close
$23.60); the post-event dollar volume of the 19 kept charts (only INOD under $20M); and every number in sections 4.3 (a)
to (e).

**Added in checking:** TraderLion's own 28 Oct 2024 definition (four volume ranks, a huge gap with a strong closing
range, "if the market holds up"); Bonde's own stop, exit and stock-selection words, including that earnings breakouts
on widely covered companies "do not do as well"; the design of the Gervais-Kaniel-Mingelgrin study from its working
paper; the owner's own retraction of BFLY as an example; the detector's liquidity gate, its production "all data on
file" label that is always on, and its 50-day multiple that includes the day itself; the unsigned Week Ahead note,
Bracco's ETHU note and ChartMaster's LASR and first MDB notes; the ZETA, YOU and FSLY-trail wording; the PLTR bars
check of TraderLion's unverified levels.

## Removed in checking

- Ameet Rai as a source for the expansions "Highest Volume Ever" and "since the last earnings": not in what could be read.
- Brian Shannon as "originator" of the anchored VWAP: not verified; he is named as the book's author instead.
- TraderLion as "the setup's best-known teacher": a judgment with no source; replaced by what is dated.
- "Duncan" as originator-level in the source list: unproven (section 2's own finding).
- The [source consensus] tag on the day-2 trigger, and [originator] on Duncan's rules (see corrections 23-24).
- LIFE as a young listing; LIFE as a "new high first" case (see corrections 8-9).
- "The HVE is usually just after earnings" (see correction 22).
- Second cold check: nothing removed; every quote, attribution and statistic was confirmed against its source, and the
  four loose claims (corrections 30-34) were fixed rather than cut.

## 12. Examples (from our data)

**The scan's rule** (section 8 as code, with the house rules; `_study-resume/scratchpad/setups/24-high-volume-edge/scan_hve.py`).
The HVE day: volume above every session of the prior 252 (a one-year record at least; an all-history record is recorded
as a flag), and either 10x or more the 50-day average volume (the 50 sessions before the day) or 2.5x or more the old
record (option (a)); an up close, up at least 8% over the prior close; not a climax (the close before the HVE under 60%
over the lowest low of the prior 60 sessions); not the monthly OPEX (third Friday), not the last session of a month, not
the last Friday of June. The close position in the range (DCR), the gap, the 50-day dollar volume before the day and the
distance from the 52-week high are recorded, not filtered. The trade, entry C: on day 2 the stock opens at or under the
HVC (the HVE close) and trades back over it; a market buy at the HVC plus one cent (E57; that order cannot breach the
chase limit C28); the stop two cents under the day-2 low, skipped if wider than 8% (the dossier's question 4; A13's
"about 3%" is reported, not enforced); the entry above the 200-day SMA (B26); price at least $10 and at least $20M a day
traded over the 20 sessions after the HVE (B23 measured after, as section 8.1 proposes). A supplement scanned the 136
liquid names with under 322 sessions of history (IPO-year names) with the record measured since listing (at least 60
sessions) and, because no 200-day exists yet, without the B26 test: 14 hits, among them NAVN 2026-03-26 (see the
failures). Earnings days are from `earnings_reaction_days` (Yahoo and SEC 8-K Item 2.02).

**Base rate.** 2,630 of 2,630 liquid names scanned (complete, 183 seconds) plus the 136-name IPO supplement: **193 hits**
(179 + 14) from 1999 to 2026 (2 in the 1990s, 34 in the 2000s, 72 in the 2010s, 85 in the 2020s). **48.2% reached 3R and
37.3% reached 5R** before the stop, within 60 sessions of the buy (the main scan alone: 179 hits, 49.7% and 38.5%).
Caveat: this is a fixed stop with no trims and no trail, so a trade that reached 5R and later fell back to the stop still
counts as stopped (78.8% of all hits were stopped at some point in the 60 sessions); the house plan would have trimmed at
3R and 5R, moved to breakeven and trailed the rest. The median stop is 2.2% of the entry and the median best excursion
2.8R. Because the stop is small, 3R is often only 3-7% over the buy and was reached the next session in most winners:
the R numbers run large, so a learner should read the percentage moves too. Subsets: stop within 3% (118 hits) 55.1% to
3R and 44.9% to 5R; an all-history record at 10x+ (85) 49.4% and 38.8%; DCR 0.5+ and up 20%+ (86) 47.7% and 39.5%;
50-day dollar volume under $100M before (168) 49.4% and 37.5%. None of these cues moved the rate much on this sample; the
tight stop did.

**The ten examples** (charts and the three phone sheets in `_study-resume/scratchpad/setups/24-high-volume-edge/final/`;
`examples.json` holds the numbers). "Report" says whether an earnings report is on file for the HVE day; where none is,
the day was a news day whose news is not in our data (the owner knows the stories; nothing here names them unverified).
"Before" is the close before the HVE against the 200-day SMA.

| # | ticker | HVE day | buy (day 2) | day / gap | vol x50 / x old record / all-history | DCR | $ vol before | buy (HVC) | stop | best R | why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | VRTX | 2012-05-07 | 2012-05-08 | +55% / +39% | 18.5x / 3.3x / yes | 0.91 | $86M | 58.12 | 57.54 (1.0%) | 13.5R | No report on file (its report was 2012-04-26). Before: 5% under the 200-day after a 13% slide. A 39% gap to an all-time volume record, a close at 0.91 of the range; day 2 dipped under the HVC and reclaimed. 5R in two sessions, the peak (+14%) on day 5, back under the HVC on day 14: the trade worked, and it teaches why the last third is trailed under the 10-day. |
| 2 | TVTX | 2015-03-18 | 2015-03-19 | +37% / +34% | 17.2x / 1.6x / yes | 0.98 | $4M | 20.17 | 19.89 (1.4%) | 48.4R | No report on file. The cleanest in the set: a $4M-a-day name in a quiet uptrend (25% over its 200-day), record volume, a close at 0.98 of the range, a one-day dip under the HVC and reclaim, then a stair-step to +70% (day 54) with the HVC never traded again. |
| 3 | AMRN | 2018-09-24 | 2018-09-25 | +315% / +249% | 45.1x / 12.7x / yes | 0.98 | $11M | 248.00 | 239.18 (3.6%) | 24.8R | No report on file. The extreme form: 45x the 50-day, 12.7x the old record, a 3.6% stop under the day-2 low; +88% at the peak on day 30, and the HVC never traded again in the window. Our bars show it at about $60 before the day and $248 after; check that price scale against the owner's charting platform before it is shown (a uniform adjustment leaves the multiples, DCR and R unchanged). |
| 4 | DOCU | 2019-09-06 | 2019-09-09 | +22% / +20% | 12.9x / 1.2x / yes | 0.68 | $98M | 56.27 | 55.53 (1.3%) | 22.6R | Earnings (report 2019-09-05 after the close) on extreme volume, an all-time record: the "earnings so big the volume is extreme" case that is an HVE, not a PEG. Before: 7% under the 200-day. Day 3 dipped 0.8% under the HVC and held above the stop; the HVC was never traded again, and the stock rose 30% by day 55. |
| 5 | NTLA | 2021-06-28 | 2021-06-29 | +50% / +58% | 17.2x / 6.6x / yes | 0.52 | $95M | 133.43 | 129.64 (2.8%) | 18.2R | No report on file. An all-time record at 6.6x the old one, from a stock already 59% over its 200-day. The close was only mid-range (0.52, the floor); the chart shows it as a long upper wick and a choppy flag. The day after the buy spiked 52% over the HVC (the 18R), then the stock sat on the HVC for two months and the fixed stop was hit inside the window. A B-plus close on an A-plus volume day: the trims, not the hold, paid. |
| 6 | MDGL | 2022-12-19 | 2022-12-20 | +268% / +218% | 26.8x / 7.2x / yes | 0.97 | $22M | 234.83 | 226.98 (3.3%) | 10.3R | No report on file. Before: 13% under the 200-day after a 23% slide. A 218% gap on a biotech that had done nothing for six months; day 2 opened under the HVC, reclaimed and closed strong. 5R in two sessions (the +34% peak on day 2), then a flag over the HVC that held into March (first trade under it on day 58, above the stop). A monster day whose follow-through was flat in percentage terms. |
| 7 | FCNCA | 2023-03-27 | 2023-03-28 | +54% / +49% | 12.2x / 3.6x / yes | 0.83 | $93M | 895.61 | 884.02 (1.3%) | 38.8R | No report on file. A lesser-known bank 24% under its 200-day after a 31% fall gaps 49% on an all-time record; day 2 dipped under the HVC and reclaimed. An orderly trend followed, +50% at day 36, with the HVC never traded again. A high price that passes every house rule. |
| 8 | INSM | 2024-05-28 | 2024-05-29 | +118% / +126% | 18.3x / 3.5x / yes | 0.64 | $47M | 48.06 | 45.83 (4.7%) | 14.5R | No report on file (its report was 2024-05-09). The textbook "neglected stock, fresh story" chart: a flat line for six months, 16% under its 200-day, then a 126% gap on 18x volume, an all-time record; the day-2 dip and reclaim gave a 4.7% stop; the HVC was never traded again and the stock added 68% by day 59. |
| 9 | GRPN | 2025-03-12 | 2025-03-13 | +43% / +25% | 12.2x / 1.1x / no | 0.92 | $10M | 13.98 | 13.40 (4.2%) | 33.1R | Earnings (report 2025-03-11 after the close): a 25% gap that kept running to +43% with a close at 0.92 of the range, in a $10M-a-day name 20% under its 200-day and 29% off its high. Only a one-year record at 1.1x the old one (the one example that fails the A+ cue), yet 5R in a week and +140% by day 60. |
| 10 | INOD | 2026-05-08 | 2026-05-11 | +86% / +60% | 18.7x / 2.3x / yes | 0.63 | $44M | 84.89 | 83.38 (1.8%) | 26.5R | Earnings (report 2026-05-07 after the close) on extreme volume, an all-time record; INOD is one of the names the owner's posts cite for later entries at an HVC (section 8.2; whether that post concerns this level is not checked here). Day 2 dipped 1.8% under the HVC and reclaimed; 5R in two sessions, +47% at the peak on day 17, then a full round trip under the HVC (day 30) and through the fixed stop: the clearest picture in the set of why the last third is trailed. |

Other hits that would also serve: ALNY 2024-06-24 (+34%, 15.7x, stop 1.1%, 26.6R, no report on file), COLM 2015-02-13
(earnings, +18%, 12.7x, stop 1.7%, 15.6R), SGRY 2026-10-26 (+48%, 25.5x, 5.5x the record, 26.4R; too recent to show the
follow-through on a chart), FSLY 2023-02-13 (+28%, 11.5x, 11.6R; no report on file for that day, the report came two
sessions later on 2023-02-15 and gapped the stock again). The same stock appears twice in the hits as FB and META
2013-07-25 (one event, two ticker records; a mega-cap at $899M a day, so not an example either way).

**Notable failures (in words).**
- **NAVN 2026-03-26, the owner's "perfect" HVE (section 9, example 1).** It did give the day-2 trigger (opened at 12.80
  under the 13.11 HVC and traded through it), but the day-2 low was 7.2% under the HVC, so the honest stop was 7.5%
  wide, past A13's "about 3%". Taken as the scan takes it, the stop was hit (the 8.8% undercut on day 4 that the owner's
  own note records) before the stock made a new high and ran 87%. The lesson is the dossier's own: when the day-2 stop
  is too wide, skip entry C and wait for a D entry at the level, which on NAVN came within days.
- **MBX 2025-09-22 (+100%, 62x the 50-day, 10x the old record, a close at 0.26 of the range).** A day-2 reclaim with a
  7.4% stop that never saw a cent of profit afterwards. A record day that closes in the bottom quarter of its range is a
  supply day dressed as an HVE; this is why section 8.1 keeps the DCR as a grade cue and section 9 cuts TVTX-2026 and DYN
  for the same thing.
- **KOD 2026-09-28 (+178%, 57x, all-time record, close 0.83) and PRTA 2022-09-28 (+88%, 27x, 6.3x the record, close
  0.90).** Both triggered, both reached 2.2-2.4R and then came back through the stop (7.0% and 4.3% wide). Two of the
  biggest days in the sample, with strong closes, failed in a way no cue in section 8 predicts: a reminder that the base
  rate is roughly a coin flip to 3R, that the breakeven move at 2R (B19) turns these into scratches, and that the trims,
  not the pick, make the setup pay.

**Data limits.** Daily bars only, so the day-2 "low before the reclaim" is the day-2 low (an intraday stop would be
tighter where the low came first and wrong where it came after the reclaim; the 5-minute bars cover only 2026-08-17 to
2026-11-06 and none of the ten). Prices are split-adjusted and the volume multiples are measured on the same adjusted
series, so a split inside the 252-session window would distort the record multiple (none of the ten had one). Earnings
dates are complete from about 2005, so all ten are classed with confidence; news days are marked "no report on file" and
the news itself is not identified from bars. The time budget was not exhausted: the scan completed.

## 13. Failures and near-misses (from our data)

Added 2026-11-10 from the same scan as section 12 (`scan_hve.py`, `final/hits.json`) and a one-gate-relaxed copy of it
(`near_scan.py`, `final/near_hits.json`: every candidate day on at least 5x the 50-day volume or over half the old record,
with each measurable gate recorded; kept when exactly one gate fails). Charts in
`_study-resume/scratchpad/setups/24-high-volume-edge/final/`: `fail_1..4_*.png` and the phone sheet `fail_1-4.png`,
`near_1..4_*.png` and `near_1-4.png`, and the confusable pair `pair_21-power-earnings-gap.png` (TVTX above LULU, the
tell from the card). Every number below is read off the bars. Buy = the HVC plus one cent on day 2; stop = two cents
under the day-2 low; "where it stopped" counts sessions after the buy day.

**Failures: valid by every gate, traded by the rules, stopped before 3R.** The dossier's named failures (NAVN, MBX, KOD,
PRTA) all carry day-2 stops wider than the card's 3% (hve.stop_width), so they are not shown here; these four pass it.

| # | Ticker | HVE day, buy day | Buy | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | QGEN | 2026-01-20, buy 2026-01-21 | 55.46 | 53.73 (3.1%) | 2 sessions after the buy (2026-01-23), 0.0R | +16.6% on 11.6x the 50-day, 2.8x the old record, close 0.80. Day 2 reclaimed the HVC but never cleared the HVE day's high (57.82); the stock slid to 38.80 inside 60 sessions, under the HVE day's low (46.07). The level turned into overhead. | hve.inv_level_fails |
| 2 | SE | 2023-03-07, buy 2023-03-08 | 80.07 | 77.24 (3.5%) | the next session (2023-03-09), 0.0R | +21.8% on 11.6x, an all-time record at 1.2x, close 0.89. A shake-out: 71.08 within 3 sessions, then a run to 88.84 on 04-04 (3R was 88.56) without a new day-2 trigger, then a full collapse to 56.05. The stop is the exit; a re-entry needs a new trigger (B21). | hve.after_entry_stop |
| 3 | YELP | 2018-08-09, buy 2018-08-10 | 48.34 | 47.52 (1.7%) | the next session (2018-08-13), 0.0R | An earnings HVE: +26.7% on 16.0x, 2.4x the old record, close 0.77. Day 2 closed 49.35 over the HVC; day 3 opened 49.56 and reversed to 46.94 through the stop; 43.77 by 08-22, just over the HVE day's low (43.51); 52.50 on 09-20, then the whole move was given back. | hve.after_entry_stop |
| 4 | NKTR | 2017-03-20, buy 2017-03-21 | 331.66 | 323.98 (2.3%) | 4 sessions after the buy (2017-03-27), after 2.3R on 03-22 | +42.6% on 11.8x, 1.2x the old record, close 0.94. The stop traded by 2 cents (low 322.50) on a day that closed at 350.70; the stock made 373.20 two days later. The breakeven move at 2R (B19) turns this into a scratch. Prices are split-adjusted (the 2024 reverse split), so the scale looks high. | hve.breakeven |

**Near-misses: look like an HVE, fail exactly one gate.**

| # | Ticker | Record day, day 2 | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | ROKU | 2019-05-09, day 2 2019-05-10 | hve.volume_multiple | 4.7x the 50-day and 1.17x the old record; the rule needs 10x or 2.5x. The rest passes: +28.1%, a one-year record, close 0.99, day 2 dipped 2.8% and reclaimed. | An earnings gap on big but ordinary volume in a well-owned ($773M a day) name: a Power Earnings Gap (setup 21). Taken as an HVE it was stopped at 0.0R. |
| 2 | GNRC | 2020-02-12, day 2 2020-02-13 | hve.min_move | up 3.2% on the day; the rule needs 8% or more close to close. The volume was 22.6x the 50-day, 4.2x the old record, an all-time record, close 0.82. | Volume without a move: a record print that moved the stock 3%. Not a setup; the stock fell 25% in the next month (the March 2020 break). |
| 3 | GPCR | 2025-12-08, day 2 2025-12-09 | hve.not_climax | the close before the record day was 72.5% over the lowest low of the prior 60 sessions; the rule says under 60%. +102.5% on 18.2x, 3.2x the old record, close 0.50. | A climax, not a start: day 2 opened 3% under the HVC, triggered, and the trade was stopped at 0.0R; the stock topped within two months. |
| 4 | NRG | 2017-07-12, day 2 2017-07-13 | hve.day2_dip | day 2 opened 2.1% over the HVC and its low stayed 1.7% over it; the rule needs an open at or under the HVC and a trade under it. +29.4% on 10.6x, 2.65x the old record, an all-time record, close 0.98. | A valid HVE day with no day-2 trigger. The chart may give a later entry at the level (section 8.2, entry D); it is not the taught trade. |

**What the failures have in common.** Three of the four were stopped within two sessions of the buy with no gain at
all, and the fourth gave back a 2.3R gain inside four sessions. The HVE days themselves look like the winners (11.6x to
16.0x the 50-day, closes 0.77 to 0.94, a day-2 dip and reclaim), so nothing on the record day told them apart; the stop
under the day-2 low is tight (1.7% to 3.5%), and the one or two sessions after the reclaim decide the trade. In two of
them (SE, NKTR) the stock went on to the 3R zone after the stop traded, which is the cost of a tight stop, not a reason
to widen it: the rulebook's answer is a new trigger (B21) and the breakeven move at 2R (B19). Only QGEN failed the way
the card's failure mode describes, with the HVC turning into overhead and the stock sliding under the HVE day's low.

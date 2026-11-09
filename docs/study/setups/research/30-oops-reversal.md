# Setup 30: Oops Reversal (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Where I could not
read a source, I say so and give no wording from it.

**How the quotes were checked.** Every quote is 40 words or fewer and copied from the page named next to it.
- **Checked word for word against a saved copy** (downloaded today and searched by a script): UCT's Substack (all 103
  post pages through the post API), the two X posts (through X's public oEmbed service), Larry Williams' own site
  (ireallytrade.com), the Wiley front matter of *Long-Term Secrets to Short-Term Trading* (1999 edition) and the Wiley
  table of contents and Chapter 1 excerpt of the 2011 second edition, Deepvue's knowledge base, Unger Academy,
  StockCharts, Wikipedia, and our own code and docs.
- **Could not read today** (the sites refused the download with HTTP 403): Nick Radge's two Oops posts on
  thechartist.com.au, both TraderLion pages by Richard Moglen, and the *Stocks & Commodities* article "Larry Williams And
  The OOPS Signal" on traders.com. What our repo's earlier research (`docs/study/levels/external_research.md`) says they
  contain is reported in sections 3 and 4, marked **not re-read today**, with no quote.
- **Not read at all:** Williams' books themselves (only the publisher's front matter, contents and Chapter 1), Connors and
  Raschke's *Street Smarts*, Oliver Kell's book, UCT's private Discord and members' videos.
- My web search allowance ran out early in this run (one search worked). Everything else came from pages I already knew
  or found by following links. Section 11 lists the gaps.

**Cold check (2026-11-09, a second reader).** Every quote in this file was opened again from a fresh download: all 35
Substack posts that use the word "oops" (103 posts in the sitemap; the one subscriber-only post, 2026-10-18, does not
use it in its preview), the section heading above each quote, both X posts (oEmbed), Williams' site, the three Wiley PDFs,
both Deepvue pages, Unger, StockCharts, Wikipedia, the public YouTube video, the owner's rulings and every code and doc
path. All quotes were found word for word. Fixes made in checking are listed in "Removed or corrected in checking" at the
end. New sources added: Deepvue's About page (Ameet Rai and Richard Moglen are Deepvue's co-founders, which matters for
how independent Deepvue, Moglen and Rai are from each other) and Michael C. Thomsett's 2018 article (a second telling of
the "Oops, we lost" story). Radge's posts, TraderLion and the *Stocks & Commodities* article still return HTTP 403.
Archived copies of Radge's posts and the S&C article exist on the Wayback Machine, but this session's permission system
refused reading them, so they stay unread.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** Larry Williams (through
his own pages, or through a named secondary source when that is all there is; the line says which); **[UCT]** the owner,
Bracco, Manrav or the Substack; **[house rule]** the account rulebook, `docs/study/sizing_rule.md` section 9;
**[measured]** our own test in section 4.4; **[my proposal]** my recommendation, for the owner to accept or change.

Terms. **Oops day**: the session being judged. **Prior day**: the session before it. **c1, l1, h1**: the prior day's
close, low and high. **Undercut**: the Oops day trades below l1. **Reclaim**: price trades back above a level it lost.
**Scanner Oops**: the owner's main version (open below c1, low below l1, close above c1; owner ruling 2026-10-23).
**Williams Oops**: opens below l1 and rallies back above it. **Super Oops**: any Oops that closes above h1 (owner ruling
2026-10-23). **R**: the risk on the trade (entry minus stop). **DCR**: where the day closed inside its range (0 = at the
low, 1 = at the high). **ATR**: average true range, 14 days. **RS**: relative strength rating.

---

## 1. What it is

An Oops Reversal is a day that opens weak, trades below the prior day's low so the breakdown looks real, and then
reverses and takes back the prior day's level (the prior low in Larry Williams' original, the prior close in our
scanner) before the day is over. The trade is a long bought as that level is reclaimed, with the stop under the Oops
day's low.

**Why it works (the psychology).** Each point names its source. None of it is a measured fact; section 4 has the numbers.
- **The open overreacts.** Deepvue: "This indicates traders realize an overreaction to the news, prompting a price
  reversal opposite to the gap." ([docs.deepvue.com](https://docs.deepvue.com/articles/deepvue-custom-indicators-technical-patterns))
  Unger Academy: gaps "more often than not, such gaps end up being false signals rather than a continuation of the
  trend." ([ungeracademy.com, 2025](https://ungeracademy.com/blog/we-tested-larry-williams-oops-pattern-the-results-might-surprise-you))
- **Williams put the open at the centre.** In his own words: "The opening price, as you will see later on, is the most
  important price of the day." (*Long-Term Secrets to Short-Term Trading*, 2nd ed., Wiley, December 2011, Chapter 1,
  publisher's excerpt.) That sentence is about bar charts in general, not about the Oops; linking it to the Oops is my
  reading: the Oops is a pattern about the open failing.
- **Who is trapped.** Ameet Rai (a co-founder of Deepvue, per Deepvue's About page; on X): "When a stock gaps down into
  support and immediately reclaims the previous day's low, the shorts get caught off guard." ([x.com, 2026-10-09](https://x.com/AmeetRai/status/2108618678950404120))
  Our own scanner's text says the same in more detail: "stops resting under an obvious low are triggered and late
  sellers commit, and then the selling dries up." (`uct_oops_reversal.py`, narrative.)
- **Who is buying.** My reasoning, not a source: holders who sold on the weak open, and buyers who wanted the stock at a
  support level, buy it back above the prior day's level. Their buying, plus shorts covering, turns the day. That is why
  location matters so much to the owner ("Location matters big time on these", owner ruling, LQDA, 2026-10-24): an
  undercut of an obvious support (a rising 21-day or 50-day line, a flag low, a double-bottom low) gathers the most
  stops and the most waiting buyers.
- **Why the name.** Deepvue says it was "Named for the common broker phrase “Oops, we lost,”" (same page). Michael C.
  Thomsett (SteadyOptions, 2018-10-06) tells the same story without a source: "It was named for the experience among
  traders, upon discovering, “Oops, we lost.”" ([steadyoptions.com](https://steadyoptions.com/articles/the-oops-signal-trade-r415/))
  The *Stocks & Commodities* article that may be the origin of that story was blocked, so I could not read Williams'
  own account. Unger Academy gives a different reading: "“Oops!” could be the typical reaction of a trader who sees the
  market open with a gap in the direction of the prevailing trend, only to witness an unexpected and sudden price
  reversal" (same Unger page). Neither is Williams' own wording that I could read.

## 2. Origin and naming

**Short answer: Larry Williams named and published the "Oops!" pattern. His own site dates it to 1981; Deepvue says 1979.
The written version I could verify is in *Long-Term Secrets to Short-Term Trading* (Wiley, copyright 1999), Chapter 7,
"Oops! This Is Not a Mistake".** The swing-trading name "Oops Reversal" is used by Deepvue, TraderLion and UCT (Deepvue
and TraderLion share people: Ameet Rai and Richard Moglen are Deepvue's co-founders, and Moglen writes for TraderLion).
I could not find who first used "Oops Reversal" or when.

| Name | Who | Where and when (verified) | What it covers |
|---|---|---|---|
| **Oops!** (the original) | Larry Williams | His site's "Trading Innovation" timeline: "NUMEROUS TRADING PATTERNS- 1981. OOPS! Fakeout, Delayed and Hidden OOPS!, Pinch and Paunch, etc." ([ireallytrade.com/innovation](https://www.ireallytrade.com/innovation/)). Book: *Long-Term Secrets to Short-Term Trading*, Wiley, "Copyright © 1999 by Larry Williams", ISBN 0-471-29722-4; Chapter 7 "Patterns to Profit" (p. 93), sections "Oops! This Is Not a Mistake" (p. 113) and "S&P Oops! Trading" (p. 119) ([Wiley front matter PDF](https://catalogimages.wiley.com/images/db/pdf/0471297224.pdf)). Second edition (Wiley, December 2011 per Wiley's product page; ISBN 978-0-470-91573-8): the same sections on pp. 145 and 151 ([Wiley contents PDF](https://catalogimages.wiley.com/images/db/pdf/9780470915738.toc.pdf)) | A gap open beyond the prior day's range that fails back through the prior day's extreme; mainly shown on futures |
| **Oops!** (date claim) | Deepvue | "In 1979, Larry Williams introduced the Oops Reversal trading method" ([docs.deepvue.com](https://docs.deepvue.com/articles/deepvue-custom-indicators-technical-patterns), page updated 2026-06-19) | Same; Deepvue gives no source for 1979 |
| **Fakeout, Delayed and Hidden OOPS!** | Larry Williams | Named on his site's 1981 line (above); not described there | Variants I could not read about. Their rules are unknown to me |
| **Oops Reversal** | Deepvue (a charting service) | Knowledge base, two pages (section 3.2) | The Williams pattern with a close condition |
| **Oops Reversal** | Richard Moglen, TraderLion (also a Deepvue co-founder, per Deepvue's About page) | "The Oops Reversal Entry Setup/Tactic" and a BE case study (Nov 2025); **blocked today**; our repo's earlier research says he credits Williams | A swing pullback entry in stocks |
| **"OOPS signal"** | Michael C. Thomsett, SteadyOptions (an options-education site), 2018-10-06 | [The "OOPS signal" trade](https://steadyoptions.com/articles/the-oops-signal-trade-r415/); credits Williams and repeats "Oops, we lost"; no source given | His rule is looser than everyone else's: "When the market opens lower than the previous day’s close, a trader places a buy-stop order above the previous day’s low price." Not used for any rule here |
| **Oops Reversal, Williams Oops, Super Oops** | UCT (the owner, Manrav, Bracco, the Substack) | Substack from 2025-06-08; owner's three-version ruling 2026-10-23 (`docs/study/corrections/spot.fixtures.jsonl`, ruling 6) | The owner's scanner version is the main one (section 6) |
| **Weekly / monthly Oops** | UCT | Substack, many posts (section 6) | The same bar logic on weekly or monthly candles |
| **Key Reversal Bar** | Deepvue | Opens below the prior low, closes above the prior HIGH (section 3.2) | Our Williams Oops that is also a Super Oops |
| **Bullish Reversal Bar** | Deepvue | Undercuts the prior low, closes above the prior CLOSE; no open condition (section 3.2) | Our scanner Oops without its open rule |

Close relatives (not the same setup, named so the course can tell them apart):
- **Turtle Soup** (Larry Connors and Linda Raschke, *Street Smarts*): a new 20-day low that fails back above the prior
  20-day low (section 3.6). It is a multi-week low, not yesterday's low, and it has no gap rule.
- **2B** (a name usually credited to Victor Sperandeo; not checked against his book for this dossier) and **U&R**
  (undercut and rally): a failed break of an older swing high or low, not of yesterday's range (the app's 2B card: "Price
  breaks a prior extreme, fails to follow through, and snaps back"). **Red to Green**: a reclaim of the prior close, with
  no undercut of the prior low needed (the plain meaning of the name; no app card defines it). UCT's
  glossary pairs "2B Reversal / Oops" (`docs/study/bank/recall.glossary.json`, from
  `docs/curriculum/uct_method_presenter_brief.json`): "Oops is the same trap arriving via a gap open."
- **Go Signal**: the owner ruled it an HOURLY signal "similar to the oops reversal or the UNR" (owner ruling 2026-10-27,
  `owner_verdicts.jsonl`). The Oops is the daily (or weekly) candle.
- **Kicker**: the mirror trap the other way round (a weak red day, then a gap UP through its high). One in-house note
  (private, not quoted here) links this kind of gap-up trap to Oliver Kell's book; I could not read Kell's book, so I do
  not know whether Kell uses the word "Oops".

## 3. Every definition, source by source

### 3.1 Larry Williams (the originator), what I could verify

I could not read the Oops chapter itself. What is verified:
- The book and the section exist, with the page numbers in section 2 (Wiley's own front matter, both editions).
- The same Chapter 7 also has his "Smash Day Patterns" (p. 101), "Specialists' Trap" (p. 108) and "A Vital Note--This
  Works on Shorter Time Frames as Well" (p. 113 in 1999; p. 141 in 2011). Chapter 11 is "When to Get Out of Your
  Trades" (p. 157, 1999). I cannot say what each contains.
- His general rules in the 2011 Chapter 1 excerpt: "The opening price, as you will see later on, is the most important
  price of the day." On where buy patterns work best: "The conceptual pattern for the best buying opportunity occurs
  when we are forming an intermediate-term low higher than the last intermediate-term low, telling us the
  intermediate-term trend is up." And on time frames (said of his market-structure buy signal, not of the Oops): "Keep
  in mind these could be five-minute, daily, monthly, or weekly bars: The same rules apply to each."

Williams' Oops rules as reported by others (not verified against the book):
- **Open**: below the prior day's LOW (a gap down beyond the whole prior range). Unger: "the current session opens with a
  gap down. This means the open must be lower than the previous session’s low". Deepvue: "the opening gap down is being
  bought up and passes the prior day’s low."
- **Trigger and entry**: intraday, as price rallies back to the prior low. Unger: "Once prices recover after the negative
  open and rise to reach the previous day’s low, the conditions for a long entry are met". So it is a buy stop at (or a
  tick above) the prior low, the same day only.
- **No close condition** in Unger or in Deepvue's "Technical Patterns" description (Deepvue's column definition in 3.2
  does add one: a close above the prior low). **No trend filter and no volume rule** in either.
- **Stop**: a money stop. Unger: "a classic monetary stop loss of €2,000" (their test setting; Radge, as recorded in section 3.4, also reports a dollar stop).
- **Exit**: Unger: "This rule closes the trade as soon as there’s an opening where the position is in profit, without
  staying in the market any longer." They call it "also well-known and often referenced by Larry Williams himself."
- **Market**: index futures in the book's "S&P Oops! Trading" section (title only verified).
- **Short side**: the mirror (open above the prior high, sell as it falls back to it). Unger tests both.

### 3.2 Deepvue knowledge base (educator / charting service)

Two pages, read today (both updated 2026-06-19).
- "Technical Patterns" ([link](https://docs.deepvue.com/articles/deepvue-custom-indicators-technical-patterns)):
  "In 1979, Larry Williams introduced the Oops Reversal trading method, which exploits market gaps that occur at the
  opening due to overnight reactions to news." "The Oops Reversal is triggered when the opening gap down is being bought
  up and passes the prior day’s low."
- "Technicals" ([link](https://docs.deepvue.com/articles/technical)), the column definitions:
  - **Oops Reversal**: "Candlestick pattern formed when price opens below the previous day’s low then reverses to close
    above the previous day’s low."
  - **Key Reversal Bar**: "Candlestick pattern formed when price opens below the previous day’s low then reverses to close
    above the previous day’s high."
  - **Bullish Reversal Bar**: "Candlestick pattern formed when the price undercuts below the previous day’s low, but then
    closes above the previous day’s close."
  - **Upside Reversal**: "Candlestick pattern where today’s low undercuts the previous day’s low and closes in the upper
    half of the daily range."
- No trend, volume, entry, stop or target rules.

### 3.3 Unger Academy (systematic futures educator; test of Williams' rules)

"We Tested Larry Williams’ Oops Pattern: The Results Might Surprise You" (the title uses a dash), Unger Academy,
published 2025-06-04, updated 2026-07-17 ([link](https://ungeracademy.com/blog/we-tested-larry-williams-oops-pattern-the-results-might-surprise-you)).
- **Long**: open below the prior low; enter when price rises back to the prior low (quotes in 3.1).
- **Short**: an open "higher than the previous session’s high"; enter when price drops back to the prior high.
- **Optional filter**: "trades are only allowed if the gap is sufficiently large. In this case, we’ve set a minimum
  threshold of 15 points." (DAX points.)
- **Exits**: the €2,000 money stop and the first profitable open.
- **Condition for the pattern to work**: "there needs to be a significant time gap between the previous session’s close
  and the next session’s open." My reading, not Unger's: US stocks still close overnight between regular sessions
  (extended-hours trading narrows that), while 23-hour futures barely do.
- Results: section 4.3.

### 3.4 Nick Radge, The Chartist (backtests citing the book) **not re-read today**

Both posts returned HTTP 403 today. Our earlier research file (`docs/study/levels/external_research.md`, section 2,
sources S2 and S3) recorded: Williams' entry is S&P 500 futures opening below the prior low and rallying back through it;
the book skipped Wednesday and Thursday signals (Radge treats that as data mining); the stop is always a dollar stop
(book p. 157, per Radge); the exit is the first profitable open, and a reverse on an opposite signal. I give no quote
because I could not see the pages.

### 3.5 Richard Moglen, TraderLion (a swing-trading educator) **not re-read today**

Both TraderLion pages returned HTTP 403 today. The earlier research file (source S5, itself "excerpt only") recorded:
Moglen credits Williams; he defines the Oops Reversal as a gap below the prior day's low that reverses; he calls it a
short-term pullback setup; the textbook entry is as it pushes through the prior day's low; the stop is the day's low,
often under 2% of risk; after a push of about 3% above the pivot he raises the stop to just under the pivot; his BE case
(Nov 2025) was an Oops at the 50-day line with about 4.3% risk. I cannot confirm any of it today. Note for weighing
him: Deepvue's About page lists "Richard Moglen Co-Founder" beside "Ameet Rai Co-Founder", so Moglen, Rai (3.7) and the
Deepvue knowledge base (3.2) are one group, not three independent voices. Deepvue is also a UCT partner (the Substack's
2026 headers: "ALL Uncharted Territory Members will get One FREE month of Deepvue Access!").

### 3.6 Connors and Raschke, Turtle Soup (a related failed-low setup), through StockCharts

Julius de Kempenaer, StockCharts, 2018-06-02, citing "Larry Connors and Linda Raschke in their book Street Smarts (1996)"
([link](https://articles.stockcharts.com/article/articles-rrg-2018-06-combining-relative-rotation-graphs-and-the-turtle-soup-setup/)).
I have not read the book; the article dates it 1996.
- "Today must make a new 20-day low - the lower the better"
- "The previous 20-day low must have occurred at least four trading sessions earlier."
- "After the market falls below the prior 20-day low, place an entry buy-stop slightly above the previous 20-day low.
  This entry stop is good for today only."
- "If the buy-stop is filled, immediately place an initial (Good Till Cancelled) stop just below today's low."
- "As the position becomes profitable, use a trailing stop to protect gains." Holding time: "some trades last a few
  hours while others last a few days."
It shares the Oops mechanics (an undercut of a known low, a same-day buy stop back above it, a stop under the day's low)
but the level is a 20-day low and there is no gap rule.

### 3.7 Ameet Rai (practitioner, on X; a Deepvue co-founder per Deepvue's About page)

([x.com, 2026-10-09](https://x.com/AmeetRai/status/2108618678950404120), read through X's oEmbed service; the post is
cut off after "I take that reversal quickly or…"). "I use Williams Oops reversals and opening range breakouts to catch
trapped traders on liquid momentum names like TSLA and ABNB." Criteria in his words: a gap down "into support" and an
immediate reclaim of "the previous day's low". The rest of the post (and its chart) I could not read, so I do not
know his full entry rule beyond "I take that reversal quickly or…".

### 3.8 UCT's house definitions (details and quotes in section 6)

- **The owner's ruling** (2026-10-23, `docs/study/corrections/spot.fixtures.jsonl` ruling 6, his words): "Scanner one
  but also let us have definitions and details for the others. The close above version would be a super oops reversal
  if it fully engulfs previous day after any version of the oops." Recorded action: Scanner Oops = open below the prior
  close, low below the prior low, close above the prior close (the main definition); Williams Oops = opens below the
  prior LOW and rallies back above it; Super Oops = any version that also closes above the prior HIGH.
- **The owner's location and quality rulings** (2026-10-24): the Oops comes at the end of an orderly drift (a flag, a
  wedge down, a double bottom, the end of a downtrend); no news gap the day before; no outsized red bar before it; the
  Oops day itself not news-sized; a red day before it preferred; clear, not subtle; the Oops-day low should not break
  afterwards (section 6.5).
- **The owner's checklist on the Substack** (2025-06-08, a weekly Oops on ACHR): open lower than the previous candle's
  close; low lower than its low; reclaim its low and its close; break its 50% level; engulf it.
- **The six-step list** (Substack, 2026-02-08, unsigned Index section; also the scanner's stage 1-6): open lower than
  the previous close; low lower than the previous low; reclaim the previous low; reclaim the previous close; reclaim 50%
  of the previous candle; take out the previous high.

### 3.9 Comparison table

| Source | Open | Undercut | Close condition | Trend / location | Volume | Entry | Stop | Exit / target | Time frame |
|---|---|---|---|---|---|---|---|---|---|
| Williams (via Unger, Deepvue; book unread) | below prior LOW | by the open itself | none | none stated | none | buy stop at the prior low, same day | money stop (dollar amount) | first profitable open | daily; futures |
| Deepvue "Oops Reversal" | below prior low | by the open | close above prior LOW | none | none | not given | not given | not given | daily |
| Deepvue "Key Reversal Bar" | below prior low | by the open | close above prior HIGH | none | none | not given | not given | not given | daily |
| Deepvue "Bullish Reversal Bar" | any | low below prior low | close above prior CLOSE | none | none | not given | not given | not given | daily |
| Unger Academy | below prior low (optional 15-point gap) | by the open | none | none | none | at the prior low | €2,000 | first profitable open | daily DAX futures |
| Radge (not re-read) | below prior low | by the open | none | none | none | back through the prior low | dollar stop | first profitable open; reverse | daily S&P futures |
| Moglen, TraderLion (not re-read) | gap below prior low | by the open | not recorded | a pullback, e.g. to the 50-day | not recorded | as it pushes through the prior low | day's low; raised after ~3% | not recorded | daily stocks |
| Thomsett, SteadyOptions (2018) | below prior CLOSE | not stated | none | none | none | buy stop "above the previous day’s low" | not given | not given | not stated |
| Turtle Soup (relative) | any | new 20-day low | none | none | none | buy stop just above the old 20-day low | just under today's low | trailing stop | daily |
| Ameet Rai | gap down "into support" | by the gap | not stated (he says it "immediately reclaims the previous day's low", an intraday event) | liquid momentum names | not stated | "I take that reversal quickly or…" (rest unread); he also uses opening-range breakouts | not stated | not stated | intraday/daily |
| **UCT scanner (owner's main)** | below prior CLOSE | low below prior low | close above prior CLOSE | end of an orderly drift into a buyable spot | not required | the prior close, reclaimed during the day (app) | the Oops day's low | app: 2R and 3R (house rules differ, section 7) | daily; also weekly, monthly |
| UCT Williams Oops | below prior LOW | by the open | rallies back above the prior low | same | not required | not ruled | not ruled | not ruled | daily |
| UCT Super Oops | any Oops | yes | close above prior HIGH | same | not required | the playbook: "the Super Oops close above the prior high" | Oops-day low | not ruled | daily |

### 3.10 Where the sources disagree

1. **How weak the open must be.** Williams (as reported), Deepvue, Unger, Radge and Moglen (the last two as recorded,
   not re-read): below the prior LOW. Thomsett (SteadyOptions, 2018) writes "below the previous day’s close", but gives
   no source and his rule does not hang together (it buys "above the previous day’s low" without saying the low was
   broken), so it does not count as support for the owner's version. The owner's scanner: below the prior CLOSE only,
   with the undercut coming later in the day. The owner's version fires on
   many more days (section 4.4: in liquid stocks, only 46% of scanner Oops days opened below the prior low).
2. **What must be reclaimed.** Williams and Deepvue: the prior LOW. The owner: the prior CLOSE (and, for the Super, the
   prior HIGH). Deepvue's "Bullish Reversal Bar" is closest to the owner's scanner.
3. **Close condition.** Williams has none (it is an intraday entry). Deepvue wants a close above the prior low. The owner
   wants a close above the prior close. Our app's code uses five different versions (section 5.5).
4. **Exit.** Williams: out at the first profitable open, a one-to-few-day trade. UCT: a swing trade, held days to weeks
   ("I look for minimum 3-7 day burst swing trades", owner, 2026-11-01). No outside source gives a swing trim or trail
   rule for the Oops; the earlier research file found none either.
5. **Stop.** Williams: a dollar stop. Everyone else who names one uses the day's low: Turtle Soup (a related setup, "just
   below today's low"), UCT's playbook, and Moglen as recorded in the earlier file (not re-read). No outside source I
   could read today names a day-low stop for the Oops itself.
6. **Location.** Only the swing users care (Moglen's 50-day pullback as recorded, Rai's "support", the owner's "location
   matters big time"). Moglen and Rai are both Deepvue co-founders, so they are one voice, not two. The futures tests
   filter nothing.
7. **Date of origin.** Williams' site says 1981; Deepvue says 1979. Williams' own site is the better source.
8. **Origin of the name.** "Oops, we lost" (Deepvue; Thomsett, 2018, the same words, also unsourced) versus a trader's
   reaction to the failed gap (Unger). Williams' own explanation was not readable.

## 4. Measured evidence

### 4.1 Williams' own numbers

Not read. The book's "S&P Oops! Trading" section probably has his results; I could not open it. Secondary sites quote
win rates for it; I could not verify any of them against the book, so I use none.

### 4.2 Nick Radge, The Chartist (2015) **not re-read today**

Our repo's earlier research (`docs/study/levels/external_research.md`, Oops section, sources S2 and S3) recorded these
from Radge's two posts. I could not open them today (HTTP 403), so treat every number as unverified until someone
re-reads the pages:
- S&P 500 futures, long only. The book's period (Sep 1987 to Aug 1998, in-sample): an 88% win rate with Wednesday and
  Thursday signals removed, 80% with all days. The 17 years after the book (out-of-sample, to 2015): 58.9% winners with
  the day filter. Fewer than 200 trades since 1987, about 7 a year.
- One stock (Commonwealth Bank, from 1998, the same rules): 354 trades, 85.8% winners. Without the reverse rule: 98.6%
  winners but a win/loss ratio of 0.05, and losing trades lasted 59 days on average. Exiting at the same day's close
  instead: 50.5% winners, which the earlier file reports Radge called close to random. His point, as recorded: the high
  win rate comes from the first-profitable-open exit, not from the pattern.
- **Limits.** Futures and one bank stock; an exit no swing trader uses; small samples.

### 4.3 Unger Academy, DAX futures, 2010 to 2025 (read today)

Source: [ungeracademy.com](https://ungeracademy.com/blog/we-tested-larry-williams-oops-pattern-the-results-might-surprise-you),
published 2025-06-04. Williams' rules (open beyond the prior extreme, entry back at it, €2,000 stop, first profitable
open), one DAX futures contract, the 8:00 to 22:00 session.
- **Base version:** net profit "around €163,000, with a maximum drawdown of approximately €45,000"; average trade €230;
  "the long side appears to be clearly more effective."
- **With a 15-point minimum gap:** net profit "slightly lower at €146,000", maximum drawdown €38,000, average trade €400.
- **Decay:** "Starting from late 2022, the equity curve begins to weaken, and the system enters a drawdown phase." 2023,
  2024 and the current year lost money in both versions. They blame longer trading hours moving activity overnight.
- **Limits.** No trade count, no win rate, one market, futures not stocks, a day-trade exit. It tells us the edge in the
  original form is a short-term gap effect, and that it can fade.

### 4.4 Our own test (new, for this dossier)

**What I did.** The local test copy of the app's daily bars (`bars.db` in a temp test folder, read-only; split-adjusted,
checked on NVDA June 2024 and AAPL August 2020): 3,736 US stocks with 400 or more daily bars, every trading day from
2000 to 6 Nov 2026. Every event had to pass the house liquidity rule B23 (prior close $10 or more, 50-day average of $20
million a day or more). Stops sit two cents under the Oops day's low (A3, F62). "House plan" means one full position; a
third off at 3R and a third at 5R (an open past a level fills at the open, F63); the stop moves to breakeven once 3R is
hit (B19 allows 2R to 5R; 3R used); the last third trails a close under the 10-day SMA (E52); time stop C33 (under 1R
after 10 sessions, out at that close); a stop gapped through fills at the open (B20's 30-minute rule cannot be modelled
on daily bars); at most 120 sessions. House-plan averages use only trades whose stop was 1% to 8% wide. Baseline: every
11th liquid day that closed green, bought at the close with the same stop and plan. Scripts (in the session scratch
folder, not in the repo): `setups/30-oops-reversal/tools/measure_oops.py`, `measure_attempts.py`, `analyze_oops.py`,
`analyze_attempts.py`, `analyze_close.py`, `analyze_failrule.py`, `intraday_order.py`, `owner_examples.py`.

**Limits, read these first.**
- **The biggest trap is look-ahead, and it changes the answer.** The app buys "the prior close, reclaimed during the
  day". A buy order at the prior close also fills on days that reclaim it and then close back under it. Those days are
  not Oops days, so a test that starts from finished Oops days counts only the reclaims that held. I measured both. The
  truth for a reclaim buyer lies between them, and the 5-minute check below puts it close to the lower one.
- Daily bars cannot show the order of prices inside a day. I checked the order on the only intraday data in the file:
  5-minute bars for 39 large caps, about 20 Aug to 6 Nov 2026, 219 days that opened under the prior close, undercut the
  prior low and traded back to the prior close. Of the 137 that closed back under the prior close, 111 (81%) had
  reclaimed the prior close AFTER the undercut and then failed, 23 had touched it only before the undercut, and 3 never
  reached it in regular hours. So most failed reclaims are real fills that a rule-follower would have taken. It is a
  small, recent, large-cap sample.
- The stock list is today's names (survivors), there are no costs or slippage, and there is no earnings filter (B22), no
  RS filter (C31) and no market filter (B18). Those are big parts of the owner's edge, and this test cannot see them.
- One test, with no separate out-of-sample check beyond the period split. Treat every number as a rough guide for the
  owner's decisions, not a lesson fact.

**Table A. How common it is** (liquid stocks, 2000 to 2026).

| Event | Days | Notes |
|---|---|---|
| Scanner Oops (open < c1, low < l1, low < open, close > c1) | 364,156 | 59.7% closed above the 200-day; 70.6% came after a red prior day; 46% also opened below the prior low; 23% were Super (close > h1) |
| Williams Oops (open < l1, then trades back up to l1) | 559,666 | 50% closed above l1; 35% closed above c1 |
| Reclaim attempts (open < c1, low < l1, high at or over c1) | 1,033,465 | only **37.8%** held above c1 at the close |
| The typical scanner Oops | | median open 0.46% under c1; median undercut 0.61% under l1; median close 0.69% over c1; median DCR 0.85; median volume 0.87x the 50-day average |
| Oops-day low still unbroken 20 sessions later | 25% | the low breaks within a month on three of four Oops days |

**Table B. Entries compared, stocks above the 200-day** (house plan; "P(3R)" = reached entry + 3R before the stop
within 60 sessions; mean R with its standard error in brackets).

| Entry | Look-ahead? | Trades | Median stop | Stop within 3% | P(3R) | House plan mean R | Winners |
|---|---|---|---|---|---|---|---|
| Baseline: a random green day, bought at the close | no | 119,648 | 1.9% | n/a | 26% | +0.01 (0.006) | 32% |
| **Buy at the prior close as it is reclaimed, every attempt** | no | 602,071 | 1.5% | 84% | 26% | **-0.16** (0.003) | 25% |
| The same, after removing the 17% of failed fills the 5-minute check says a rule-follower would have skipped | partly estimated | | | | | about -0.11 | |
| The same, plus selling at the close when the reclaim fails that day | no | 436,244 | | | | -0.19 (0.002) | 13% |
| The same, counting only the days that closed above c1 | **yes, cannot be traded** | 224,458 | 1.1% | 92% | 46% | +0.67 (0.007) | 44% |
| Williams: buy at the prior low as price returns to it, every Williams day | no (see the note) | 304,038 | 1.2% | 88% | 36% | +0.08 (0.005) | 30% |
| **Scanner Oops bought at the close** | no | 217,233 | 2.0% | 75% | 27% | **+0.06** (0.004) | 34% |
| Scanner Oops bought at the next day's open | no | 218,372 | 2.0% | 72% | n/a | +0.04 (0.004) | 35% |
| Super Oops bought at the close | no | 53,355 | 2.7% | 59% | 26% | +0.04 (0.008) | 38% |
| Scanner Oops below the 200-day, bought at the close | no | 146,923 | 2.5% | 60% | 28% | +0.09 (0.005) | 34% |

Note on the Williams row: the stop used is the whole day's low, so a day that made a new low after the entry is not
counted as stopped that day. That flatters the row a little.

**Table C. What changes the result** (scanner Oops above the 200-day, bought at the close; house plan mean R):

| Filter | Trades | Mean R | Reading |
|---|---|---|---|
| All | 217,233 | +0.06 | the reference |
| Opened below the prior low (a Williams open) | 95,596 | +0.09 | the deeper trap did a little better |
| Opened above the prior low (scanner only) | 121,637 | +0.04 | |
| Pulled back 3% to 12% from the 20-day high first | 109,953 | **+0.10** | a real pullback helps most |
| Less than 3% off the 20-day high | 87,267 | +0.01 | no pullback, no edge (the same as random) |
| Prior day red / prior day green | 147,770 / 69,463 | +0.07 / +0.05 | the owner's soft preference points the right way, weakly |
| Orderly before (the owner's bar-size rulings) / not orderly | 178,028 / 39,205 | +0.07 / +0.06 | no difference on average, but orderly halves the stop (1.8% against 3.4%) |
| Low within 0.5 ATR of the 21-day EMA or the 50-day SMA | 88,546 | +0.07 | |
| 200-day rising | 185,473 | +0.08 | |
| Super (close > prior high) | 53,355 | +0.04 | a wider stop at the close; more winners, not more R |
| Closed in the top 10% of the range (DCR 0.9+) | 80,823 | +0.06 | |
| Volume 1.5x the 50-day or more | 20,880 | +0.05 | volume did not help |
| Owner-style (orderly, at the 21/50, red prior day, DCR 0.9+) | 18,382 | +0.05 | the visual checklist alone is not the edge |

Period split: the reclaim attempts were negative in every period (2000-07, 2008-12, 2013-19, 2020-22 and 2023-26:
-0.10R to -0.19R), and finished Oops days behaved alike in every period. Unlike Unger's DAX test, nothing here
suggests the pattern decayed in stocks after 2022.

**Table D. How often an Oops buy breaks a house rule** (scanner Oops, liquid):

| Rule | Share |
|---|---|
| A13: stop wider than 3% if bought at the close | 25% above the 200-day; 40% below it |
| A13: stop wider than 3% if bought on the reclaim of the prior close | 9% above the 200-day |
| B26: the Oops day closed under the 200-day | 40% |
| C29: entry more than 10% over the 10-day average | about 1% |
| C28: buying at the close is more than 4% past the reclaim level (the prior close) | 4% |

**The short mirror, measured.** Days that opened over the prior close, traded over the prior high and closed back under
the prior close, below the 200-day (B26), liquid: 158,355. Shorted at the close with the stop two cents over the day's
high, the house plan lost -0.13R a trade, worse than random red days below the 200-day (-0.10R). The
short-at-the-reclaim figure (+0.55R) has the same look-ahead problem as the long one and is not usable. **This sample
gives no support for a bearish Oops short.**

**What it suggests (tentative).**
1. In this data the Oops on its own is a small edge (+0.06R a trade at the close, against +0.01R for a random green day),
   not a strong one. The owner's results come from things these bars cannot see: leading stocks, RS, themes, the market
   and his own selection.
2. Buying the intraday reclaim of the prior close is the app's entry, and on unselected data it showed no edge: six in
   ten reclaims did not hold into the close, the 5-minute check says most of those were real fills, and the average
   was -0.16R a trade (about -0.11R after removing the fills a rule-follower would have skipped). Selling at the close
   when the reclaim fails did not help (-0.19R): the failed reclaims that were held to the day-low stop lost less on
   average than selling them at the close. The +0.67R figure for finished Oops days is what the reclaim looks like
   only if you could know in the morning which reclaims will hold. The reclaim entry may still be right for the owner,
   but its edge must come from his extra filters (leaders, RS, the market, location), not from the pattern alone.
3. Waiting for the close confirms the pattern but nearly doubles the stop (1.1% to 2.0% median) and breaks the 3% rule
   on a quarter of trades. On the owner's own kept examples the close was a median 5.6% above the low; 25 of 26 were
   over 3%.
4. "The Oops-day low must never break afterwards" describes a winner, not a setup: the low broke within 20 sessions on
   75% of all Oops days, and on 6 of the owner's 26 kept examples.

### 4.5 The owner's own examples, checked against the bars

All 37 Oops charts he ruled on (`owner_verdicts.jsonl`; the last ruling per chart; 26 kept, 10 cut, 1 replaced), read
from the same bars. Medians:

| | Kept (26) | Cut (10) |
|---|---|---|
| Prior day's range, in ATRs | 0.94 | 1.80 |
| Largest range in the 5 days before, in ATRs | 1.40 | 2.55 |
| Prior day's opening gap | +0.1% | +0.8% |
| Oops-day range, in ATRs | 1.56 | 2.19 |
| Oops-day gain | +3.6% | +6.5% |
| Oops-day volume against the 50-day | 1.6x | 2.2x |
| Oops-day DCR | 0.97 | 0.94 |
| Prior close below the 20-day high | 8.8% | 8.3% |
| Stop if bought on the reclaim of the prior close | 2.1% (20 of 26 within 3%) | 1.4% |
| Stop if bought at the close | 5.6% (1 of 26 within 3%) | 8.0% |
| Low unbroken for 20 sessions | 20 of 26 | 5 of 10 |
| Low within 0.5 ATR of the 9 or 21-day EMA or the 50 or 200-day SMA | 20 of 26 | 8 of 10 |
| Passes B23 ($10 and $20M a day) | 22 of 26 | 8 of 10 |

His kept charts are quieter than his cuts on every bar-size measure, which matches his words ("Too dramatic",
"random big red day"). Four kept examples fail the liquidity rule B23: ORIC 2024-01-17 ($8.34, about $2.8M a day), LQDA
2023-06-15 ($7.87, $3.2M), TVTX 2024-09-04 ($9.60, $9.4M) and LPG 2023-01-19 ($17.36, $10.2M). Every kept example with
200 days of history in this file closed above its 200-day (CCJ and VG lack that much history here). SHOP 2026-09-28 and
SE 2024-04-16 were above a 200-day that was still falling.

## 5. Our app

### 5.1 The scanner: `api/services/pattern_engine/detectors/uct/uct_oops_reversal.py`

What the code tests, in order:
1. **Gates:** at least 20 bars, and `liquidity_floor` (`primitives/liquidity.py`): a last close of $2 or more and a
   20-bar average of $10,000 a day or more. That is far below the house rule B23 ($10 and $20 million a day).
2. **Trigger (`v1`, the only firing rule):** `o < c1 and l < l1 and l < o and c > c1`. Open under the prior close, a
   low under the prior low and under the open, a close over the prior close. This is exactly the owner's Scanner Oops.
3. **Primary label `scan_v2_prior_down`:** v1 and the prior day was itself down (`c1 < c2`). A label, not a gate.
4. **Labels only:** `no_undercut_v3` (no undercut; dropped as a trigger by a blind review); `reclaim_prior_low_v4`
   (open under c1, low under l1, close over l1); `multiday` (the undercut one or two sessions back, the reclaim today).
5. **Stage 1 to 6** (the owner's six steps): 1 open under c1; 2 low under l1; 3 close over l1; 4 close over c1; 5 close
   at or over the prior day's midpoint; 6 **a close OR a high over the prior high**.
6. **Other labels:** DCR (strong close at 0.90 or more), red streak, an inside day before, a double inside day, a low
   within 0.5 ATR of the 9, 20 or 21-day EMA or the 50 or 200-day SMA, `trend` (a close over the 200-day OR a 50-day
   rising over 10 bars), `liquid` (price over $5 and 500,000 shares on each of the 3 prior days), `extended` (more than
   5 ATRs over the 50-day), undercut %, volume against the 50-day.
7. **Firing:** checks the last 3 sessions (newest first) and reports the newest that qualifies, unless a later bar
   already traded under its stop.
8. **Confidence:** geometry 70 plus up to 30 (prior day down +10, DCR 0.90+ +10 or 0.70+ +5, stage 5+ +5, stage 6 +5);
   volume score 40 to 100; context 40 to 100. Confidence = 0.40 x geometry + 0.25 x volume + 0.20 x context + 7.5. The
   lowest possible value is 53.5, above the floor of 50, so **every v1 bar fires**; the score only ranks.
9. **Levels:** entry = the prior close (`trigger: c1`); stop = the Oops day's low exactly (`stop: l`); targets at 2R and
   3R (`make_levels` in `uct_setups_common.py`). The narrative says to trail "under each higher low".
10. **No short side:** the docstring says the bearish mirror "is NOT fired: the blind review measured only the long
    side."

The member catalog text (`api/routers/patterns.py`) matches: "opens below the prior close, undercuts the prior
session's low, then closes back above the prior close. Entry at the prior close (the reclaim level); stop at the session
low. Long side only."

### 5.2 The member setup tag and its textbook checks

- `api/services/setup_tags.py` describes the tag to members as: "The session opens below the prior session's low, then
  rallies to close above the prior session's close." Its TEXTBOOK filter keeps a detection only when
  `gap_below_low` is true (the open was under the prior LOW). Its own comment: "the textbook oops opens under the prior
  LOW".
- `api/services/pattern_engine/tag_textbook.py`, `oops()`: the open at least 0.1 ATR under the prior low AND the close at
  least 0.1 ATR over the prior close. Its header records a blind-judged score of 2.93 for the oops tag.

### 5.3 Study code

- `api/services/study_hard.py`, `williams_oops()`: `o < l1 and c > l1` (the open under the prior low, the CLOSE over the
  prior low). Added after the owner caught an AAPL chart labelled "Nothing fired": "It says that NOTHING FIRED and AAPL
  in this example IS an oops reversal! We cannot have incorrect examples and explanations!" (`owner_verdicts.jsonl`,
  2026-11-06).
- `api/services/study_trade.py`: the Oops plan is "the prior close, reclaimed during the day" / "the day's low" / "under
  each higher low", source `uct_oops_reversal.py`; the Oops and the Kicker are the two setups marked as entering during
  the day.
- The chart-reading engine (`api/services/chart_iq/engine/v2_setups.py`) has its own Oops: v1, plus a red prior day,
  plus a trend condition; `v3.py` then keeps it only if the open was under the prior low and the close over it.

### 5.4 Model Book card, playbook and journal tag

- **Card** (`app/src/pages/modelbook/setupCatalog.js`, family "Reversals & Reclaims", long): "Opens below the prior
  close, trades under the prior low, then closes back above the prior close, at the end of an orderly drift into a
  buyable spot. Williams: opens under the low. Super: closes over the high." It matches the owner's ruling.
- **Playbook** (`app/src/pages/modelbook/setupPlaybooks.js`): context "Location matters big time"; chart criteria (no
  news gap the day before, no outsized red bar, a technical Oops day, a red prior day preferred, clear not subtle); entry
  "The reversal through the prior close on the Oops day, or the Super Oops close above the prior high"; stop "The low
  of the Oops day, which is the precise point the trap was set and must never break afterwards; a routine loss, never
  widened."; exits "Quick follow-through is the tell; the best ones are up
  double digits inside two weeks." No trim, trail or size rule.
- **Journal tag** (`app/src/constants/setupGroups.js`): "Oops Reversal" in the Swing group, beside separate tags for
  "2B Reversal", "Classic U&R", "Go Signal" and "Red to Green". Grades offered: A+, A, B, C, F.
- **TRADE_PLANS.md:** entry "the prior close, reclaimed during the day"; stop "the day's low"; trim "2R, 3R"; trail
  "under each higher low"; source the detector, not the owner.
- **Levels dossier** (`docs/study/levels/dossiers/oops.md`): recommends entry A (the reclaim of the prior close), stop A
  (the Oops-day low), a first trim after 3 to 5 days with a breakeven stop, a 20-day EMA trail, and the Oops-day low as
  the invalidation. Its evidence table used his examples, picked so the low held.
- **Bank lessons:** the spot lesson text (`docs/study/bank/spot.setups.json`) carries the three versions and the
  location rulings. The course V.05 lesson (`docs/study/bank/course.v.json`) says the Oops "trims at 2R and 3R and
  trails under each higher low". The glossary item (`recall.glossary.json`) says "The stock gaps below the prior day's
  low, then reverses and closes the gap. Larry Williams named it."

### 5.5 Where the app disagrees with the sources, the owner, or itself

1. **Six different Oops definitions in one app.** Scanner (open < c1, close > c1); member tag text and TEXTBOOK filter
   (open < l1, close > c1); `tag_textbook` (open 0.1 ATR under l1, close 0.1 ATR over c1); `study_hard.williams_oops`
   (open < l1, close > l1); chart_iq (v1 + red prior day + trend, then open < l1 and close > l1); the owner's ruling
   (scanner main, Williams and Super as named versions). The owner ruled the scanner version is the main one
   (2026-10-23), but **the member tag shows only the opens-below-the-prior-LOW subset** (46% of scanner Oops days in
   section 4.4). A member reading the tag text learns a different definition from the one the course teaches.
2. **Stage 6 is looser than the owner's Super Oops.** The code's `super_oops_stage6` is true when the HIGH passes the
   prior high, even if the close does not. The owner: "Super Oops engulf = Closes above prior high". A chart labelled
   "super_oops_stage6" can therefore show a close under the prior high.
3. **Liquidity floor.** $2 and $10,000 a day against the house rule's $10 and $20 million. The owner also cut SIBN for
   being a stock he would not trade.
4. **No 200-day gate.** The scanner fires below the 200-day (40% of liquid Oops days); B26 is a hard rule against those
   longs. The `trend` label is an OR (a 50-day rising counts), so it does not express B26 either.
5. **Targets at 2R and 3R** conflict with B19 / E51 (the first third at 3R, the second at 5R). TRADE_PLANS.md and the
   V.05 lesson ("trims at 2R and 3R") repeat the detector, not the rulebook.
6. **The stop is exactly the day's low**, not "a few cents under" (F62).
7. **The intraday entry has no failure rule.** The entry fills during the day, but nothing says what to do when the
   reclaim fails by the close, which section 4.4 found is the common case (62% of reclaim attempts).
8. **The glossary line "closes the gap" is wrong for both versions.** Williams' trigger is a return to the prior LOW (no
   close condition); closing the gap would mean getting back to the prior CLOSE, which is the owner's scanner rule, not
   Williams'. And "gaps below the prior day's low" is the Williams version only; the owner's main version need not gap
   below the low.
9. **`study_hard.williams_oops` requires a close over the prior low.** That is Deepvue's wording; Williams (as reported
   by Unger) has no close condition. Fine as a check that a chart shows an Oops, but not as Williams' rule.
10. **The owner's "location" and "orderly" rulings are not in the scanner** (no flag, wedge, double-bottom or
    end-of-downtrend test; no outsized-bar test; no prior-day news-gap test). They live only in the example-finder and
    the playbook text.
11. **The "liquid" label** (price over $5, 500,000 shares) is a third liquidity definition, different from both the
    floor and B23.
12. **The levels dossier's evidence** (2R on 94% of his examples) is from examples selected so the low held and the
    trade worked, which it says itself; section 4.4's unselected numbers are far lower.

## 6. UCT's own words

All Substack quotes are from UCT's public Substack (https://unchartedterritoryy.substack.com), all 103 posts read
through the post API today. Dates are the Substack publish dates (UTC). Authorship is by section: "TSDR's Weekly Outlook
& Watchlist" (some weeks "Patrick (TSDR)'s ...") and "TSDR TRADING" are the owner (the About page: "run by co-founders
Patrick (TSDR) and Bracco"); "Bracco's Breakdown & Top Ideas" is Bracco; contributor sections in "The Rest of the Week"
carry the writer's name; the "Index & ETF" and "INTRO" sections are unsigned. The word "oops" appears in 35 posts. One post
(Sunday Scans, 2026-10-18) is for paying subscribers only and was not read past its preview. Quotes keep the writers'
spelling.

### 6.1 The owner's definitions

- **ACHR, 2025-06-08** ([sunday-scans](https://unchartedterritoryy.substack.com/p/sunday-scans), TSDR section), the
  first and fullest definition: "Put in the start of an OOPS REVERSAL on the weekly right at the previous $9.50
  support. OOPS REVERSAL is a very high risk reward setup that is characterized by 4 things:" Then, as numbered (five
  items under "4 things"):
  "1. Open lower than previous candle close"; "2. Low of the current candle is lower than the previous candle’s low";
  "3. Reclaim previous candle low, reclaim previous candle close"; "4. Break 50% retrace of previous candle";
  "5. Lastly, Engulf the previous candle". And the entry idea: "$10.70 would be a retest of the 50% retrace and a
  potential entry spot for the oops reversal following this gap up."
- **His ruling for the course, 2026-10-23** (`docs/study/corrections/spot.fixtures.jsonl`, ruling 6): "Scanner one but
  also let us have definitions and details for the others. The close above version would be a super oops reversal if it
  fully engulfs previous day after any version of the oops." And: "Super Oops engulf = Closes above prior high".
- **The TSDR Trading X account (his trading name), 2026-10-05** ([x.com/TSDR_Trading](https://x.com/TSDR_Trading/status/2107178911369212254)):
  "$IWM looks quite good. Long via $TNA from Thursday oops reversal at the 200SMA."
- **The six-step list** (IWM, 2026-02-08, [sunday-scans-29e](https://unchartedterritoryy.substack.com/p/sunday-scans-29e),
  the unsigned Index & ETF section): "Closed with a weekly Oops Reversal." Then: "1. Open lower than previous candle
  close", "2. Low Lower than previous candle low", "3. Reclaim previous candle low", "4. Reclaim previous candle close",
  "5. Reclaim 50% of previous candle", "6. Take out previous candle high". The scanner's stages 1 to 6 follow this list.

### 6.2 The owner on where and how he takes it

Location (the level the undercut tags):
- U, 2025-08-24 ([sunday-scans-ffa](https://unchartedterritoryy.substack.com/p/sunday-scans-ffa)): "Highlighted during
  the week with the oops reversal off the 20EMA on Thursday and the relative strength that day." And: "Ideal spot was
  Thursday against the 20EMA."
- TXN, 2026-02-08 (sunday-scans-29e): "Would love a red to green move and Oops Reversal off the 9EMA."
- NXT, 2026-02-04 ([the-rest-of-the-week-732](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-732),
  TSDR TRADING): "NXT was highlighted as a top idea in Sunday Scans against the 20ema on the oops reversal under $100."
- PL, 2026-02-25 ([the-rest-of-the-week-b24](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b24),
  TSDR TRADING): "Today’s Oops Reversal at the 50SMA is a great area to risk against to see if we have a monster stock on
  our hands."
- CAVA, 2026-03-22 ([sunday-scans-cab](https://unchartedterritoryy.substack.com/p/sunday-scans-cab)): "If we gap down I
  will look for an oops to hold $82 and take out the HVC from earnings at $85.6."
- NEXA, 2026-04-26 ([sunday-scans-f2d](https://unchartedterritoryy.substack.com/p/sunday-scans-f2d)): "Pulling back into
  the HVE level and a bit orderly of a flag here. Can get an Oops Reversal signal to buy as early as this week."
- INOD, 2026-05-17 ([sunday-scans-679](https://unchartedterritoryy.substack.com/p/sunday-scans-679)): "a nice little
  oops reversal setup against the HVC at $85."
- OUST, 2026-05-17 (same post): "OUST gave a really good opportunity on Monday on the Oops reversal undercut of support
  at that $24 level, followed by a nice inside day and strong close where I began buying some shares."
- BRUN, 2026-05-24 ([sunday-scans-ffb](https://unchartedterritoryy.substack.com/p/sunday-scans-ffb)): "look for some
  sort of hammer candle, gap down oops reversal, some sort of significant buying signal to get involved in and give us a
  clear are to risk against."
- NBIS, 2026-06-14 ([sunday-scans-e95](https://unchartedterritoryy.substack.com/p/sunday-scans-e95)): "Easy buy off $200
  support and the oops reversal on Tuesday or Thursday." APLD, same post: "Was buyable on Thursday under $40 on the oops
  reversal setup there."
- INTC, 2026-08-16 ([sunday-scans-da5](https://unchartedterritoryy.substack.com/p/sunday-scans-da5)): "Tuesday’s oops at
  the gap support off that $95 area was attractive".
- SNDK, 2026-08-23 ([sunday-scans-807](https://unchartedterritoryy.substack.com/p/sunday-scans-807)): "could see failed
  breakdown and hold of 20EMA and oops reversal to reclaim double inside day lows."
- HUT, 2026-09-27 ([sunday-scans-09b](https://unchartedterritoryy.substack.com/p/sunday-scans-09b)): "Looking for a
  kicker candle back through $100 or oops reversal off $94 area."
- ELF, 2026-11-08 ([sunday-scans-70f](https://unchartedterritoryy.substack.com/p/sunday-scans-70f)): "Friday offered a
  nice retest and oops reversal around the $108 spot. Giving a clear risk area if interested."

His approach, in one line (2026-09-06, [sunday-scans-fcd](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd)):
"Here is my approach. Give me an oops. Give me some sideways and a tap of the 20EMA. Give me an inside day."

Trades he reported:
- ZETA, 2025-09-14 ([sunday-scans-461](https://unchartedterritoryy.substack.com/p/sunday-scans-461)): "ZETA ($19.35)
  bought on the Oops Reversal on Thursday. Just a bread and butter trade. Stop is breakeven."
- CEG, 2025-12-28 ([sunday-scans-249](https://unchartedterritoryy.substack.com/p/sunday-scans-249)): "Dabbled in CEG
  Oops reversal on Tuesday".
- IREN and TSLA, 2026-01-11 ([sunday-scans-0b3](https://unchartedterritoryy.substack.com/p/sunday-scans-0b3)): "IREN TSLA
  purchased on Thursday with the Oops Reversal on both at $43.80 and $430."
- AEHR, 2026-04-19 ([sunday-scans-33a](https://unchartedterritoryy.substack.com/p/sunday-scans-33a)): "Didn’t rebuy the
  kicker candle on3/31 or the super oops reversal on 4/2." (The only "super oops" on the Substack.)
- OUST, 2026-05-17 (sunday-scans-679): "Weekly oops reversal is a slap."
- NBIS, 2026-07-12 ([sunday-scans-898](https://unchartedterritoryy.substack.com/p/sunday-scans-898)): "I really liked
  the strong Oops Reversal last week around $200." And on trying it again: "I am comfortable taking a few losses and
  keeping them very very small and tight."
- PLTR and MDB, 2026-08-30 ([sunday-scans-d40](https://unchartedterritoryy.substack.com/p/sunday-scans-d40)): "missed
  the most beautiful oops reversal! Keep eyes for a retest." And: "Ideally entry was just under or right at $400 on the
  oops."
- U, 2026-10-11 ([sunday-scans-31b](https://unchartedterritoryy.substack.com/p/sunday-scans-31b)): "Weekly oops reversal
  at the $40 spot was prime. Now I am squarely focused on a daily higher low in the $43 range."
- CRM, 2026-11-01 ([sunday-scans-669](https://unchartedterritoryy.substack.com/p/sunday-scans-669)): "This week I took
  CRM on the oops reversal and red to green move at the 20EMA and took a 4% loss on the gap down when ServiceNow dumped."
  The same post: "I was looking for the weekly oops." and "I look for minimum 3-7 day burst swing trades that could
  potentially turn into strong positions."

Weekly and monthly Oops (he uses the same bar logic on bigger candles):
- TSLA, 2025-06-22 ([sunday-scans-0d2](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2)): "This would trigger
  an oops reversal on the weekly and would be extremely powerful."
- NTRA, 2026-01-04 ([sunday-scans-153](https://unchartedterritoryy.substack.com/p/sunday-scans-153)): "A gap down and
  weekly oops reversal would be ideal."
- CRCL, 2026-05-31 ([sunday-scans-6d8](https://unchartedterritoryy.substack.com/p/sunday-scans-6d8)): "Weekly nearly an
  oops but we will just call it a weekly hammer."
- CRSP, 2025-10-19 ([sunday-scans-6cc](https://unchartedterritoryy.substack.com/p/sunday-scans-6cc)): "Gave a little baby
  Oops reversal on Friday. I am watching the hourly now for further buildout to give me tight risk entry."

### 6.3 The unsigned Index & ETF and INTRO sections

- QQQ, 2026-02-22 ([sunday-scans-04c](https://unchartedterritoryy.substack.com/p/sunday-scans-04c)): "From an inside week
  to a partial oops reversal."
- XLE, 2026-04-05 ([sunday-scans-356](https://unchartedterritoryy.substack.com/p/sunday-scans-356)): "Bearish Oops
  Reversal on the Weekly." (The only bearish Oops on a chart; used as a warning, not a short.)
- QQQ, 2026-06-07 ([sunday-scans-d16](https://unchartedterritoryy.substack.com/p/sunday-scans-d16), INTRO): "the bearish
  oops and sell off on the gap up to start the day."
- IGV, 2026-09-13 ([sunday-scans-2f5](https://unchartedterritoryy.substack.com/p/sunday-scans-2f5)): "That two day push
  from the oops reversal at the 20EMA and $100 level was immaculate."
- QQQ, 2026-09-27 (sunday-scans-09b): "Oops reversal with the gap down with the AI slowdown fears turned into a rally
  toward highs."

### 6.4 Bracco, Manrav and the team

- **Bracco**, CBRS, 2026-08-09 ([sunday-scans-1ad](https://unchartedterritoryy.substack.com/p/sunday-scans-1ad)): "I
  bought CBRS in the 192’s in anticipation of the oops reversal and daily higher low." Bracco's public posts give no
  Oops definition. His "The Parabolic Short" post does not mention the Oops.
- **Manrav**, RKT, 2025-11-12 ([the-rest-of-the-week-045](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-045)):
  "Undercut and reclaimed prior low’s (15.8) and consistent buying since." And: "Also oops on the Month."
- **Manrav**, RUN, 2026-01-14 ([the-rest-of-the-week-305](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305)):
  "Monthly is a slap, Oops is a slap, Launchpad is a slap. This is going higher."
- **The shout-out to Manrav**, 2025-11-02 ([sunday-scans-b99](https://unchartedterritoryy.substack.com/p/sunday-scans-b99),
  unsigned): "If there is a Launchpad, Slingshot, HVC edge, or Oops Reversal he will be slapping it. These setups I have
  adopted and use consistently in my trading and the results have shown."

### 6.5 The owner's review rulings on Oops charts (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`)

His own words while grading examples (2026-10-23 to 2026-10-24, and 2026-11-06):
- Location: "I want it in a flag or as a like double bottom, or wedging down, or at the end of a downtrend. Location
  matters big time on these" (LQDA, kept, good).
- The drift: "see how it steadily flags and drifts into a buyable spot the days prior to giving an oops. That is good."
  (LQDA.)
- No news the day before: "do not like that the previous day was a big gapper on something, this is more of a delayed
  reaction setup vs an oops imo" (ELVN, cut).
- No big red bar before it: "I do not like how there is just a random big red day prior, that would likely get me to
  not even have it on my radar at all" (ULTA, cut); "hate the big red candle prior makes me not have the stock on my list
  anymore as it is not orderly at all" (FLEX, cut); "would not be on my radar with that big red day so nasty a few days
  prior" (C, cut); "Nope. Candle prior not good" (GTLB, cut).
- Not news-sized: "Too dramatic of candle prior and current, looks more news driven than technical, but I see it" (FIP,
  cut).
- A red day before it, softly: "Eh I prefer it to be a red day prior, although it does not have to be really" (IMNM,
  kept, okay).
- Clear, not subtle: "That is fine, but a little subtle and hidden" (TVTX, kept, okay).
- Good stocks only: "I want it in good spots on good stocks" (SIBN, cut).
- Must work, and the low must hold: "I want examples where the Low of day on the day of the oops does not break. For
  reference SHOP on 9/28 is a prime example" (ADBE, kept, okay).
- Speed: "Ideally would want to see it follow through to the upside quicker but that is good visual and example"
  (ANET, kept, good).
- Sharp pullbacks are second best: "Good, a little sharp of a pullback into that spot but this is great still" (WSM).
- Earnings days are second best: "Eh, earnings so meh but also it is fine idk" (MATX, okay).
- Confluence: "I actually like the oops like 6-7 days after the one this. Also a launchpad example btw, great
  confluence" (TEAM).
- Right setup, wrong result: "Actually a good example. But just horrible result" (WFRD; kept as a failed-setup lesson,
  as was SEI).
- The Go Signal is a separate, hourly setup: "GO SIGNAL is similar to the oops reversal or the UNR but is an hourly GO
  SIGNAL btw" (2026-10-27).

### 6.6 UCT material I did not quote

- **The private Discord and desk notes** (summarised by the brain extracts under `docs/study/levels/`, and in the
  levels dossier `docs/study/levels/dossiers/oops.md` section 3, which already lists them by KB id): the owner's
  six-step definition, notes by Manrav and AtTheAsk, and several stop and trail remarks. They are private, so this public file does not
  quote or add to them. The levels dossier's existing summary is the place to read them.
- **Videos.** "Why the main driver of your trade needs to be your STOP." (public, Uncharted Territory YouTube channel,
  2026-05-13, id 2n2cDYbspPU; its description: "Enjoy the educational video about the Oops Reversal and why letting
  your stop work will lead to more success."). Captions could not be downloaded, so I did not hear it. "Sharpen Your
  Trading Skills" (unlisted, TSDR TRADING channel, id 9b8EzRbPhFo, chapters "1:46-The “Oops Reversal”" and
  "22:14-When to implement the oops reversal"; the app lists it as "Specific Detailed Setups") and "Moonlight with
  Motivational Manrav" (unlisted, YouTube title "TEAM WORKSHOP", id hdRXfoDW5_0, chapter "9:18- Oops
  reversal-Recognizing a failed breakout") are members' material and were not watched. The curriculum also lists
  members' sessions with Oops chapters (ids 47, 95 and 145 in `docs/curriculum/curriculum_final_v2.json`).

## 7. How it fits the owner's account rulebook (`docs/study/sizing_rule.md` section 9)

| Rule | How it applies to the Oops | Conflict? |
|---|---|---|
| A3, F62: stop a few cents under the day's low | The Oops-day low IS the natural stop. Every source that names a stop for stocks uses it (Moglen as recorded, Turtle Soup's "just below today's low", UCT's playbook). | None. The scanner puts the stop exactly on the low; the course should say "a few cents under" (F62). |
| A13: stops usually within about 3% | Depends on the entry. Bought on the reclaim of the prior close: median 1.2% to 1.5%, over 3% only 9% to 16% of the time. Bought at the close: median 2.0%, over 3% on 25% (above the 200-day). The owner's kept examples: 20 of 26 within 3% on the reclaim, 1 of 26 at the close (section 4.5). | **Yes, if the entry is the close.** A big Super Oops (ORIC +11.6% on the day) can leave the close 13% over the low. Either buy the reclaim, or skip when the stop from the actual fill is over 3%. |
| E57: market orders | The reclaim is an intraday event. The house way: an alert at the prior close, then a market order when price trades through it after the undercut. Not a resting buy-stop placed at the open, which can fill before the undercut (the 5-minute check found 23 of 137 failed days touched the prior close only before the undercut). | Small: wording. |
| C28: never more than 4% past the buy point | The buy point is the prior close (the reclaim level). Fills above c1 x 1.04 are chases. 4% of liquid Oops days closed more than 4% over c1, so buying at the close of a big Oops day can break C28. | Yes, for buy-at-the-close on strong days. |
| C29: skip a long more than 10% over its 10-day | An Oops follows a pullback, so this rarely binds (about 1%). Two kept examples closed just over 10% above the 10-day (IMNM 10.9%, SEI 10.1%). | Rare. |
| B26 (hard): no longs below the 200-day | 40% of liquid Oops days closed below the 200-day; the scanner does not check. The owner's location list includes "the end of a downtrend", which is often below the 200-day. Every kept example with the data was above it. | **Yes: the scanner and the "end of a downtrend" wording.** Below the 200-day an Oops is not a long, unless it qualifies as a parabolic long (a burst down, Bracco's post mirrored). In this sample below-200 Oops did not do worse (+0.09R at the close), but the rule is hard and wins. The owner's IWM long "at the 200SMA" (2026-10-05) sits right on the line: a question for him. |
| B23: $10 and $20 million a day | Scanner floor is $2 and $10,000. Four of the owner's 26 kept examples fail B23 (ORIC, LQDA, TVTX, LPG). | **Yes.** Those four should not be shown as models in a course that teaches B23, or B23 needs an exception (question 3). |
| C31: RS 80+, leaders, except parabolic and mean-reversion trades | The owner uses the Oops as a pullback entry in leaders (SHOP, ANET, CIEN, GLW, LLY, NBIS, PL). It is not a mean-reversion trade in his use. | None, if it is ruled a pullback entry (question 5). |
| B19, E51, E52: a third at 3R, a third at 5R, trail the 10-day (fast) or 21-day (steady); breakeven at 2R to 5R | The detector, TRADE_PLANS.md and the V.05 lesson say 2R and 3R and "under each higher low". | **Yes: the app.** The rulebook wins (it says so: "where it and an earlier section disagree, this section wins"). |
| B20: a gap through the stop; the first 30-minute low is the new stop; out past 2R | The Oops low is a known level, and news can gap through it. The owner's CRM trade: "took a 4% loss on the gap down when ServiceNow dumped" (2026-11-01). | None; B20 covers it. |
| C33: under 1R after 10 days, sell | The owner wants "quick follow-through" (ANET ruling). In the data the Oops low broke within 20 sessions 75% of the time, so slow trades usually die anyway. | None; possibly tighter for this setup (question 9). |
| B22: no new buys in the 3 days before a report | An Oops one to three days before earnings is skipped. The owner also rated an earnings-day Oops "meh" (MATX) and a reversal after a news gap "a delayed reaction setup" (ELVN). | None. |
| B21, E56: re-entry only on a new trigger; at most 3 tries a week, 6 a month | The Oops repeats in a rising stock (SHOP 2025-06-23 then 2025-07-16; "willing to try it as it sets up" on NBIS). Each new Oops is a new trade. | None. |
| D47: shorts are our longs reversed | The scanner fires no bearish Oops; UCT uses "bearish oops" only as a market warning (XLE weekly, QQQ 2026-06-07). Section 4.4 found no edge in shorting it below the 200-day. | **Open.** D47 says "almost all" setups mirror; the Oops may be an exception (question 7). |
| D38, E49: grade sets size | A+ Oops up to 1.5% risk, A and B 0.5% to 1%, B- or lower 0.25% to 0.5%. | None. |
| B18, F65: market filter | Orange: only A+. A market-wide gap down that reverses (the owner's QQQ "Oops reversal with the gap down", 2026-09-27) is when many stocks print one at once. | None. |
| C35: swing trades of days to weeks | Williams' original exit is the first profitable open (a 1 to 3 day trade). UCT holds for a "3-7 day burst" or longer. | Style, not a rule conflict; the course teaches the UCT hold. |
| Weekly and monthly Oops (no rule covers them) | The owner uses them often (U, OUST, TSLA, NTRA, IWM). A weekly Oops low is usually far more than 3% below the price. He enters on a daily signal after it ("Now I am squarely focused on a daily higher low", U). | **Yes, A13**, if the weekly low is the stop. Treat the weekly Oops as context and enter on a daily setup (question 8). |

## 8. Proposed rules for our course

Each line is measurable on a daily chart unless it says otherwise. c1, l1, h1 = the prior day's close, low and high.

**What it is**
1. **The Oops day (Scanner Oops, the main version):** open < c1; low < l1; close > c1. [UCT ruling 2026-10-23]
2. **Williams Oops:** open < l1, then price trades back above l1 during the day. Taught as the original and the deeper-trap form. [originator, through Unger and Deepvue; UCT ruling] For a buy in our course it must also meet rule 1's
   close (> c1), so every Oops we buy is a Scanner Oops; the Williams open is a quality mark (rule 31). [my proposal;
   measured: Williams-open Oops did a little better, +0.09R against +0.04R at the close]
3. **Super Oops:** any Oops that closes > h1 (the whole prior day engulfed). [UCT ruling] Fix the app's stage 6, which
   counts a HIGH over h1 (section 5.5).
4. **Time frame:** the daily candle. A weekly or monthly Oops (the same three tests on that candle) is context, not the
   entry (rule 13). [UCT practice; my proposal for the entry]

**Where it must happen (the setup before the trigger)**
5. **Trend:** the Oops-day close and the prior close are both above the 200-day SMA (hard). [house rule B26] Prefer a
   rising 200-day (its value higher than 20 sessions ago). [my proposal; measured +0.08R against +0.06R]
6. **Leader:** RS rating 80 or more, in a strong group. [house rule C31]
7. **A real pullback first:** the prior close is 3% to 12% below the highest high of the 20 sessions before. [my
   proposal; measured +0.10R, against +0.01R when less than 3% off the high; the owner's kept examples: median 8.8%]
8. **Location:** the undercut tags an obvious level: the Oops-day low is within 0.5 ATR of the rising 21-day EMA or
   50-day SMA, or it undercuts a visible level (a flag low, a double-bottom low, a gap-support level, a high-volume
   close, a round number). [UCT: "Location matters big time"; the owner's notes "off the 20EMA", "at the 50SMA",
   "against the HVC", "gap support"] The level part is a chart judgment the scanner cannot check yet.
9. **Orderly pullback:** the pullback drifts on shrinking ranges. Measurable minimums: the prior day's range under 2
   ATRs and its close no more than 4% down; no bar in the 5 sessions before with a drop over 4% or a range over 2.5 ATRs;
   the prior day opened within 3% of the close before it (no news gap). [UCT rulings, with the thresholds the review
   recorded beside them] A sharp two-day pullback is allowed but grades lower. [UCT, WSM]
10. **A technical Oops day, not a news day:** the Oops-day range under 3 ATRs. [UCT ruling, FIP] An earnings-day Oops is
    allowed but grades lower. [UCT, MATX]
11. **Prior day red:** preferred, not required. [UCT ruling, IMNM; measured +0.07R against +0.05R]
12. **Volume:** no requirement. [source consensus: no source gives one; measured: 1.5x volume did not help]
13. **Weekly or monthly Oops:** a weekly Oops at a level marks the area; buy a daily trigger after it (a daily Oops, an
    inside day, a higher low) with a daily stop. [UCT practice: U 2026-10-11, OUST 2026-05-17]
14. **Liquidity:** price $10 or more and $20 million a day or more; a name the owner would trade. [house rule B23; UCT
    ruling, SIBN]
15. **Earnings:** no new Oops buy in the 3 days before a report. [house rule B22]

**The buy**
16. **Trigger:** price trades back above c1 AFTER the day has traded below l1. A touch of c1 before the undercut is not a
    trigger. [UCT definition; my proposal on the order]
17. **Order:** a market order when the trigger prints (an alert at c1 makes it practical). [house rule E57]
18. **Where the sources and the data disagree on WHEN to buy** (question 1):
    - **A, on the reclaim, during the day** (the app, TRADE_PLANS.md, the levels dossier). Small stop (median about
      1.2% to 1.5%), fits A13. But six in ten reclaims fail by the close, and on unselected data this entry showed no
      edge (section 4.4).
    - **B, at the close, once the Oops is confirmed** (the owner's definition is a close; the measured edge is here,
      +0.06R). The stop is wider (median 2.0%; over 3% a quarter of the time; 25 of his 26 kept examples were over 3%).
    - **C, a hybrid:** half on the reclaim, half at the close if it holds (one price and one stop are the house rule,
      A5, so this needs his approval).
    - **Recommendation: A, only when rules 5 to 11 hold, with rule 22's failure exit, because it is his style, it fits
      A13 and E57, and his edge is the filters, not the bar.** Teach B as the patient version. Say plainly in the lesson
      that the reclaim is a trigger, not a confirmation.
19. **No chasing:** no buy more than 4% above c1. [house rule C28]

**The stop**
20. A few cents under the Oops-day low, a real stop order with the broker. [house rules A3, F62, D41; source consensus:
    Moglen as recorded, Turtle Soup, UCT playbook]
21. If the stop from the actual fill is more than 3% below it, skip the trade (or, for an A+, take it at smaller size so
    the account risk still fits). [house rules A3, A13; my proposal for the A+ exception, question 4]
22. **A failed reclaim:** if the day closes back below c1 after the entry, the trade is wrong as an Oops. Options: sell
    at the close, or hold to the Oops-day stop. [my proposal] Measured: holding to the stop lost less on average than
    selling at the close (section 4.4). Recommendation: hold to the stop, but do not add, and treat the next day's
    open below c1 as a warning. (Question 2.)

**Trims, trail, time**
23. **Breakeven** at 2R to 5R. [house rule B19] 2R suggested for this setup, because its stops are small and its low
    usually breaks later. [my proposal]
24. **First third at 3R, second third at 5R; trail the last third** under the 10-day SMA for a fast mover or the 21-day
    for a steadier one, out on a close below it. [house rules B19, E51, E52] This replaces the app's 2R and 3R targets
    and "under each higher low".
25. **Gap through the stop:** the first 30-minute low is the new stop; out if the loss passes 2R. [house rule B20]
26. **Time stop:** under 1R after 10 trading days, sell. [house rule C33]

**What invalidates it**
27. Before the entry: any of rules 5, 9, 10, 14 or 15 fails; or the day never trades back above c1 after the undercut.
28. After the entry: a trade below the Oops-day low (the stop). [UCT: "I want examples where the Low of day on the day
    of the oops does not break."]
    Note for the lesson: the low broke within 20 sessions on 75% of all Oops days in our test, so "never breaks" is how
    the best examples look, not something to expect.

**The short mirror**
29. **No bearish Oops short in the course for now.** The scanner does not fire it; UCT has used "bearish oops" only as a
    warning on indexes; section 4.4 found no edge in shorting it below the 200-day. [measured; my proposal] If the owner
    wants one under D47: open > c1, high > h1, close < c1, below a falling 200-day, RS 20 or less, short on a market
    order when price breaks back below c1, stop a few cents over the day's high. (Question 7.)

**Best market conditions**
30. Green or Yellow market (B18, F65); in Orange only A+ Oops. The best days are market-wide gap downs that reverse,
    when leaders print Oops together (the owner's QQQ note, 2026-09-27). [house rule; UCT]

**Grading marks (feeds section 9)**
31. Pluses: a Williams open (open < l1); a close in the top 10% of the range; a Super Oops; a red prior day; the undercut
    tags the 21-day EMA, the 50-day SMA, a flag low or a gap level; the 21/50 converging (a Launchpad, as TEAM
    2023-12-08); a market-wide shakeout day; a leader in a leading group. [UCT rulings and examples]

**Common mistakes** (each one is in the owner's words or the data)
- Buying a "reversal" the day after a news gap: a delayed-reaction setup, not an Oops (ELVN).
- Buying after a big red bar in the days before: the stock should be off the list (ULTA, FLEX, C, GTLB).
- Buying a dramatic, news-sized Oops day (FIP).
- Buying an Oops in a stock under the 200-day, or one you would not otherwise trade (B26; SIBN).
- Buying the touch of the prior close before the undercut happened.
- Buying at the close of a huge Oops day and calling it the same trade: the stop can be 5% to 13% away (ORIC).
- Treating the 2R and 3R targets as the plan; the house plan is 3R and 5R thirds.
- Expecting every good Oops to work: WFRD and SEI were "a good example" with a "horrible result".
- Confusing it with a Go Signal (hourly) or a Kicker (gap up through a red day's high).

## 9. Grading: what makes an A+ and what makes a B-

The owner says grading is "discretionary and hard to define" (E50), so this is a guide for the lessons, built from his
rulings (section 6.5), his graded examples and the measurements. Every point can be seen on a chart.

| Mark | A+ | B- (or a pass) |
|---|---|---|
| Stock | A leader, RS 80+, a name he trades (SHOP, ANET, CIEN, GLW, LLY) | An obscure or thin name ("idk what the heck SIBN is"); under $10 or $20M a day |
| Trend | Above a rising 200-day, 50-day over the 200-day | Barely above a falling 200-day (SE, SHOP 2026-09-28 were above a falling one and still graded great, so this is a minus, not a veto) |
| Pullback | A steady multi-day drift, 5% to 12% off the 20-day high, shrinking ranges ("steadily flags and drifts into a buyable spot") | A sharp two-day drop (WSM, "a little sharp"); a random big red bar a few days before (a pass: C, ULTA, FLEX) |
| Location | The undercut tags the 21-day EMA or the 50-day SMA, a flag low or a double-bottom low; extra credit for a Launchpad underneath (TEAM, "great confluence") | Mid-air, no level nearby; or a chart that looks choppy ("Eh weird look", HRMY, a pass) |
| Prior day | Red, orderly, no gap | Green, or a news gap (a pass: ELVN, "delayed reaction") |
| The Oops day | Opens below the prior LOW (a Williams open), closes in the top tenth of the range, ideally over the prior high (Super) | Opens just under the prior close, tiny undercut, closes barely over c1 ("a little subtle and hidden", TVTX, okay) |
| Day size | Range 1 to 2.5 ATRs: a clear but technical candle | Over 3 ATRs or news-sized (a pass: FIP) |
| Earnings | Not near a report | On an earnings day (MATX, "meh") |
| Market | Green, or a market-wide shakeout that reverses the same day | Orange or Red |
| After the trigger | Follows through within 1 to 5 sessions, never returns to the Oops low (SHOP 2026-09-28, "a prime example") | Slow ("Ideally would want to see it follow through to the upside quicker", ANET); sideways for 10 days (C33 exit) |

**The owner's graded models.** From his rulings, the ones he called "Perfect", "Beautiful", "great" or "a prime
example", with their numbers from the bars (section 4.5's method; "stop" = from the prior close to two cents under the
low; "+20d" = the highest high in the next 20 sessions over the prior close). All pass B23 and B26 where the data
allows:

| Example | Owner's word | Williams open | Super | Undercut | Day gain | Stop on the reclaim | Low near | +20d |
|---|---|---|---|---|---|---|---|---|
| SHOP 2026-09-28 | "a prime example" | yes | no | 3.2% | +1.2% | 4.1% | 21-day, 50-day | +27% |
| CIEN 2025-07-14 | "Perfect example" | no | yes | 0.3% | +4.7% | 1.1% | 50-day | +24% |
| TEAM 2023-12-08 | "great confluence" | yes | yes | 0.9% | +2.4% | 1.8% | 21-day, 50-day | +32% |
| SHOP 2025-06-23 | "Beautiful" | no | yes | 1.7% | +3.4% | 2.4% | none within 0.5 ATR | +22% |
| FCX 2022-02-24 | "Beautiful" | yes | yes | 1.9% | +3.0% | 2.9% | 21-day, 50-day | +22% |
| SE 2024-04-16 | "Perfect" | yes | yes | 1.4% | +6.9% | 2.0% | 50-day | +32% |
| GLW 2026-01-12 | "Hell yeah" | yes | yes | 0.7% | +3.1% | 0.9% | none within 0.5 ATR | +56% |
| ELF 2024-06-10 | "Perfect" | yes | no | 2.3% | +2.7% | 2.6% | 50-day | +24% |
| LLY 2022-10-13 | "that is perfect" | yes | no | 1.5% | +2.3% | 1.7% | 21-day, 50-day | +14% |
| SHOP 2025-07-16 | "also gave another oops" | yes | yes | 1.8% | +4.3% | 2.2% | 21-day | +36% |

Also graded great but not in this table: ORIC 2024-01-17 (fails B23 at $8.34) and CCJ 2023-05-31 (this file lacks
enough history to check its 200-day). Graded good: LQDA (fails B23), VG, VERX, ANET, WSM. Kept as failed-setup lessons
(his "good example" with a "horrible result"): WFRD 2022-06-07 and SEI 2025-07-29.

What the ten have in common: 8 of 10 opened below the prior low; 7 of 10 were Super Oops; 8 of 10 had the Oops-day low
within 0.5 ATR of the 21-day EMA or the 50-day SMA; 9 of 10 had a stop within 3% on the reclaim entry; all of them came after a pullback of
about 5% to 12% from the 20-day high (SHOP 2025-07-16 only 3%). And all of them were chosen because they worked, so they
show what A+ looks like, not how often A+ pays.

## 10. Questions for the owner

1. **When do we buy?** (A) the intraday reclaim of the prior close (the app now; small stops; but on unselected data it
   showed no edge and six in ten reclaims failed by the close), (B) the close once the Oops is confirmed (the measured
   edge; a wider stop, over 3% a quarter of the time), or (C) half and half (needs an exception to A5). My
   recommendation: A, with the filters in rules 5 to 11.
2. **A reclaim that fails the same day** (the day closes back under the prior close after you bought): (A) sell at the
   close, or (B) keep the Oops-day stop and do not add. The data slightly favours B.
3. **Liquidity:** four of your kept models fail B23 (ORIC, LQDA, TVTX, LPG). (A) drop them from the course, (B) keep them
   as pattern-only examples, not trades for us, or (C) relax B23 for this setup.
4. **The 3% stop:** if the honest stop is over 3% (a big Oops day, or buying at the close), (A) skip, (B) take it smaller
   so the account risk fits, or (C) only A+ may go wider.
5. **Is an Oops a pullback entry (RS 80+ applies) or a mean-reversion trade (exempt from C31)?** Your examples are all
   leaders, which says pullback.
6. **"At the end of a downtrend"** is one of your location words, but B26 bars longs under the 200-day. (A) the Oops must
   still be above the 200-day, (B) an Oops under the 200-day counts only as a parabolic long, or (C) an exception for
   this setup. Related: your IWM long "at the 200SMA" (2026-10-05): is an undercut of the 200-day that closes back above
   it allowed?
7. **The short side:** (A) no bearish Oops short, (B) teach the mirror under D47 (below a falling 200-day, RS 20 or
   less). Our test found no edge in it.
8. **Weekly and monthly Oops:** (A) context only, entering on a daily trigger with a daily stop, or (B) a trade on its
   own with the weekly low as the stop (usually far over 3%).
9. **Time stop:** keep C33 (10 days under 1R), or a tighter one for this setup, since you want "quick follow-through"
   (for example: no new high within 5 sessions, sell)?
10. **The Williams open:** should the Williams Oops (open below the prior low) be the A+ requirement, or just a plus?
11. **Breakeven:** at 2R (the bottom of your B19 range) for this setup, or later?
12. **The member tag:** the app shows members only Oops days that opened below the prior LOW, while the course teaches
    your scanner version. Should the tag show the scanner version too?
13. **The "low never breaks" rule** for examples: keep it as an example filter only (the low broke within 20 sessions on
    three of four Oops days in our test), or also teach it as a sell rule (sell on any later trade under the Oops low,
    even after a trim)?
14. **Your public video** "Why the main driver of your trade needs to be your STOP." (2026-05-13) is about the Oops. Can
    its words go into the lesson? I could not get its captions.

## 11. Sources

All read on 2026-11-09 unless marked otherwise.

**Originator**

| # | Source | Publisher / author | Link | Reliability note |
|---|---|---|---|---|
| 1 | *Long-Term Secrets to Short-Term Trading*, front matter and contents (1999) | John Wiley & Sons; Larry Williams | https://catalogimages.wiley.com/images/db/pdf/0471297224.pdf | The originator's book. Only the copyright page and contents read: it proves the chapter and pages, not the rules. |
| 2 | *Long-Term Secrets to Short-Term Trading*, 2nd ed. (2011), contents and Chapter 1 excerpt | John Wiley & Sons; Larry Williams | https://catalogimages.wiley.com/images/db/pdf/9780470915738.toc.pdf and https://catalogimages.wiley.com/images/db/pdf/9780470915738.excerpt.pdf | The originator's own words, but Chapter 1 only; the Oops section (p. 145) not available. |
| 3 | "Trading Innovation" timeline | Larry Williams, I Really Trade | https://www.ireallytrade.com/innovation/ | The originator's own site; gives 1981 for "OOPS!". Self-reported. |
| 4 | Wikipedia, "Larry R. Williams" | Wikipedia | https://en.wikipedia.org/wiki/Larry_R._Williams | Biography only (born 1942; the 1987 Robbins contest). Lists the book as Wiley 1998, while Wiley's page says copyright 1999. Not used for any rule. |

**Educators, tests and practitioners**

| # | Source | Publisher / author | Link | Reliability note |
|---|---|---|---|---|
| 5 | "Technical Patterns" (Oops Reversal entry) | Deepvue knowledge base | https://docs.deepvue.com/articles/deepvue-custom-indicators-technical-patterns | A charting service's docs; updated 2026-06-19. Gives 1979 and the "Oops, we lost" story without a source. |
| 6 | "Technicals" (column definitions: Oops Reversal, Key Reversal Bar, Bullish Reversal Bar, Upside Reversal) | Deepvue knowledge base | https://docs.deepvue.com/articles/technical | Precise one-line definitions; no rules beyond the bar. |
| 7 | "We Tested Larry Williams' Oops Pattern: The Results Might Surprise You" (title dash replaced) | Unger Academy (video transcript) | https://ungeracademy.com/blog/we-tested-larry-williams-oops-pattern-the-results-might-surprise-you | A systematic futures educator; published 2025-06-04, updated 2026-07-17. A real test with stated rules, but no trade count or win rate; DAX futures only; the firm sells courses. |
| 8 | "Combining Relative Rotation Graphs and the 'Turtle Soup' setup" | StockCharts; Julius de Kempenaer, 2018-06-02 | https://articles.stockcharts.com/article/articles-rrg-2018-06-combining-relative-rotation-graphs-and-the-turtle-soup-setup/ | An established educator restating Connors and Raschke's Turtle Soup rules (a relative, not the Oops). The book itself not read. |
| 9 | X post on Williams Oops reversals | Ameet Rai (@AmeetRai), 2026-10-09 | https://x.com/AmeetRai/status/2108618678950404120 | A practitioner; read through X's public oEmbed service; the post is truncated there and the chart not seen. |
| 10 | "The Oops! Pattern - In Sample / Out of Sample" (2015-04-02) and "How To Create A High Winning Percentage Strategy" (2015-04-09) | The Chartist; Nick Radge | https://www.thechartist.com.au/the-oops-pattern-in-sample-out-of-sample/ and https://www.thechartist.com.au/how-to-create-a-high-winning-percentage-strategy/ | **Not readable today (HTTP 403).** Reported only through our repo's earlier research file. Re-read before any number goes into a lesson. |
| 11 | "The Oops Reversal Entry Setup/Tactic" and "Trade Opportunity Case Study of the Week: BE Oops Reversal, 50 SMA Pullback" (Nov 2025) | TraderLion; Richard Moglen | https://traderlion.com/profile/richard-moglen/the-oops-reversal-entry-setup-tactic/ and https://traderlion.com/profile/richard-moglen/trade-opportunity-case-study-of-the-week-be-oops-reversal-50-sma-pullback-nov-2025/ | **Not readable today (HTTP 403).** The earlier file read them as excerpts only. Probably the closest outside match to the UCT swing use. |
| 12 | "Larry Williams And The OOPS Signal" | *Technical Analysis of Stocks & Commodities* (traders.com), art. 2471 | https://technical.traders.com/tradersonline/display.asp?art=2471 | **Not readable (HTTP 403 / Cloudflare check).** Probably the source of the 1979 date and the "Oops, we lost" story. Author and issue unknown to me. |
| 13 | "Unraveling Larry Williams' Timeless 'Oops Pattern'! Building Winning Strategies Today!" (description only; emoji dropped) | StatOasis (YouTube) | https://www.youtube.com/watch?v=7Pv_eDxXWxI | A course seller's marketing text; it only says the pattern comes from Williams' book. Not used. |

**UCT's own material**

| # | Source | Author | Link / path | Reliability note |
|---|---|---|---|---|
| 14 | UCT Substack, all 103 posts (35 mention the Oops; 1 subscriber-only post not read past its preview), and the About page | Uncharted Territory: Patrick (TSDR), Bracco, contributors | https://unchartedterritoryy.substack.com (sitemap and post API) | UCT's own words; outranks outside writers on how we trade it. Authorship by section. |
| 15 | X post on IWM / TNA | the owner (@TSDR_Trading), 2026-10-05 | https://x.com/TSDR_Trading/status/2107178911369212254 | The owner's own words, via oEmbed. |
| 16 | "Why the main driver of your trade needs to be your STOP." | Uncharted Territory (YouTube), 2026-05-13 | https://www.youtube.com/watch?v=2n2cDYbspPU | Public; description read, captions not available, video not watched. |
| 17 | Owner rulings | the owner | `docs/study/audits/2026-10-24/owner_verdicts.jsonl`; `docs/study/corrections/spot.fixtures.jsonl` (rulings 6, 14, 16) | His words while grading; the highest authority for this course. |
| 18 | The account rulebook | the owner | `docs/study/sizing_rule.md` section 9 | Settled 2026-11-09. |
| 19 | App code | the app | `api/services/pattern_engine/detectors/uct/uct_oops_reversal.py`, `uct_setups_common.py`, `primitives/liquidity.py`, `api/services/setup_tags.py`, `api/services/pattern_engine/tag_textbook.py`, `api/services/study_hard.py`, `api/services/study_trade.py`, `api/services/chart_iq/engine/v2_setups.py` and `v3.py`, `api/routers/patterns.py` | What the app does today. |
| 20 | App teaching text | the app | `app/src/pages/modelbook/setupCatalog.js`, `setupPlaybooks.js`, `app/src/constants/setupGroups.js`, `docs/study/TRADE_PLANS.md`, `docs/study/bank/*.json` | Mostly written from his rulings; TRADE_PLANS.md's Oops row is from the detector, not him. |
| 21 | Levels dossier and outside-research file | earlier research runs | `docs/study/levels/dossiers/oops.md`, `docs/study/levels/external_research.md` | Secondary; its outside sources were not all re-readable today. |
| 22 | Private brain extracts | UCT desk (private) | `docs/study/levels/brain_kb_*.json` | Read for context only; not quoted (private). |

**Our measurement**

| # | Source | Note |
|---|---|---|
| 23 | Local daily bars (`bars.db`, a test copy of the app's bars; 3,736 stocks with 400+ bars; 2000 to 2026-11-06) and 5-minute bars for 39 names (Aug to Nov 2026) | Read-only. Split-adjusted. Survivors only. Scripts in the session scratch folder `setups/30-oops-reversal/tools/`. Not peer reviewed; a guide, not a lesson fact. |

**AI-use notices.** None of the pages I read carried a notice against AI use or training. Bulkowski's
ThePatternSite, which does carry one, was not used for this setup (I found no Oops page there).

**Gaps (what a later pass should read)**
- The Oops section of Williams' book itself (pp. 113 to 120 in 1999; pp. 145 to 152 in 2011), for his exact entry, stop,
  exit, filters and statistics, and his "Fakeout", "Delayed" and "Hidden" Oops variants.
- The *Stocks & Commodities* article, Radge's two posts and Moglen's two TraderLion pages (all blocked today).
- Connors and Raschke, *Street Smarts*, and Connors' other books, which may discuss the Oops directly. I did not check.
- Oliver Kell's book, for whatever Oops-like entry it contains.
- The owner's Oops videos (one public, three members-only).
- My web search allowance ran out after one search, so I could not look for further sources (for example IBD,
  MarketSmith, Bulkowski, or older trader interviews). I do not know whether any of them covers the Oops.

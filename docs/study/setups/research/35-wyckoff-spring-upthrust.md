# Setup 35: Wyckoff Spring and Upthrust (spring = long, upthrust = short)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
PDF or file named next to it, kept to 40 words or fewer, and checked word for word against a saved copy by a script
(the copies and the script are in the session scratchpad, not in the repo). Nothing here is a ruling. Where I could not
read a source, I say so and give no wording from it. Numbers marked **[my computation]** come from my own scripts run
read-only on the app's daily bar store (method and limits in section 4).

**Cold check, 2026-11-09 (a second reader).** Every web source, PDF and Substack post named below was fetched again and
every double-quoted passage (204 of them) was matched word for word against those fresh copies; the detector, catalog
and drawing code was re-read line by line and the writer's detector probe and replay statistics were re-run from the
saved outputs. What changed is listed under "Removed or fixed in checking" at the end of the file.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the Wyckoff school's own
teachers (Wyckoff, and the Golden Gate University line: Pruden, Fraser, Bogomazov); **[UCT]** UCT's own writers (the
owner writes as TSDR) or the owner's verdict log; **[house rule]** the account rulebook, `docs/study/sizing_rule.md`
section 9; **[my proposal]** my recommendation, for the owner to accept or change.

Words used below. **TR**: trading range, a sideways area with a floor (support) and a ceiling (resistance). **Spring**:
price dips under the TR's floor and closes back inside the TR. **Upthrust (UT)**: price pokes over the TR's ceiling and
closes back inside. **UTAD**: upthrust after distribution, the late, bigger upthrust at a top. **Shakeout / terminal
shakeout**: a deeper, more violent spring. **Test**: a later, quieter return toward the spring low. **SOS** (sign of
strength): a strong up move on rising volume after the spring. **LPS** (last point of support) or **BU** (back-up): the
first pullback after the SOS. **One-bar spring**: the dip and the close back inside happen on the same day. **Two-bar
spring**: the dip day closes under the floor and the next day closes back inside. **R**: the risk on a trade (entry minus
stop); 3R is a gain of three times that risk. **x50**: a day's volume divided by the 50-day average volume before it.

**The short version.**
- The spring and the upthrust are events inside the Wyckoff method's trading ranges. They are not stand-alone chart
  patterns. The modern school (Hank Pruden, Bruce Fraser and Roman Bogomazov at Golden Gate University and Wyckoff
  Analytics) defines a spring as a move under the TR's support that quickly reverses back into the TR, a bear trap that
  tests how much supply is left. The upthrust is the mirror, a bull trap at the top.
- The school's trading rules are clear in direction but publish almost no numbers. Buy a low-volume spring right away;
  wait for a quieter test after a high-volume spring; never buy a spring that keeps going down; put the stop under the
  spring low. Shorting an upthrust is "aggressive"; the school prefers waiting for a later weak rally (LPSY).
- Sources disagree on volume. The Wyckoff school wants a **quiet** spring. A CMT Association educator wants **heavy**
  volume ("the higher the better"). Section 3.10 lists all the disagreements.
- I found **no** published success rate for springs or upthrusts. Wikipedia says efficacy research on the method is
  "almost non-existent". The app's own narrative text claims Pruden published 65-75% hit rates; I found no trace of
  that, and Pruden's own bibliography lists no such study (section 5.1).
- **[my computation]** On the app's daily bars (1996 to 2026, liquid stocks, the house trade plan), the textbook
  one-bar spring averaged about +0.03R per trade (11,031 trades), against -0.08R for the same plan on random days; the
  two-bar form (+0.15R) and the Wyckoff school's "test" entry (+0.11R) did better. Volume on the dip made no
  difference. The upthrust short lost (-0.13R), most of all above the 200-day where B26 already forbids it.
- **Our app has three different Wyckoff engines, and they disagree.** The scanner that sends a trade plan to Compass
  (`wyckoff_spring.py`) cannot see a one-bar spring at all (I proved it on synthetic bars), buys the range breakout
  instead of the spring, puts the stop 1.5% under the spring low (a median of about 14% under its entry in my
  replay), and targets twice the range height, a rule I could not find in any Wyckoff source.
- UCT never names the setup "Wyckoff spring" in public. It uses the same idea all the time under other names:
  "shakeout", "failed breakdown", "UnR", "shake n bake". The owner's own worked example (DELL, 2026-03-08) is a
  textbook spring trade with a stop about 1.4% away. On the short side, UCT reads a failed breakout in a **leader** as
  a coming buy ("the failed breakout-squat setup"), not as a short. In the Discord (the repo holds summaries only),
  Bracco labeled a QQQ reversal a Wyckoff UTAD and called MBLY a Wyckoff spring that never sprang.
- Rulebook fit: the long fits B26 only when the spring is above the 200-day (classic accumulation springs after a
  long decline sit below it). The short fits B26 only below the 200-day, which rules out the classic UTAD at the top of
  an uptrend. A13 (stops within about 3%) is the main friction: section 4 measures it.

---

## 1. What it is, and the psychology

**In two plain sentences.** A spring is a quick dip under the floor of a sideways trading range that is bought straight
back into the range, often the same day; it shakes out the last weak holders, traps fresh sellers, and often comes just
before the stock leaves the range upward. An upthrust is the mirror at the ceiling: a quick poke over resistance that is
sold straight back into the range, trapping breakout buyers before a decline.

**Why it works (the psychology), as the sources explain it.**
- **Who is trapped.** "It is an example of a bear trap because the drop below support appears to signal resumption of
  the downtrend. In reality, though, this marks the beginning of a new uptrend, trapping the late sellers (bears)."
  ([ChartSchool, The Wyckoff Method: A Tutorial](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial),
  Roman Bogomazov and Michael Lipsett). Holders with stops under the obvious low are sold out at the worst price.
- **Who is buying.** The school's story is that large buyers use the dip to fill orders cheaply: the spring "allows
  large interests to mislead the public about the future trend direction and to acquire additional shares at bargain
  prices" (same tutorial). Wyckoff himself made the same point in 1910: "When insiders shake other people out it means
  that they want the stock themselves. These are good times for us to get in" (Rollo Tape, *Studies in Tape Reading*,
  chapter VII; OCR text of the scan on archive.org).
- **What the dip tests.** Fraser calls the spring a question asked by the big buyer: "How much supply is there below
  the lows?" ([Fraser, "Francis Bacon Reveals the Nature of Trends", 2015-06](https://articles.stockcharts.com/article/articles-wyckoff-2015-06-francis-bacon-reveals-the-nature-of-trends/)).
  If few shares come out under the floor, sellers are exhausted and a small rise in demand moves the price.
- **The upthrust, mirror image.** The tutorial calls a UT a bull trap: "it appears to signal the resumption of the
  uptrend but in reality is intended to “wrong-foot” uninformed break-out traders" (ChartSchool tutorial). Fraser:
  "UTAD's commonly occur in stocks and markets with prior robust momentum" because momentum traders have been paid to buy every breakout ([Fraser, "Divining Distribution", 2018-03](https://articles.stockcharts.com/article/articles-wyckoff-2018-03-divining-distribution/)).
- **A caution on the story.** The "large interests" narrative is a teaching device (Wyckoff's "Composite Man"), not a
  measured fact about who trades each spring. Wyckoff's course asked students to study the market "as if they were the
  result of one man's operations. Let us call him the Composite Man" (Wyckoff course, section 9, as quoted in
  [Wyckoff Analytics' tutorial PDF](https://www.wyckoffanalytics.com/wp-content/uploads/2022/06/Wyckoff-Method-Wyckoff-Analytics-English-V2.pdf)).
  Wikipedia's "Market manipulation and lawsuits" section says Wyckoff "was criticized for his market manipulation
  techniques by his contemporaries", and that tax records show him profitable in 1915 to 1919 but with "heavy losses
  in the markets" in 1921 to 1923 ([Wikipedia, Richard Wyckoff](https://en.wikipedia.org/wiki/Richard_Wyckoff)).

---

## 2. Origin and naming

| When | Who, where | What it adds |
|---|---|---|
| 1910 | Richard D. Wyckoff (as "Rollo Tape"), *Studies in Tape Reading*, chapter VII "Dull Markets and Their Opportunities" | Insiders "shake other people out"; "shakeouts" around a level in Reading (1909) as buying chances. The words "spring" and "upthrust" do **not** appear in the scanned text (I searched it). |
| 1931 | Wyckoff's correspondence course (*The Richard D. Wyckoff Course in Stock Market Science and Technique*); Pruden, Fraser and Bogomazov (2014): "In the year 1931, Richard D. Wyckoff created a message of instruction" | The "Composite Man" (section 9, quoted via Wyckoff Analytics). I could not read the course itself, so I cannot say whether it uses the word "spring". |
| after 1934 | Robert G. Evans, who ran the Wyckoff school's teaching after Wyckoff's death | Pruden and von Lichtenstein: "Many of these annotations reflect the work of Mr. Robert G. Evans." Evans coined the "jump across the creek" (the SOS breakout) and the "back up" to it (ChartSchool: "coined by Robert Evans"; Pruden: "The term “jump” was first used by Robert G. Evans"). |
| 1986 | Jack K. Hutson, ed., *Charting the Stock Market: The Wyckoff Method* (Technical Analysis Inc., Seattle) | In Pruden and von Lichtenstein's bibliography (the schematics themselves are credited to Forte 1994). ChartSchool's unsigned "Wyckoff Market Analysis" page credits its "two rules" to this book (Hutson, Weis and Schroeder). Not read. |
| 1994 | Jim Forte, CMT, "Anatomy of a Trading Range", *MTA Journal* issue 43 | The schematics and event labels Pruden reprints. Not read (I could not reach the journal archive). |
| 2006 | Hank Pruden and Max von Lichtenstein, "Wyckoff Schematics: Visual templates for market timing decisions", *Market Technician* (STA) issue 55 | Definitions of spring, shakeout, upthrust, UTAD; where to buy; "you should not buy breakouts". Read in full. |
| 2007 | Hank Pruden, *The Three Skills of Top Trading* (Wiley, Hoboken; ChartSchool cites 2007, the 2014 S&C article cites 2008) | The nine buying and selling tests reprinted by ChartSchool (pp. 136-37). Book not read. |
| 2013 | David H. Weis, *Trades About to Happen: A Modern Adaptation of the Wyckoff Method* (Wiley, 224 pp.) | A Wyckoff teacher's book whose table of contents (the publisher's page, Wiley) lists Chapter 5 "Springs" and Chapter 6 "Upthrusts". Wyckoff Analytics' page on Weis names the book but not those chapters. Book not read; no wording from it is used. |
| 2014 | Pruden, Fraser and Bogomazov, "The Composite Man's Bull Market Campaign", *Stocks & Commodities* V.32:8 | Uses the numbered springs ("a number 3 spring or the secondary-test of a number 2 spring"). Read. |
| 2015 to 2022 | Bruce Fraser, "Wyckoff Power Charting" blog on StockCharts | The clearest trading rules: spring types #1, #2, #3, where to buy, where to stop; UT and UTAD. Read 10 posts. |
| 2023 | Stewart Taylor, CMT, "Reversal Bars Part 4-1: Springs and Upthrust", CMT Association | A modern bar-pattern reading that disagrees on volume. Read. |
| today | StockCharts ChartSchool tutorial by Roman Bogomazov and Michael Lipsett (schematics edited by Pruden), same text on wyckoffanalytics.com | The standard definitions of every event. Read in full. |

**Other names.**
- **Spring**: "shakeout" (a deep spring; Fraser uses "Shakeout (#1 Spring)" for a **failed** spring, while ChartSchool
  calls a "terminal shakeout" a bullish "spring on steroids"; see 3.10), "bear trap", "failed breakdown", "false
  breakdown", "washout" (Taylor, for slower failures), "undercut and rally" (U&R, setup 29), "UnR" and "shake n bake"
  (UCT), the 2B (setup 28), spring #1, #2 and #3 (Fraser's types). Who named U&R and 2B is left to those dossiers.
- **Upthrust**: "UT", "UTAD" (the late one at a top), "bull trap", "failed breakout", "false breakout", "2B top". UCT
  uses "failed breakout" and "bull trap"; it also uses "failed breakout-squat setup" for the **bullish** case where a leader
  fails a breakout, undercuts the breakout spot and then goes (section 6).
- The app uses "Wyckoff Spring" and "Wyckoff Upthrust" (detectors and drawings) and "Wyckoff Spring" in the screener's
  base catalog. The Model Book and the journal have no Wyckoff entry; the closest are "U&R (Undercut & Rally)" and
  "2B Reversal" (section 5.4).
- Note: I did not read any Volume Spread Analysis source (a later school that grew out of Wyckoff's ideas). The app's
  "No Demand" and "No Supply" labels (section 5.1) may come from that school; I could not verify it, so this dossier
  gives no VSA criteria.

---

## 3. Every definition I could find, source by source

### 3.1 Richard D. Wyckoff, *Studies in Tape Reading* (1910, as "Rollo Tape"; originator; public domain scan)
[archive.org text](https://archive.org/stream/studiesintapere00wyckgoog/studiesintapere00wyckgoog_djvu.txt), chapter VII.
- Not a spring definition. It is the root idea: a shakeout in a dull, range-bound market is a sign that insiders want
  the stock. "When insiders shake other people out it means that they want the stock themselves. These are good times
  for us to get in".
- No trend, length, depth, volume or stop numbers for the event. The same book says a stop should not be thrust in too
  close: "Reactions must be allowed for."
- Limits: an OCR scan of a later reprint, with scanning errors; I joined one hyphenated word ("insid- ers").

### 3.2 Pruden and von Lichtenstein (2006), "Wyckoff Schematics" (*Market Technician* 55; originator school)
[PDF on wyckoffanalytics.com](https://www.wyckoffanalytics.com/wp-content/uploads/2019/09/WyckoffSchematics-VisualTemplatesForMarketTimingDecisions.pdf).
- **Prior trend and structure.** A TR after a decline: preliminary support, selling climax, automatic rally and
  secondary tests set its floor and ceiling (Phases A and B). "Springs or Shakeouts usually occur late within the
  trading range".
- **Shape.** "A spring is a price move below the support level of a trading range that quickly reverses and moves
  back into the range." The spring is preferred to a test higher in the range because it "does a better job of
  cleaning out remaining supply from weak holders".
- **Depth and volume.** "The extent of supply, or the strength of the sellers, can be judged by the depth of the price
  move to new lows and the relative level of volume on that penetration." Light volume on the break means "the way is
  clear for a sustained advance. Heavy supply here will usually mean a renewed decline." Moderate volume means more
  testing.
- **Entry.** "The shakeout at point 8 on our Schematic 1 represents our first prescribed place to initiate a long
  position. The secondary test at point 10 is better," because the low-volume test and the spring low give "a specific
  low risk stop or danger point". And generally: "The Wyckoff method instructs you to buy after a backup following an
  upward jump (a sign of strength)". "Also according to Wyckoff, you should not buy breakouts because that would leave
  you vulnerable to swift moves in the opposite direction if the breakout turned out to be false."
- **Stop.** The spring low is the "danger point" (no cents or percent given).
- **Targets.** Not given for the spring; the method's objectives come from the point-and-figure count (3.3).
- **Upthrust.** "An upthrust is the opposite of a spring. It is a price move above the resistance level of a trading
  range that quickly reverses itself and moves back into the trading range." A UTAD "usually occurs in the latter stages
  of the TR"; if the breakout is on light volume with no follow-through, or on heavy volume with a fall back to the
  middle of the range, that is "more evidence that the TR was Distribution not Accumulation". Short entries: the LPSY
  (point 11) is "our first inviting opportunity to take a short position. An even better place would be on the rally
  testing point 11".

### 3.3 Bogomazov and Lipsett, "The Wyckoff Method: A Tutorial" (StockCharts ChartSchool; same text at Wyckoff Analytics; schematics edited by Pruden)
[ChartSchool](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial);
[Wyckoff Analytics](https://www.wyckoffanalytics.com/wyckoff-method/).
- **Spring.** "A “spring” takes price below the low of the TR and then reverses to close within the TR; this action
  allows large interests to mislead the public about the future trend direction and to acquire additional shares at
  bargain prices." "Springs or shakeouts usually occur late within a TR". "A terminal shakeout at the end of an
  accumulation TR is like a spring on steroids." Springs are optional: "However, springs and terminal shakeouts are not
  required elements".
- **Length.** Accumulation "may take a long time (sometimes a year or more)". No minimum.
- **Volume.** In the TR, "As the professionals absorb the supply, however, the volume on downswings within the TR tends
  to diminish." On the spring: "A low-volume spring (or a low-volume test of a shakeout) indicates that the stock is
  likely to be ready to move up, so this is a good time to initiate at least a partial long position."
- **Test and confirmation.** "A spring is often followed by one or more tests; a successful test (indicating that
  further price increases will follow) typically makes a higher low on lesser volume." "Often a SOS takes place after a
  spring, validating the analyst’s interpretation of that prior action."
- **Later entries.** LPS, "the low point of a reaction or pullback after a SOS"; in Phase D, "LPSs in this phase are
  generally excellent places to initiate or add to profitable long positions." The BU ("back-up") is Evans' "back up to
  the creek".
- **Stop and management.** Step 5 of the method: "Put your stop-loss in place and trail it, as appropriate, until you
  close out the position." No distance given.
- **Reward filter.** Buying test 9: "Estimated upside profit potential is at least three times the loss if the initial
  stop-loss were hit" (adapted from Pruden 2007, pp. 136-37).
- **Strength filter.** Wyckoff "looked for stocks or industries that were outperforming the market" for longs, and
  "under-performers" for shorts.
- **Market filter.** Step 5: "Time your commitment with a turn in the stock market index."
- **Targets.** "Wyckoff's “cause” can be measured by the horizontal point count in a Point and Figure chart." Targets
  are places to "stop, look and listen", not exact turns.
- **Upthrust.** In Phase B, "upthrust-type actions at the upper end of the TR" are normal inside accumulation. In
  distribution, a UT "is a price move above TR resistance that quickly reverses and closes in the TR. This is a test of
  the remaining demand." UTAD: "It occurs in the latter stages of the TR and provides a definitive test of new demand
  after a breakout above TR resistance." Trading it: "Aggressive traders may wish to initiate short positions after a UT
  or UTAD. The risk/reward ratio is often quite favorable." But "the “smart money” repeatedly stops out traders who
  initiate such short positions with one UT after another, so it is often safer to wait until Phase D and an LPSY."

### 3.4 Bruce Fraser, "Wyckoff Power Charting" (StockCharts; Golden Gate University instructor since 1987; originator school)
Ten posts read (links in section 11). The most concrete rules in the whole literature.
- **Three types of spring.** "So there are three types of Springs: The Number 3 Spring is a shallow penetration of the
  prior low on modest volume and can be bought immediately." "The Number 2 Spring goes further below the low on expanded
  volume and then has a brief lift followed by a drop back toward the lows (this is called a test)." "The test will be
  on diminished volume and can be bought with stops below the Spring low. The Number 1 Spring is actually a Shakeout
  that is a complete breakdown. It should not be bought." (2015-06)
- **Volume decides.** "The volume signature is the final arbiter of the type of Spring developing and this also
  determines the strategy for entry." "Wyckoffians will buy a low volume Spring immediately and place stops below the
  lowest price." "High volume Springs need to be tested in the following days or weeks." (2015-06)
- **Where in the range.** "Typically the Spring action would develop later in the Accumulation formation." (2015-06)
  In a stepping-stone reaccumulation with falling peaks: "An important rule of thumb for this type of SSR is that lower
  peaks are followed by a Spring." (2016-05)
- **Entry and stop.** For a #3 spring: "Buy the Spring or any of the demand bars that follow. Place stops under the low
  of the Spring day." For a #2 spring: "Buy Apple on the Test of the Spring #2 and place the stop under the lowest
  price." Adds: "The BUEC is a classic place to add to the position." (2016-05)
- **In uptrends, too.** "Reaccumulation is the art of shaking investors out of their stock holdings with Springs and
  Shakeouts that drive prices below key levels." (2015-08) "Reaccumulation is a sideways or a down period in the stock
  price that can last from a few months to a few years." (2016-04)
- **Upthrust.** "A UT is a minor breakout to new high prices which is brief and fails quickly." (2015-09, Context is
  King) "Therefore, a UT will not linger above the Resistance area for long before returning to support." (2015-09,
  Distribution Definitions) But of the UTAD: "Once at new highs, price can stay above the Resistance area for days to
  weeks." (same post) And: "A UTAD will not linger long at new high prices." (2016-07)
- **Short entry and stop.** "The Test of the UTAD is a strategic place for short sellers to initiate a trade and place
  the stop above the high price of the UTAD." (2015-09) Shorts can also average into a series of LPSY peaks.
- **Scanning.** "Scanning for Wyckoff conditions has been difficult and elusive largely because of the contextual
  changes in price behavior as these Phases evolve to their conclusion." (2022-01, with Johni Scan)

### 3.5 Pruden, Fraser and Bogomazov (2014), "The Composite Man's Bull Market Campaign" (*Stocks & Commodities* V.32:8; originator school)
[PDF on wyckoffanalytics.com](https://www.wyckoffanalytics.com/wp-content/uploads/2019/08/V32C08822PRUD.pdf).
- The March 2009 low as a "terminal shakeout" under the late-2008 range, which "wipes out those who had protective sell
  stops below the prior lows in the trading range". The quick recovery to the top of the range was the SOS and the
  pullback to about DJIA 8,100 the LPS buy.
- In the count guide: "a number 3 spring or the secondary-test of a number 2 spring" can be the SOS and LPS at once.
- UTAD: "a false price breakout to new highs above the trading range catches early short sellers and last-minute upside
  breakout buyers. Demand is exhausted by the maneuver."
- Reaccumulation tests include "3:1 reward-to-risk ratio" (test 9) and "Favorable relative strength".

### 3.6 Stewart Taylor, CMT, "Reversal Bars Part 4-1: Springs and Upthrust" (CMT Association, 2023-08-21; educator)
[cmtassociation.org](https://cmtassociation.org/tradingview-ideas/erjgdnni-reversal-bars-part-4-1-springs-and-upthrust/).
- Wider use: "Historically these patterns were associated with trading ranges, but I find the concepts useful anytime
  a market tests significant support or resistance."
- **Volume, the opposite of Fraser.** "Volume on the spring is typically quite high (the higher the better) and the
  price spread should be reasonably wide. To qualify as a spring, the reversal must occur quickly." "Slower violations
  that fail can be thought of as washouts or bear traps."
- **Test and invalidation.** A test "should be on lower volume". "In my view, the spring low should not be violated by
  any significant degree or the structure is invalidated."
- **Stop.** "Initial stops placed just beyond the extreme of the reversal bar should be secure but they are often too
  far away from the entry to represent a reasonable risk reward and typically are moved aggressively higher."
- Upthrust: the same definition reversed. Springs "are often more violent than upthrusts".

### 3.7 StockCharts ChartSchool glossary (educator)
[Glossary S](https://chartschool.stockcharts.com/table-of-contents/glossary/glossary-s),
[Glossary U](https://chartschool.stockcharts.com/table-of-contents/glossary/glossary-u).
- Spring: "A situation that occurs when prices break below support but soon reverse course and move back above
  support." Time limit: "Generally, the reversal should occur within 1-3 days of the support break for the failed
  signal to be considered valid." Upthrust: the same, at resistance, "within 1-3 days of the resistance breakout".
- This 1-to-3-day window is the only published time number I found. It is where the app's reclaim-within-3-bars rule
  comes from.

### 3.8 The cousin setups (pointers only)
The same failure-and-reversal idea, defined against a single prior low or high instead of a Wyckoff range, is setup 28
(2B Reversal), setup 29 (U&R) and setup 30 (Oops Reversal). Their dossiers carry their originators and sources; I did
not re-research them here. What makes a Wyckoff spring different: a **defined trading range** (several touches of a
flat floor) and the **volume reading** of the dip.

### 3.9 Comparison table
| Source | Prior trend | Structure | Length | Depth of the dip | Volume on the dip | Close | Trigger / entry | Stop | Target |
|---|---|---|---|---|---|---|---|---|---|
| Wyckoff 1910 | dull, range-bound market | a level insiders defend | not stated | not stated | not stated | not stated | "good times for us to get in" | allow for reactions | not stated |
| Pruden and von Lichtenstein 2006 | decline, then a TR (accumulation) | TR built in Phases A-B | not stated | judged by depth and volume | light is best; heavy = renewed decline; moderate = more testing | back into the range quickly | the spring (first place), the low-volume test (better), the back-up after the SOS; **not** the breakout | the spring low ("danger point") | P&F count |
| ChartSchool tutorial (Bogomazov, Lipsett) | decline (accumulation) or uptrend (re-accumulation) | TR; spring late in it; optional | "sometimes a year or more" | not stated | low volume is the buy signal | "reverses to close within the TR" | partial long on a low-volume spring or test; LPS after the SOS | "put your stop-loss in place and trail it" | P&F count; 3:1 reward filter |
| Fraser (blog) | accumulation or stepping-stone reaccumulation | TR; spring late; after lower peaks in some SSRs | months to years | #3 shallow; #2 deeper | #3 modest: buy now; #2 expanded: buy the test; #1 heavy breakdown: never | back above the low | #3: the spring day or the next demand bars; #2: the test; add at the BUEC | "under the low of the Spring day" | P&F count |
| Pruden, Fraser, Bogomazov 2014 | decline (2008-09) | TR, terminal shakeout | months | deep (terminal shakeout) | not stated | quick recovery | LPS after the SOS | not stated | P&F count |
| Taylor (CMT) 2023 | any test of support | a TR or any significant support | not stated | "thrusts sharply below" | **high, "the higher the better"** | quickly back above support | not stated (part 2 not read) | beyond the reversal bar, then moved up "aggressively" | not stated |
| ChartSchool glossary | not stated | support | not stated | not stated | not stated | back above support | not stated | not stated | not stated |
| **Upthrust**: ChartSchool, Pruden, Fraser | an uptrend that stops (distribution) | TR; UT in Phase B or C, UTAD late | as above | UT "minor", "brief"; UTAD can stay above "days to weeks" | UTAD on light volume with no follow-through, or heavy with a fall back to mid-range | back inside the TR | "aggressive" short after the UT/UTAD; better the test of the UTAD or the LPSY | above the UTAD high | P&F count |

### 3.10 Where the sources disagree
1. **Volume on the spring.** Fraser, Pruden and ChartSchool: quiet is best and a loud spring needs a test. Taylor
   (CMT): loud is best ("the higher the better"). The two readings can be reconciled only partly: Fraser's #2 spring
   (expanded volume) is still tradable, but only on the later quiet test. **This is the single biggest disagreement.**
2. **What "shakeout" means.** ChartSchool: a terminal shakeout is a bullish "spring on steroids". Fraser: "A Shakeout
   (#1 Spring) is a failed Spring" that "should not be bought". Pruden 2014 calls March 2009 a bullish "terminal
   shakeout". So the same word is a buy for one teacher and a no-buy for another. UCT uses "shakeout" for a bullish dip
   that is bought (section 6).
3. **Where to buy.** The spring itself (Fraser #3; Pruden's "first prescribed place"), the test (Pruden: "better"),
   the back-up after the SOS (Pruden, ChartSchool), or the breakout over the range (nobody in the Wyckoff school;
   Pruden says not to buy breakouts). The app's scanner buys the breakout.
4. **How quickly it must come back.** "Quickly" (all), "1-3 days" (glossary), a UTAD that stays above resistance
   "days to weeks" (Fraser 2015) versus one that "will not linger long" (Fraser 2016).
5. **Where it can happen.** Classic: only inside a TR, late. Fraser: also in reaccumulation inside uptrends. Taylor:
   "anytime a market tests significant support or resistance".
6. **Shorting the upthrust.** ChartSchool: possible but "aggressive"; safer at the LPSY. Fraser: short the test of the
   UTAD with a stop above its high. UCT: in a leader, a failed breakout is often a **buy** setup (the squat).
7. **Targets.** The school uses point-and-figure counts. No source I read uses twice the range height (the app's
   target).

---

## 4. Measured evidence

### 4.1 Published statistics
- **None found for the spring or the upthrust by name.** I found no study, book table or vendor test that measures
  Wyckoff springs or upthrusts with a disclosed method. Wikipedia's summary: because the method is subjective and
  incomplete, "peer-reviewed and falsifiable research into its efficacy is almost non-existent", and some published
  work cites "the derivative materials composed by his later followers" rather than Wyckoff
  ([Wikipedia, Richard Wyckoff](https://en.wikipedia.org/wiki/Richard_Wyckoff), "Wyckoff method" section). Wikipedia is
  a secondary source; I could not check its citations.
- My web searching ran out partway through this session (a shared search budget), so after that I worked from known
  pages and the links on them. A study I could not find is not proof that none exists.
- The Wyckoff school's own "tests" are not hit rates. Pruden's bibliography lists "Wyckoff Laws: A Market Test" (with
  Bernard Belletante, Parts A and B, IFTA Journal 2004 and 2008) and "Wyckoff Proofs: Tests, Testing and Secondary
  Tests" (IFTA Journal 2010), per his CMT slides. The slides describe the first as "A report on this ambitious, natural laboratory test of the Wyckoff Law and
  Cause and Effect, of DJIA 14,400": a test of one Dow Jones point-and-figure projection, not a hit-rate study. I could
  not read the IFTA articles themselves.

### 4.2 The nearest measured statistic: Bulkowski's busted rectangles (**his site states a notice against AI training**)
Thomas Bulkowski's site says: "This website, in whole or in part, shall not be used to train artificial intelligence
(AI) systems" (home page). I read and cite it here only for the owner, with a link. His site refuses plain `curl`, so I
read these two pages through the WebFetch tool; the wording below is from that reading, not from a saved copy (the
checker re-read both pages the same way on 2026-11-09 and the wording matched), and should be re-checked on the page
before it is reused.
- [Busted Rectangles](https://thepatternsite.com/BustRectangles.html) ("Updated with new statistics on 12/29/2020"): a
  rectangle busts "When price moves no more than 10%, reverses direction, and closes beyond the side opposite the
  breakout". For rectangle **tops** with a downward breakout that busts upward, he reports "an average of 49%"; for
  single busts "the average rise is 71%", which he qualifies: "This is for rectangle tops with downward breakouts (so
  they bust upward) in bull markets." In the performance section, "51% of rectangle tops will bust". He gives no
  rectangle-bottom figures ("rectangle tops ... have more busts than rectangle bottoms").
- Why it is only "nearest": a bust needs a close beyond the **far** side of the rectangle (the SOS breakout), not just
  back inside. It measures the spring plus the jump across the creek, with no volume rule. The page shows no sample
  size, dates or horizon.

### 4.3 My computation on the app's bar store (**[my computation]**, not a published statistic)
**Method.** Read-only scan of the app's daily bar store (a local copy of `bars.db`: 4,154 tickers, daily bars to
2026-11-06), 1996 to 2026. Scripts in my scratch folder (`tools/wy_scan.py`, `analyze.py`, `alt_entries.py`), not in
the repo.
- **Trading range** at day t: the 60, 40 or 25 bars before it (first that qualifies). Support = lowest low, resistance
  = highest high; height 6% to 35% of support; closes flat (fitted drift at most 25% of the height); at least two swing
  lows (three bars each side) within 0.5 ATR of support, first and last at least 5 bars apart (support "established").
  These bounds are mine, borrowed from the app's drawing rule (5.3); no source publishes numbers.
- **One-bar spring**: low at least 0.1 ATR and at most 2 ATR under support, close back above support (the ChartSchool
  wording). **Two-bar spring**: the dip day closes under support, the next day closes back above it (within the
  glossary's 1-3 days). **Upthrust**: the mirror at resistance. One event per stock per 10 sessions.
- **Liquidity** (B23): close $10 or more and 20-day average dollar volume $20 million or more.
- **The house trade** (section 9 of `sizing_rule.md`): buy (or short) at the next open (E57); stop $0.03 beyond the
  probe's extreme (F62, the "day's low"); a third off at 3R (B19); stop to breakeven after 3R (B19); a third at 5R
  (E51); the last third out on a close through the 21-day EMA after 5R (E52); under 1R at the 10th session close: out
  (C33); 120 sessions at most. A gap through the stop fills at that open (B20's 30-minute rule cannot be seen on daily
  bars, so this is harsher than the rule). "E" is the average result in R per trade, with a 95% interval.
- Trades whose next open gapped through the stop are not taken (counted as "gap skip"). Trades with a stop under 0.5%
  of price (2,136 near-zero-risk cases that blow up R arithmetic) are left out of the R columns.
- **RS proxy**: an IBD-style weighted 12-month return (40% the last quarter, 20% each earlier quarter), ranked 1 to 99
  across the bar store each day. It is not IBD's rating.
- **Base rates** for comparison: the 20-session return of every liquid day of the same stocks (5.9 million days); and
  the same house trade taken on random liquid days (12 seeded days per stock, entry next open, stop under that day's low
  for a long or over its high for a short; `baseline_random.py`).

**Results: the spring (long).**
| Group | Trades | 20-day median | Share higher | vs SPY (median) | Stop (median) | Stop within 3% | E (95% range) | Reached 3R | Stopped |
|---|---|---|---|---|---|---|---|---|---|
| Base rate, all liquid days above the 200-day | 3.59 million days | +0.71% | 54.1% | -0.20% | n/a | n/a | n/a | n/a | n/a |
| Base rate, below the 200-day | 2.30 million days | +0.81% | 53.6% | -0.32% | n/a | n/a | n/a | n/a | n/a |
| Random liquid day, same house long | 26,718 | n/a | n/a | n/a | 2.00% | n/a | **-0.08R (-0.11 to -0.06)**; above the 200-day -0.10R | 21.2% | n/a |
| One-bar spring, all | 11,031 (2,008 stocks; 698 gap skips) | +0.77% | 53.3% | -0.36% | 2.27% | 62% | +0.03R (-0.01 to +0.06) | 21.8% | 62.9% |
| Two-bar spring, all | 3,898 (73 gap skips) | +0.76% | 54.2% | -0.29% | 3.20% | 45% | **+0.15R (+0.08 to +0.21)** | 20.7% | 55.7% |
| One-bar, above the 200-day (B26 allows) | 5,422 | +1.04% | 55.0% | -0.22% | 2.31% | 62% | +0.04R (-0.01 to +0.10) | 22.0% | 61.8% |
| One-bar, below the 200-day (B26 forbids) | 5,609 | +0.45% | 51.7% | -0.47% | 2.23% | 62% | +0.01R (-0.05 to +0.06) | 21.6% | 64.0% |
| One-bar, RS proxy 80+ | 1,650 | +1.06% | 54.4% | -0.34% | 3.13% | 44% | +0.05R (-0.05 to +0.15) | 21.5% | 62.9% |
| One-bar, prior 60 days up | 6,820 | +0.94% | 54.3% | -0.36% | 2.26% | 62% | +0.06R (+0.01 to +0.11) | 22.2% | 62.0% |
| One-bar, prior 60 days down | 4,211 | +0.49% | 51.7% | -0.40% | 2.28% | 61% | -0.03R (-0.09 to +0.03) | 21.2% | 64.4% |
| One-bar, volume under 0.8x (quiet, Fraser's #3) | 1,718 | +0.82% | 54.1% | -0.46% | 1.91% | 72% | +0.02R (-0.08 to +0.12) | 23.6% | 66.1% |
| One-bar, volume 0.8x to 1.5x | 6,009 | +0.77% | 53.2% | -0.32% | 2.13% | 66% | +0.04R (-0.02 to +0.09) | 22.3% | 64.2% |
| One-bar, volume 1.5x or more | 3,304 | +0.70% | 53.0% | -0.40% | 2.89% | 49% | +0.01R (-0.06 to +0.07) | 20.0% | 58.8% |
| One-bar, volume 2.5x or more (Taylor's "higher the better") | 877 | +0.14% | 50.8% | -0.44% | 3.57% | 40% | +0.05R (-0.07 to +0.18) | 18.2% | 52.8% |
| One-bar, dip under 0.5 ATR (shallow) | 8,668 | +0.86% | 53.6% | -0.31% | 2.02% | 67% | +0.04R (-0.00 to +0.09) | 23.1% | 63.9% |
| One-bar, dip 1 to 2 ATR (deep) | 449 | +0.33% | 51.3% | -0.92% | 5.01% | 17% | +0.02R (-0.12 to +0.16) | 12.8% | 43.9% |
| One-bar, close in the top 30% of the day | 4,610 | +0.79% | 53.2% | -0.46% | 3.02% | 48% | +0.06R (+0.01 to +0.12) | 20.8% | 60.3% |
| One-bar, range height 6% to 10% | 3,365 | +0.91% | 54.8% | -0.24% | 1.75% | 77% | +0.09R (+0.02 to +0.16) | 22.9% | 61.4% |
| One-bar, range height 20% to 35% | 2,146 | +0.83% | 52.7% | -0.33% | 3.42% | 40% | -0.04R (-0.13 to +0.05) | 20.6% | 64.8% |
| One-bar, 3+ touches of support | 2,935 | +0.81% | 53.6% | -0.35% | 2.30% | 62% | +0.07R (-0.01 to +0.14) | 22.4% | 62.5% |
| One-bar, house-legal (above 200-day, RS 80+) | 1,558 | +1.07% | 54.5% | -0.22% | 3.11% | 44% | +0.04R (-0.06 to +0.14) | 21.4% | 62.7% |
| ... plus quiet (under 1.0x) and a top-half close | 356 | +1.36% | 57.3% | +0.02% | 3.00% | 48% | +0.14R (-0.08 to +0.35) | 22.0% | 62.9% |
| One-bar by period: 1996-2007 / 2008-09 / 2010-19 / 2020-26 | 1,590 / 631 / 3,524 / 5,286 | +0.66 / -2.80 / +1.30 / +0.50% | 53 / 40 / 57 / 52% | | | | -0.08 / **-0.34** / **+0.18** / 0.00R | | |
| One-bar, without the 181 crowded dates (10+ events) | 8,095 | +0.55% | 52.3% | -0.54% | 2.11% | 66% | +0.05R (+0.01 to +0.10) | 22.5% | 62.5% |

**The Wyckoff school's other entries, on the same springs** (one-bar and two-bar together, `alt_entries.py`):
| Entry | Trades | Stop (median) | Stop within 3% | E (95% range) | Reached 3R |
|---|---|---|---|---|---|
| The spring itself (next open), for reference | 14,929 | 2.49% | 58% | +0.06R (+0.03 to +0.09) | 21.5% |
| **The test** (1-10 sessions later: a quieter bar back near the old support that holds above the spring low and closes in its top half; buy next open, stop under the spring low) | 5,512 (found after 36% of springs; 41% broke the spring low first) | 3.21% | 46% | **+0.11R (+0.06 to +0.16)**; above the 200-day +0.14R (+0.07 to +0.21) | 20.6% |
| The breakout over the range top within 30 sessions, stop under the spring low (the app's plan) | 2,478 (only 16% of springs got there first; 77% broke the spring low first) | 12.5% | 0% | +0.01R (-0.01 to +0.03) | 1.1% |
| The same breakout, stop under the breakout day's low (house default) | 2,325 | 2.66% | 58% | -0.02R (-0.09 to +0.06) | 18.9% |
- From the spring entry, the top of the range sat a median **4.8R** away; 72% of the time it was 3R or more away, 48%
  of the time 5R or more. The owner's DELL note says the same: the range top is where you are "3-1".

**Results: the upthrust (short).**
| Group | Trades | 20-day median | Share lower | vs SPY (median) | Stop (median) | Stop within 3% | E (95% range) | Reached 3R | Stopped |
|---|---|---|---|---|---|---|---|---|---|
| Random liquid day, same house short | 25,409 | n/a | n/a | n/a | 2.06% | n/a | -0.02R (-0.05 to +0.00); below the 200-day -0.02R | about 22% | n/a |
| One-bar upthrust, all | 11,708 (771 gap skips) | +0.92% | 45.3% | -0.13% | 1.80% | 70% | **-0.13R (-0.17 to -0.10)** | 19.7% | 66.5% |
| Two-bar upthrust, all | 4,476 | +0.46% | 47.5% | -0.54% | 2.58% | 57% | -0.05R (-0.10 to +0.00) | 19.1% | 60.3% |
| One-bar, above the 200-day (B26 forbids) | 8,695 | +0.96% | 44.9% | -0.05% | 1.69% | 73% | **-0.16R (-0.20 to -0.12)** | 19.5% | 67.2% |
| One-bar, below the 200-day (B26 allows) | 3,013 | +0.76% | 46.6% | -0.49% | 2.22% | 62% | -0.06R (-0.14 to +0.01) | 20.2% | 64.7% |
| One-bar, below the 200-day and RS proxy 20 or less (house-legal) | 874 | -0.36% | 51.1% | -0.93% | 2.57% | 54% | +0.09R (-0.06 to +0.23) | 22.8% | 62.4% |
| One-bar, volume 2.5x or more | 660 | +1.12% | 45.7% | -0.11% | 3.53% | 41% | +0.01R (-0.12 to +0.15) | 18.4% | 52.4% |
| One-bar, 2008-09 (the bear market) | 615 | -0.72% | 53.3% | -0.39% | 2.22% | 63% | +0.14R (-0.02 to +0.31) | 23.8% | 62.4% |
| One-bar, 2010-19 | 4,111 | +0.99% | 44.2% | -0.08% | 1.53% | 78% | -0.18R (-0.24 to -0.12) | 19.5% | 68.1% |
| One-bar, without the crowded dates | 9,956 | +0.78% | 45.9% | -0.13% | 1.75% | 71% | -0.12R (-0.16 to -0.08) | 19.9% | 66.5% |

**What this says, plainly.**
1. As a mechanical daily-bar event, the textbook one-bar spring showed **a small edge at best**: its 20-day returns
   match the base rate of all liquid days, and the house trade averaged about +0.03R with a range that includes zero.
   But the same house trade on random liquid days averaged **-0.08R**, so the spring did about 0.1R per trade better
   than a random entry with the same plan. Only about 1 in 5 reached 3R; nearly two in three were stopped.
2. Things that helped (each only a little, with wide ranges): the **two-bar** form (+0.15R), the **test** entry the
   Wyckoff school prefers (+0.11R, +0.14R above the 200-day, vs +0.06R for entering the same springs at once; waiting
   skips the 41% of springs that broke their low before any test came), a **prior uptrend** (+0.06R), a **tight range** of 6% to
   10% (+0.09R), a strong close (+0.06R), and the 2010s. The 2008-09 bear market was bad (-0.34R).
3. **Volume did not separate winners from losers** in either direction. Neither the Wyckoff school's quiet-is-best rule
   nor Taylor's "the higher the better" shows up on daily bars. (Daily volume is a crude stand-in for what the sources
   read bar by bar.)
4. **Buying the breakout with the stop under the spring low (the app's plan) is the worst way to trade it**: a median
   12.5% stop, none within 3%, and 1% reached 3R.
5. **The upthrust short lost money** (-0.13R), **worse than shorting a random day** (-0.02R), and lost most where B26
   already forbids it (above the 200-day, -0.16R). In the house-legal zone (below the 200-day, weak RS) it was about break-even to slightly positive, with a range that
   includes zero. This fits UCT's view that a failed breakout in a strong stock often becomes a squat, not a top.
6. Stops: a one-bar spring's natural stop (next-open entry) was within 3% about 62% of the time (median 2.3%). A13 is
   met more often than not, but not always; deeper dips and wide ranges push it past 3%.

**Limits of my computation.**
- Daily bars only. Intraday entries (the owner buys the reclaim during the day: DELL at $142) and B20's 30-minute rule
  cannot be tested; the next-open entry is usually worse than the reclaim (DELL: 3.2% risk on his plan, 5.6% at the next
  open).
- My range and spring rules are one reasonable reading of sources that publish no numbers. A different reading gives
  different counts. I did not tune them on the results.
- The bar store may lean toward surviving tickers. Events cluster on market-wide days (2022-01-24 had 50 springs);
  removing crowded dates changed little.
- No commissions, slippage, borrow fees or short availability (D48). The RS proxy is mine, not IBD's.
- One management plan (the house's). A different exit gives different R.
- Nothing here sees the full Wyckoff context (phases, the climax that started the range, the P&F count). The school
  would say a mechanical scan is not the method. Fraser says scanning for it "has been difficult and elusive".
- My code is not peer-reviewed. Treat these numbers as a check on the idea, not as a published result.

### 4.4 The app's own detectors, replayed (**[my computation]**)
I imported `wyckoff_spring.py` and `wyckoff_upthrust.py` read-only and ran them over 800 randomly chosen tickers
(seeded), 2005 to 2026, on liquid days only, with an empty context (no trend or RS context, so the context score is
neutral). For each fire I played the app's own plan: wait up to 20 sessions for a close past its entry; then its stop or
its target, whichever first, up to 120 sessions. Script `tools/app_det_run.py`.
| | Spring | Upthrust |
|---|---|---|
| Fires (stocks) | 4,914 (442) | 6,628 (449) |
| Stop distance from its entry, median (10th to 90th percentile) | **14.3% (8.3% to 18.8%)** | **18.1% (9.9% to 22.8%)** |
| Fires with the stop within 3% / 5% | 0% / 0% | 0% / 0% |
| Entry triggered within 20 sessions | 19.5% | 16.3% |
| Stop hit before the entry ever triggered | 55.3% | 56.0% |
| Of triggered trades that finished: target first | 51.2% (809 finished) | 40.5% (829 finished) |
| Target distance, median | 1.29R | 1.30R |
| Average result (target = its R, stop = -1R) | +0.10R | -0.16R |
So a member who follows the scanner's plan through Compass gets a stop about five times the house limit, a target only
about 1.3R away, and for the upthrust, a losing trade on average. (Checker: every number in this table was recomputed
from the saved replay file `out/app_det_800.csv` and matched; the one-bar probe in 5.1 was re-run and gave the same
result.)

### 4.5 The house's own named examples, checked on the bar store (**[my computation]**)
| Example | Who, when | What the bars show | House trade (next open, stop under the dip) |
|---|---|---|---|
| DELL 2026-03-10 | owner, 2026-03-08 plan | low 137.50 under the $141-143 shelf, close 143.80, 0.94x volume; 10.5% above the 200-day | entry 145.66, stop 137.47 (5.6%); **+12.8R** (trailed out after 79 sessions). His intraday plan (entry 142, stop 137.47, 3.2%) saw 10.5R within 20 sessions |
| AMZN 2026-08-27/28 | owner, 2026-08-30 ("Long from 261") | a one-week range; 08-27 low 255.02 closed under it (256.26), 08-28 closed 266.43 (a two-bar spring) | entry 263.82, stop 254.99 (3.3%); gapped through the stop on 09-01: **-1.02R**. His 261 entry reached 1.1R first |
| LHX 2026-02-25 | owner, 2026-03-08 ("Shakeout into the 50SMA then a retest of the top of the base") | one-bar spring under a 25-day range (dip 0.72 ATR, 1.27x volume) | entry 341.45, stop 329.25 (3.6%); 3R in 3 sessions, rest at breakeven: **+1.0R** |
| BE 2026-06-10/11 | owner, 2026-06-21 ("dirty shakeout") | closed under a 25-day low (1.48x volume), reclaimed the next day | entry 246.00, stop 230.57 (6.3%); 5R in 5 sessions: **+2.8R**. Then -40% in the following 20 sessions |
| U 2026-10-29 to 11-02 | owner, 2026-11-08 | a quiet one-bar spring (0.73x) on 10-29, an undercut close on 10-30, reclaim 11-02 | the one-bar entry gapped through its stop; the two-bar entry (38.42, stop 37.06, 3.5%) ran +6.6R into an earnings gap. **B22 forbids it** (earnings within 3 days); he skipped it |
| IREN 2025-10-22 | owner, 2025-10-26 | dip to 48.20 under $50, 191% above the 200-day, ATR 14% | not a range spring; a pullback in a vertical stock. The next 20 sessions: -33% |
| SPY 2026-03-13 to 04-08 | index section, 2026-04-19 | about four weeks of closes under the six-month range low (and from 03-20 under the 200-day), then a gap back in on 04-08 | not a one- or two-bar spring: a slow "terminal shakeout". B26 kept a long out until it was back above the 200-day |
| XBI 2026-03-30/31 | index section, 2026-04-05 | 03-30 did not undercut the 03-24 low; 03-31 +7.5% on 1.97x volume | a failed breakdown of a short-term level and an SOS, not a range spring by my rule |
| HPE late Sept to Oct 2026 | owner, 2026-09-27 (expected a shakeout under $60) | no dip under $60 then (low 60.68); ran to 73.56; mid-October it broke down to 43.38 | the later dip under $60 was a breakdown, not a spring |
| MBLY July to Aug 2024 | Bracco (Discord summary): a spring that never sprang | a series of closes under support, then a -22% day on 6.9x volume on 08-01; 16% to 50% under the 200-day | B26 would have kept a long out |
| QQQ 2025-12-05 to 12-10 | Bracco (Discord summary): a UTAD | a 0.03 ATR poke over the 12-05 high on 12-10, 14% above the 200-day | B26 forbids the short; the next 20 sessions +2.1% |

Lessons from this table: the owner's examples are **leaders above the 200-day**; next-open stops ran 3.3% to 6.3%,
while his own intraday plans were tighter (1.4% planned on DELL, 2.3% on AMZN); AMZN was stopped, and HPE's hoped-for
shakeout became a breakdown.

---

## 5. Our app: what exists, and what looks wrong

The app has **three** separate Wyckoff spring engines and **two** upthrust engines. They answer on different member
surfaces and use different rules. The scanner's own header says the two spring engines agreed on only 7% of symbols
when measured on 2026-08-31 (744 tickers: "both 2, structure-only 21, engine-only 6").

### 5.1 The pattern-engine detectors (`api/services/pattern_engine/detectors/uct/wyckoff_spring.py`, `wyckoff_upthrust.py`)
These write `pattern_detections`, which Compass reads through `find_patterns_on_ticker` / `scan_active_patterns`, and
`grade_ticker` (when the brain tools are on) turns their `levels` into a GO / HOLD / SKIP verdict. They are not in `INTERNAL_PATTERN_IDS`, so they are
member-visible. The router's description calls the spring the "Highest-conviction long entry."

**What the spring code actually tests** (read line by line):
1. Look at each of the last 8 bars as a possible spring bar.
2. The "range" is the 15 to 60 bars before it (longest that fits). Its height (high minus low, over the midpoint) must
   be 3% to under 18%.
3. The spring bar's **low** is 0.5% to 5% under the range low.
4. A "reclaim": the first bar from the spring bar onward (up to 3 bars later) that **closes** above the range low.
5. The reclaim bar's volume must be at least **1.2x the spring bar's volume**.
6. "Accumulation signature": average volume in the second half of the range at most 1.25x the first half.
7. Context gate: rejects only when Stage 4 **and** stacked-bearish averages **and** RS trending down all hold.
8. Score = 40% geometry + 25% volume + 20% context + 15% a fixed 50; must reach 50.
9. **Levels**: entry = range high + 0.1% (the code's `entry_condition` is `close > entry`), stop = spring low minus
   1.5%, target = range high + 2x range height.

The upthrust file mirrors it (high 0.5% to 5% over the range high; a close back under the range high within 3 bars on
1.2x the poke bar's volume; second-half range volume at least 0.75x the first half; context gate rejects only Stage 2 +
stacked-bullish + RS up; entry range low - 0.1%, stop upthrust high + 1.5%, target range low - 2x height).

**What looks wrong, and why.**
1. **It cannot see the textbook spring.** In step 4 the search starts at the spring bar itself. A one-bar spring (the
   ChartSchool wording: "reverses to close within the TR") closes back above the range low on the same bar, so the
   "reclaim bar" is the spring bar, its volume ratio is exactly 1.0, and step 5 rejects it. I proved this by importing
   the detectors (read-only) and feeding synthetic bars: a one-bar spring on 0.6x or on 2.5x volume gives **no
   detection**; a spring that closes under support and is reclaimed the next day **fires** (script
   `tools/probe_detector.py` in my scratch folder). Same for the upthrust. The test fixture generator
   (`tests/fixtures/wyckoff_spring/_generate.py`) builds only the second shape (its comment: `spring closes below
   support`), so the test suite cannot catch it.
2. **The spring block is always one bar.** The loop that counts consecutive bars under support stops at once, because
   the range is defined to end on the bar before the spring (`prev_idx <= range_end` is true for the first step). So
   `spring_bars_below` is always 1 and the 75 / 55 scores for 2 / 3-bar springs never apply.
3. **It buys the breakout, not the spring.** Entry = range high + 0.1%. Pruden and von Lichtenstein: "you should not
   buy breakouts". Fraser buys the spring, the test or the BUEC. The owner buys the reclaim (DELL, section 6).
4. **Its stop is far away.** From the range high down to 1.5% under the spring low is the whole range height plus the
   dip plus 1.5%. With the code's own limits (range at least 3%, dip at least 0.5%) it can never be under about 5%. In
   my replay of the app's code on 800 random tickers (section 4.4) the median stop was 14.3% from its entry and none
   was within 5%. That breaks A13 every time.
5. **The target is not Wyckoff's.** Range high plus twice the range height is not in any source I read. Wyckoff
   targets come from the point-and-figure count (ChartSchool, Pruden, Fraser).
6. **The "Sign of Strength" label is misapplied.** In the sources an SOS is "a price advance on increasing spread and
   relatively higher volume", usually a run toward the top of the range. Here it is any close back above the low on
   1.2x the dip bar's volume.
7. **The range can include the prior trend.** The code takes the longest window (up to 60 bars) whose height is under
   18%. In my synthetic test the "range high" came from the tail of the decline before the range, not from the range
   itself, which raised the entry and widened the stop. Real charts can do the same.
8. **The context gate barely gates.** A spring in a stock below a falling 200-day passes unless three bearish flags
   coincide. B26 forbids that long. The upthrust likewise passes in uptrends above the 200-day unless three bullish
   flags coincide; B26 forbids that short.
9. **The UTAD is invisible.** Fraser: after a UTAD, "price can stay above the Resistance area for days to weeks". The
   upthrust code requires a close back inside within 3 bars.
10. **Volume rules are the code's own.** Second-half volume at most 1.25x the first half (spring) and at least 0.75x
    (upthrust) are loose stand-ins for the sources' comparative wording ("the volume on downswings within the
    TR tends to diminish"). The narrative's "1.5x the 20-bar average" for the trigger bar has no source.

**Statements in the narrative text that I could not verify, or that are wrong** (members can read these through
Compass):
- "Pruden's published Wyckoff-method backtests on US equities show Spring setups deliver positive expectancy at hit
  rates in the 65-75% range" and, for the upthrust, "60-70%". **No source found.** Pruden's own bibliography in his
  CMT slides lists "Wyckoff Laws: A Market Test" (IFTA Journal 2004 and 2008), which the slides describe as a test of
  one Dow Jones point-and-figure projection, not a hit-rate study. Wikipedia says efficacy research is "almost
  non-existent". Treat as invented until someone produces the study.
- "Pruden's longest documented winners ran 50-200% from the Spring entry" and "30-60%" for the upthrust. **No source
  found.**
- "Wyckoff calls this 'No Demand' (ND)" (spring failure) and "Wyckoff calls this 'No Supply' (NS)" (upthrust failure).
  Neither phrase appears in any Wyckoff source I read. "No supply" means sellers are absent, which is the opposite of a
  failed short; the label reads backwards.
- "The Spring marks the END of the accumulation phase" is close to the sources but they say springs are optional ("not
  required elements") and Phase D follows; the "Highest-conviction" wording is the app's, not the sources'
  (ChartSchool says "a high-probability trading opportunity").
- The docstring dates Wyckoff "1908-1934". He lived 1873 to 1934; *The Ticker* began in 1907 (Wikipedia).

### 5.2 The screener's base catalog (`api/services/screener/base_catalog.py`, `WYCKOFF_SPRING`, key `wyckoff-spring`)
Answers the screener's `base_matches` column and the provenance panel. Spring only; no upthrust.
- Trading range = the 50 bars that end 10 bars ago (a 60-bar window minus the last 10). Support = lowest low,
  resistance = highest high. The range must be horizontal (the file's "boxiness" bound, marked "ours").
- A spring = any bar in the last 10 with low under support and close above it (the textbook one-bar shape). Any depth
  counts. No volume rule. The last close must still be above support.
- Its criteria quote a corpus id `wyckoff_schematics` that is not in the repo (no other file names it). I traced its
  quotes: two are the ChartSchool tutorial; "A spring is an example of a 'bear trap'... In reality, though, the drop
  marks the end of the downtrend, thus 'trapping' the late sellers, or bears." matches Pruden and von Lichtenstein
  (2006) word for word. "Instead of steadfast rules, Wyckoff advocated broad guidelines when analyzing the stock
  market. Nothing in the stock market is definitive." is on ChartSchool's unsigned
  [Wyckoff Market Analysis](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/wyckoff-market-analysis)
  page (found in checking); it is ChartSchool's own summary, not Wyckoff's words, and the page credits the "two rules"
  beside it to Hutson, Weis and Schroeder's 1986 book. The catalog's "Wyckoff is quoted rejecting mechanical rules
  outright" therefore rests on an educator's paraphrase.
- This is the most faithful of the three engines, and its comments say so honestly ("our invention wearing his name"
  for anything more). It has no trade plan, by design.

### 5.3 The member chart drawings (`setup_draw_r2.py` upthrust, `setup_draw_r3.py` spring)
Released to members (`MEMBER_WYCKOFF_UPTHRUST_ROUND = 2`, `MEMBER_WYCKOFF_SPRING_ROUND = 3`) after blind drawing
judges scored them (spring A 2.44 / 92%, B 2.68 / 96%; upthrust A 2.56 / 100%, B 2.48 / 96%). Those scores grade **how
well the line is drawn**, not whether the trade works. The upthrust is in `CAUTION_SETUP_IDS` (drawn amber, off by
default).
- Spring drawing: the dip is within the last 3 bars; the range is 60, 50 or 40 bars; height 6% to 35%; the dip is more
  than 0.1 ATR and at most 2 ATR under support; at least 3 swing-low touches of support within 0.5 ATR, the median
  touch within 0.25 ATR; closes flat (drift at most 0.15 of the height); at most 2 closes in a row under support; the
  latest close between support + 0.5 ATR and the middle of the range, in the upper half of its own bar; not a dead-flat
  or deal-pinned stock. **No volume rule.**
- Upthrust drawing: the mirror (30 to 60-bar range, drift at most 0.25, latest close between the middle and resistance
  - 0.25 ATR). **No volume rule.**
- These are well-built shape rules and I borrowed their depth and height bounds for my own test (section 4).

### 5.4 Model Book card, journal tags, and Study
- **Model Book** (`app/src/pages/modelbook/setupCatalog.js`): no Wyckoff card. The nearest is "U&R (Undercut &
  Rally)", long, whose card says "Price briefly undercuts a prominent prior low" and "then reclaims it", and "2B
  Reversal", both directions: "Price breaks a prior extreme, fails to follow through, and snaps back".
- **Journal tags** (`app/src/constants/setupGroups.js`): no Wyckoff tag. "Classic U&R" and "2B Reversal" are the
  nearest. A member who trades a spring today has to tag it as one of those.
- **Study**: the vocabulary lesson `docs/study/courses/V/V.04.json` already teaches the words spring, upthrust and
  shakeout (questions q45, q48, q57, q65), sourced to ChartSchool, Wyckoff Analytics and the CMT post. Its spring
  question uses a one-bar spring (dip to $19.40, close $20.60), which is exactly the shape the scanner in 5.1 cannot
  see. `docs/study/UNITS-foundations.md` F4.11 lists "Wyckoff Spring" among the reversals and reclaims.
- **No owner verdicts** mention Wyckoff, spring or upthrust (`owner_verdicts.jsonl`, searched).
- **No levels dossier** exists for it (`docs/study/levels/dossiers/`).

### 5.5 Summary of the conflicts
| Question | Sources | Pattern detector | Base catalog | Drawing |
|---|---|---|---|---|
| One-bar spring (close back inside the same day) | the definition | **rejected** | yes | yes |
| Close-below-then-reclaim (two-bar) | allowed (1-3 days, glossary) | the only shape it finds | no | yes (up to 2 closes under) |
| Volume | quiet best (school) / loud best (Taylor) | reclaim bar 1.2x the dip bar | none | none |
| Entry | the spring, the test, or the back-up; not the breakout | the breakout | none | none |
| Stop | under the spring low | 1.5% under the spring low | none | none |
| Target | P&F count | 2x range height | none | none |
| Upthrust shape | quick for a UT; UTAD can linger days to weeks | close back inside within 3 bars | n/a | close back near the middle |

---

## 6. UCT's own words

Searched: all 103 public posts in the sitemap (`https://unchartedterritoryy.substack.com/sitemap.xml`; read from a copy
fetched today, and every post quoted below re-fetched by me and checked), the owner's verdict log, the setup files, and
the brain knowledge-base files in the repo. Authorship is by section: "TSDR's Weekly Outlook & Watchlist" and the
"Charts Covered" list under it are the owner (the 2026-11-08 issue heads it "Patrick (TSDR)’s Weekly Outlook &
Watchlist"); "Bracco’s Breakdown & Top Ideas" is Bracco; the "Index & ETF" section and the intro have no individual
byline. Quotes keep the writers' spelling.

**What I found.** The words "Wyckoff", "spring" (in this sense; the word appears four times as the season) and
"upthrust" never appear in the public posts. The idea appears constantly under other names (counts re-done in checking
over the post bodies of all 103 posts): "shakeout" / "shake out" (112 hits in 47 posts), "undercut" (116 in 65), "UnR"
/ "UNR" (27 in 19; 48 in 34 counting "U&R" and "undercut and rally" too), "squat" (27 in 23), "failed breakdown" (24 in
16), "failed breakout" (14 in 11), "bull trap" (3 in 1), "shake n bake" (5 in 3).

### 6.1 The owner (TSDR)
- **The clearest spring trade in UCT's writing: DELL, 2026-03-08** ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf),
  Charts Covered). "Ideally we see a shakeout below that to tap the 9EMA, find strong buyers and give us a clear area to
  risk against." Then the math: "Entry-Shakeout to $140 and reclaim of $142, so entry $142." "Stop $140 so we are
  risking $2 per share." "We will be 3-1 gain on our risk by the time the breakout buyers step in." This is the Wyckoff
  logic exactly: buy the reclaim inside the range, stop under the dip, and the old range top ($148 HVC) is where you are
  already up 3R. It is the opposite of the app scanner, which would buy at the range top.
  [my computation, section 4.5]: on 2026-03-10 DELL fell to 137.50 and closed 143.80; by 2026-03-20 it traded
  169.90.
- **AMZN, 2026-08-30** ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-d40), Honorable mention
  under the owner's watchlist): "I changed my mind after the shakeout Thursday below the range and then show of
  strength on Friday." "The fail and quick burst is one of the best things you can see and use to manage risk and time
  opportunities. Long from 261." (A short, one-week range; the Thursday bar closed below it; Friday reclaimed it: a
  two-bar spring with a "show of strength".)
- **U (Unity), 2026-11-08** ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-70f)): "This is a
  very good UnR of the $40 level, and quick shakeout below the base." He held off because of earnings and then a
  buyout report: "My hard rule, as soon as there is buyout stuff I take it off my list."
- **IREN, 2025-10-26** ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-13e)): "Nice UnR of the
  previous highs from Sept and dip below the $50 spot." And the principle: "Buying those shakeouts is the optimal RR."
- **BE, 2026-06-21** ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-bc0)): "After getting
  stropped below the 50SMA (dirty shakeout) but leaders do that sometimes." "Clean base, drop below and quick buyup.
  $100 move from that low."
- **The failed-breakout squat (a bullish upthrust).** HPE, 2026-09-27
  ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-09b)): "would not be surprised to see it
  shakeout below $60 one more time for a final contraction before breaking out. Some call it the failed breakout-squat
  setup. I think if that happens you buy with 10 toes down." ATEN, 2026-05-17
  ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-679)): "One more shakeout on this, honestly,
  would be awesome, a little fake breakout squat type of action. If that happens I’ll gladly be a buyer in a little
  mid-range base." HNGE, 2025-08-17 ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-644)):
  "Would love one more little shakeout to confirm it is not wedging up. If we get that squat then this is a slap."
- **Context.** 2025-06-29 ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-d70), owner's
  outlook): "Shakeouts are getting bought and following through." AMD, 2026-09-06
  ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd)): "Failed breakdown below $460 with
  strong candle. Next higher low on the hourly is actionable imo."
- **What this says about how he trades it.** (1) It lives in **leaders in uptrends**, often a short base or a moving
  average, not a long Wyckoff accumulation range after a decline. (2) The level is often a short-term one (an hourly
  range, a prior high, the 20 or 50-day), sometimes found on the hourly chart. (3) He buys the **reclaim**, with the
  stop under the shakeout low. (4) In a leader, a failed breakout is a **buy** setup when it squats into support, not a
  short.

### 6.2 Bracco
- 2025-11-16 ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a)): "the Nasdaq’s undercut of
  its prior low now looks more like a failed breakdown than the start of a new leg lower."
- 2026-07-05 ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-dec)): "Favorite trading scenario
  from here is further weakness into a failed breakdown of the June lows leading to a big undercut and rally." In the
  same note he describes the opposite (distribution) side: leaders "are actually starting to crack out of wide ranges
  with obvious signs of distribution".
- 2026-06-28 ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-ae1)): "would prefer a double
  bottom or failed breakdown of the recent June lows to further washout some positioning and quickly reset short-term
  sentiment."
- 2026-09-20 ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-bc2)): "was really hoping for some
  sort of failed breakdown which is exactly what we got."
- 2025-12-14 ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-f2f)), RIVN: "Huge shakeout / news
  failure on Thursday following the conference and displaying characteristics that you typically see at the turning
  point of a stage 1 base."
- 2026-11-01 ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-669)), the upthrust side, as a
  market read: "Unwinding pretty quick here following the failed breakout earlier this month and already -10% off the
  highs."
- **Discord (member-only; the repo's brain files hold summaries, so these are paraphrased, not quoted):** on 2024-08-01
  he called MBLY a Wyckoff spring that never sprang (`brain_kb_cycle_2026-11-06.json`, ref `trader_archive:t11016`); on
  2025-12-05 he said QQQ spiked over its rising channel into a big spot and fell back in, and labeled it a Wyckoff UTAD
  (ref `t13315`); on 2025-02-24 he kept open a "November-style" bear trap: a failed new high, a big down day, then an
  undercut and rally (ref `t10513`). Manrav on 2025-09-13 called MU a textbook shakeout he failed to re-enter (ref
  `t9179`, in `brain_kb_rules_2026-11-06.json`, not the cycle file). These show the house knows the Wyckoff names and
  uses them as reads, not as a checklist. (Checker: the section each Substack quote sits under was re-derived from the
  posts' own headings: the owner's quotes all fall under "TSDR's Weekly Outlook & Watchlist" (headed "Patrick (TSDR)'s
  Weekly Outlook & Watchlist" on 2026-11-08), Bracco's under "Bracco's Breakdown & Top Ideas", and the 6.3 quotes under
  the index sections or the intro; the post dates all matched.)

### 6.3 Unsigned sections (Index & ETF, intros)
- 2025-08-24, IWM ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-ffa)): "The squat is the best
  by the way. Failed breakout into an undercut of the breakout spot and tap into the moving averages then go."
- 2025-09-01, QQQ ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-4d1)): "the best way to trade
  a head and shoulders top is to buy the failed breakdown of it."
- 2026-04-19, SPY weekly ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-33a)): "Failed
  breakdown from 6 months essentially of sideways into a rip to highs. Historic."
- 2026-04-05, XBI ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-356)): "Failed breakdown on
  Monday followed by a blast to the top of the base on Tuesday." (spring, then SOS)
- 2026-03-08, intro ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf)): "The market is in
  distribution and likely entering a mark down phase." (Wyckoff's phase words)
- 2026-09-13, QQQ ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-2f5)): "Either we get a
  breakout of this range or a failed breakout of this range leading to a directional move."
- 2026-10-25, QQQ ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-36e)): "Turning into a
  decently nasty failed breakout and correction. Really just a monster range going back 4 months"
- 2026-06-07, SPY ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-d16)): "Bearish kicker
  candle following bull trap attempted reversal on Thursday."
- 2026-08-16, SMH ([Sunday Scans](https://unchartedterritoryy.substack.com/p/sunday-scans-da5)): "Wouldn’t be surprised
  to see rejection to trap in bears and shakeout some more hands."
- 2025-11-26, *The Rest of the Week*, "Thoughts on the Market"
  ([post](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-22a)): "Id love some tightness, some
  shakeout, and some battleground to scare buyers, trap sellers, and set us up for further upside."

### 6.4 What UCT's usage adds to the sources
- UCT uses the spring idea mostly as a **long in uptrending leaders** (Fraser's reaccumulation case) and as a **market
  bottom read** (Bracco, the index section). Both fit B26 when the stock or index is above its 200-day.
- UCT's upthrust use is mostly a **market read** ("bull trap", "failed breakout and correction"), not a single-stock
  short recipe. For leaders it reads the failed breakout as a coming **squat buy**.
- The owner's DELL math is the only written trade plan for the setup anywhere in UCT's public writing.

---

## 7. How it fits the owner's account rulebook (`sizing_rule.md` section 9)

| Rule | What it says | Fit for the spring (long) | Fit for the upthrust (short) |
|---|---|---|---|
| A3, F62 | stop a few cents under the day's low or the prior day's low | natural: the spring day's low **is** the setup's invalidation (Fraser: "under the low of the Spring day"). Entry the next morning makes it "the prior day's low" | a few cents over the upthrust day's high |
| A13 | stops usually within about 3% | **the main friction.** A spring's natural stop is the dip low; entered at the next open it can sit well over 3% away in volatile stocks. Measured in 4.3 | same; and Taylor warns stops beyond the reversal bar are "often too far away" |
| E57 | market orders | fine: buy at the open after a qualifying close, or at market on the intraday reclaim (the owner's DELL plan) | fine |
| C28 | no chasing more than 4% past the buy point | the buy point needs a definition: I propose the old support level (the range low) | mirror: the old resistance |
| C29 | skip a long more than 10% above its 10-day | rarely binding: a spring happens at the bottom of a range | n/a |
| B26 | no longs below the 200-day; shorts only below it (hard) | **excludes the classic accumulation spring after a long decline**, which usually sits under the 200-day (MBLY, SPY in March 2026). Allows the reaccumulation spring in an uptrend, which is UCT's usage | **excludes the classic UTAD at the top of an uptrend** (above the 200-day). Allows only redistribution upthrusts in downtrends |
| C31 | RS 80+ for longs (20 or less for shorts), except parabolic and mean-reversion | consistent with Wyckoff's own strength test ("outperforming the market"). A spring is not a mean-reversion trade in the house sense, so C31 applies | RS 20 or less |
| D47 | shorts are our longs reversed | the upthrust is the spring reversed | yes, inside B26 |
| D48 | skip hard-to-borrow shorts | n/a | applies |
| B19, E51, E52 | 1/3 at 3R, 1/3 at 5R, breakeven 2R to 5R, trail 10 or 21-day | the range top is often the first resistance; measured in 4.3 how many R it sits away | mirror |
| B20 | gap through the stop: first 30-minute low is the new stop, out past 2R | applies; a failed spring often gaps down (HPE, October 2026) | mirror |
| C33 | under 1R after 10 days: sell | fits a spring that stalls (the sources' advice is to wait for a new spring or test, which C33 turns into an exit) | same |
| B22 | no new buys within 3 days of earnings | applies; the owner skipped U for this reason | applies |
| B18, F65 | market filter | Wyckoff step 5: "Time your commitment with a turn in the stock market index." Springs in stocks are best when the index itself springs (2026-04 example) | Red market: shorts below the 200-day (D46) |
| E50 | grading is discretionary | the grading cues in section 9 are cues only | same |

**Conflicts to rule on (section 10):** the A13 stop distance; B26 removing the classic accumulation spring and the
classic UTAD; and whether an upthrust in a leader is a short at all, given the owner's "failed breakout-squat" buys.

---

## 8. Proposed rules for our course

### 8.0 The recommendation in one paragraph
Teach the **spring** as the Wyckoff name for what UCT already trades as a "shakeout", "failed breakdown" or "UnR"
under a **flat base**: a leader above its 200-day undercuts the low of a sideways range and closes back inside it; buy
the reclaim (quiet dip) or the later quiet test (loud dip), stop a few cents under the dip's low, house trims and trail.
Teach the **upthrust** mostly as a **warning for longs** (a breakout that closes back inside the range), and as a short
only where B26 allows it (below the 200-day, weak RS), graded no higher than B until the owner rules, because it
measured as a losing short overall and UCT reads failed breakouts in leaders as coming squat buys. Fix or retire the
pattern-engine scanner before it coaches members (section 5.1).

### 8.1 What it is: the spring (long)
| Item | Rule | Basis |
|---|---|---|
| Prior trend | Price above the 200-day SMA on the spring day (no exception). | [house rule] B26 |
| Prior trend, preferred | The 60 sessions before the range rose (a reaccumulation pause, Fraser's "stepping stone"). | [UCT] (the owner's examples), [originator] Fraser; measured +0.06R vs -0.03R |
| Strength | RS rating 80 or more; stronger than the market. | [house rule] C31; [originator] Wyckoff's strength test |
| Structure | A sideways trading range of at least 20 sessions, with a flat floor touched at least twice (two swing lows within about half an ATR of the range low, at least 5 sessions apart). Three or more touches grade higher. | [my proposal] (no source gives a number; the app uses 15 to 60 bars); support "established in Phases A and B" (ChartSchool) [source consensus] |
| Range height | 6% to 20% from the floor to the top. Over 20%: grade lower. | [my proposal]; measured 6-10% best (+0.09R), 20-35% worst (-0.04R) |
| Flat | No clear slope: the closes drift less than a quarter of the range height. | [my proposal] (the app drawing's rule) |
| The spring | The day's low goes under the range's lowest low by at least 0.1 ATR (a real undercut) and at most about 1 ATR. Over 1 ATR is a shakeout (grade lower); over 2 ATR is a breakdown, not a spring. | shallow = Fraser's #3 [originator]; the numbers [my proposal] |
| The reclaim | It closes back above the old range low the same day (one-bar), or the next day (two-bar). Later than that: not this setup. | [source consensus] (ChartSchool "close within the TR"; glossary "1-3 days"); [UCT] AMZN was two-bar |
| Close quality | The reclaim day closes in the upper half of its range. | [my proposal]; measured close in the top 30%: +0.06R |
| Volume | Record it (x50). Quiet (under 1.0x): the reclaim can be bought. Loud (1.5x or more): wait for the test. Do not use volume as a pass/fail gate. | [originator] Fraser, Pruden; measured: no difference on daily bars [my computation]; sources disagree (Taylor) |
| Location | Often undercuts the 20-day or 50-day too (UCT: "Shakeout below the 20EMA and remount", BTC 2025-07-27; "shakeout under the 50SMA", GLW 2026-06-21). Must stay above the 200-day. | [UCT], [house rule] |
| Liquidity | $10 or more and $20 million a day or more. | [house rule] B23 |
| Earnings | No new buy within 3 days of a report; skip on buyout news. | [house rule] B22; [UCT] the owner's U note |

### 8.2 The buy
| Option | How | Basis | Recommend |
|---|---|---|---|
| A. The reclaim | Market order as price trades back above the old range low after the dip (intraday, the owner's DELL plan "reclaim of $142"), or at the next open after a qualifying close. | [UCT], [originator] Fraser #3, [house rule] E57 | **Yes**, for quiet springs where the stop fits A13 |
| B. The test | 1 to 10 sessions after a loud spring, a quieter dip back toward the old floor that holds above the spring low and closes in its upper half; buy at the next open (or on its intraday turn). | [originator] Pruden ("better"), Fraser #2 | **Yes**, for loud or deep springs; measured +0.11R (+0.14R above the 200-day) vs +0.06R for the immediate entry on the same springs |
| C. The back-up (LPS / BUEC) | After the push to the top of the range, the first light-volume pullback that holds the old top. | [originator] Pruden, ChartSchool, Fraser | As the add or the second chance; it overlaps the flat-base breakout (setup 01) |
| D. The breakout over the range top, stop under the spring low | | the app's scanner | **No**: Pruden says not to buy breakouts; measured median stop 12.5%, +0.01R |
- No chase: skip if the entry is more than 4% above the old range low. [house rule] C28, with the buy point defined as
  the old range low [my proposal]. Owner to confirm (question 4).

### 8.3 The stop
- A few cents under the spring low (the lowest low of the dip, for a two-bar spring the lower of the two days). Same
  for the test entry. [house rule] F62 / A3; [originator] Fraser "under the low of the Spring day".
- Size from it (A5). If it is more than about 3% away: prefer the test or the intraday reclaim to tighten it; 3% to 5%
  only at a lower grade (smaller risk, E49); over 5%, skip. [my proposal] against [house rule] A13. Measured: 62% of
  one-bar springs had the stop within 3% at the next open (median 2.3%).
- Never lower it (A4); a gap through it: B20.

### 8.4 Trims and trail (house defaults)
- A third at 3R, breakeven between 2R and 5R, a third at 5R, trail the rest under the 21-day (most springs) or the
  10-day (fast movers). [house rule] B19, E51, E52.
- The top of the range is the first resistance. From the reclaim entry it sat a median 4.8R away (72% at 3R or more),
  so the 3R trim usually comes at or before the range top. [my computation]; [UCT] the owner's "3-1 ... by the time the
  breakout buyers step in".
- The Wyckoff point-and-figure count can be shown as a "stop, look and listen" level, not taught as a rule.
  [originator], [my proposal]

### 8.5 What invalidates it
- Before the buy: no real range (a falling stock makes a "new low" every day); a close back under the spring low; the
  dip keeps going (over 2 ATR) on heavy volume (Fraser's #1, "should not be bought"); below the 200-day; earnings
  within 3 days. [originator], [house rule]
- After the buy: the stop (under the spring low). "the spring low should not be violated by any significant degree"
  (Taylor). Under 1R after 10 sessions: out (C33). [source consensus], [house rule]
- In the data, 41% of springs broke their low again before any test came, and 77% before a close over the range top.
  A spring that fails usually fails fast. [my computation]

### 8.6 The short mirror (the upthrust)
| Item | Rule | Basis |
|---|---|---|
| Where | Only below the 200-day SMA, RS 20 or less, in a weak group. | [house rule] B26, C31 mirror |
| Structure | The same range rules, mirrored at the ceiling. | [house rule] D47 |
| The upthrust | The day's high goes over the range's highest high by 0.1 to 1 ATR and the day closes back inside; or closes back inside the next day. | [source consensus], [my proposal] for the numbers; a lower-half close did not help in the data |
| Short | At the next open; better, on the failed retest of the upthrust high. | [originator] Fraser: "The Test of the UTAD is a strategic place for short sellers"; ChartSchool: safer at the LPSY |
| Stop | A few cents over the upthrust high. | [house rule] F62 mirror; [originator] Fraser |
| Borrow | Skip hard-to-borrow. | [house rule] D48 |
| Grade cap | B at most, until the owner rules. | [my proposal]: measured -0.13R overall; +0.09R (range -0.06 to +0.23) in the house-legal zone |
| Not a short | An upthrust in a leader above the 200-day. UCT reads that as a possible "failed breakout-squat" **buy** later. | [house rule] B26; [UCT] |
- As a **warning for longs** (the more useful lesson): a breakout that closes back inside its range is a reason not to
  buy, or to sell a position bought on that breakout. [originator] (bull trap), [UCT] ("bull trap", "failed breakout
  and correction").

### 8.7 Best market conditions
- Springs: Green or Yellow market (B18, F65), best when the index itself has just sprung back from a correction
  (Wyckoff's step 5, "Time your commitment with a turn in the stock market index"; UCT's 2025-11 and 2026-04 index
  notes). Measured: bad in 2008-09 (-0.34R), best in 2010-19 (+0.18R). [originator], [UCT], [my computation]
- Upthrust shorts: Red market, below the 200-day (D46). Measured best in 2008-09 (+0.14R). [house rule], [my computation]

### 8.8 Common mistakes
1. Buying a breakdown that never closed back inside the range. [source consensus]
2. Calling any undercut a spring when there is no flat range behind it. [my proposal; the base catalog's own comment]
3. Buying a loud, deep dip at once instead of waiting for the quieter test. [originator] Fraser
4. Putting the stop under the old range low (too tight; the spring low is the real line) or far below it. [house rule]
5. Buying the range-top breakout and keeping the stop under the spring low (the app's plan): a 12.5% median stop.
   [my computation]
6. Buying a spring under the 200-day after a long decline. [house rule] B26
7. Shorting an upthrust in a leader above the 200-day. [house rule] B26; [UCT]; measured -0.16R
8. Adding to, or averaging down on, a spring that broke its low. [house rule] A5, A4
9. Buying right before earnings. [house rule] B22
10. Chasing the reclaim more than 4% above the old low. [house rule] C28

### 8.9 Examples to model (candidates only; none has been shown to the owner)
From the house's own writing (section 4.5): DELL 2026-03-10 (the model trade), LHX 2026-02-25, BE 2026-06-10/11, U
2026-10-29 to 11-02 (right shape, wrong week: B22), AMZN 2026-08-27/28 (a stopped one), MBLY July 2024 (a spring that
never sprang; B26), SPY March 2026 (a slow terminal shakeout under the 200-day), QQQ 2025-12-10 (an upthrust B26 will
not let us short).
From my scan (house-legal, liquid, mechanically found, **not checked by eye**): springs AVGO 2023-05-04 (+8.7R),
HWM 2025-08-20 (+5.0R), IBB 2020-06-12 (+5.5R), KLAC 2023-07-21 (two-bar, +3.5R), AMAT 2023-09-27 (+2.7R),
and two that failed: NVDA 2025-09-02 and TSLA 2025-02-06 (both stopped). Upthrust shorts: TGT 2023-07-27 (+6.0R),
AMT 2023-07-27 (+4.3R), GDX 2021-08-04 (+4.0R), and one that failed: NVO 2025-12-12 (a gap through the stop, -3.3R).
Each needs the owner's eye before it is used.

---

## 9. Grading (cues, not a checklist; E50 says grading is his judgment)

| Cue | A+ (size up, E49 1% to 1.5%) | B- (size down, 0.25% to 0.5%) | Basis |
|---|---|---|---|
| Trend | Above a rising 50-day and 200-day after a prior advance | Barely above the 200-day; flat or falling 50-day | [house rule], [UCT], measured |
| Strength | RS 90+, a leader in a leading group; held up while the market fell | RS 80 to 85; group lagging | [house rule] C31, [originator] Wyckoff's test 7 (stronger than the market); the 90 and 85 cut-offs [my proposal] |
| Range | 4 to 12 weeks, flat, 6% to 12% tall, 3+ clean touches of the floor | Short, sloppy or tall (over 20%), only 2 touches | [my proposal], measured |
| Volume in the range | Shrinking on the down swings | Heavy on the down swings | [originator] ChartSchool |
| The dip | Shallow (under about 0.5 ATR), late in the range | Deep (over 1 ATR), or early in the range | [originator] Fraser, ChartSchool |
| Volume on the dip | Quiet; or loud followed by a quiet test that holds | Loud, no test yet | [originator] Fraser #3 / #2; not confirmed on daily bars [my computation] |
| The reclaim | Closes in the top third, then a strong up day on more volume (an SOS) | Weak close, no follow-through | [source consensus]; one-bar or two-bar both qualify (two-bar measured better) |
| Stop | Within 3% | 3% to 5% | [house rule] A13 |
| Room | The range top 4R or more away | Under 3R to the range top | [my computation], [UCT] DELL |
| Market | Green; the index itself just sprang back | Yellow; index choppy | [house rule] B18, [originator] step 5 |
| Earnings, news | None near | Within 3 days (skip, not B-) | [house rule] B22 |

Not tradable (skip, not a grade): below the 200-day; a close back under the spring low; a stop over 5%; earnings within
3 days; an upthrust short above the 200-day.

---

## 10. Questions for the owner

1. **Is "Wyckoff Spring" its own setup in the course, or the classical name inside the shakeout / U&R lesson?**
   (a) its own setup with its own card and tag; (b) a named variant inside U&R (setup 29), taught as a U&R under a flat
   base; (c) vocabulary only (as V.04 does now). I lean to (b): UCT's own words for it are "shakeout" and "UnR".
2. **How long and how clean must the range be?** (a) at least 15 sessions, 2 touches (the app's scanner minimum);
   (b) at least 20 sessions, 2 touches (my proposal); (c) at least 30 sessions, 3 touches (closer to the classic
   schematic). Your DELL and AMZN examples used short ranges (a week or two, sometimes on the hourly chart), which only
   (a) or a looser rule would admit.
3. **Which entry is ours?** (a) the reclaim (your DELL plan); (b) the test; (c) both, by volume (quiet = reclaim, loud =
   test; my proposal); (d) also the back-up after the range top. The data favored the test (+0.11R) over the immediate
   entry on the same springs (+0.06R), on daily bars.
4. **What is the buy point for the 4% chase rule (C28)?** (a) the old range low; (b) the spring day's close.
5. **Stops over 3% (A13):** (a) skip; (b) allow 3% to 5% at a lower grade (my proposal); (c) allow anything with the size
   cut by A5.
6. **Two-bar springs** (a close under the floor, back inside the next day; your AMZN example): (a) count them (they
   measured better, +0.15R); (b) one-bar only.
7. **Volume:** (a) use it to choose the entry (quiet = buy now, loud = wait for the test); (b) a grading cue only; (c)
   ignore it. The daily data showed no difference either way.
8. **The upthrust short:** (a) teach it as a short below the 200-day, graded B at most; (b) teach it only as a warning
   for longs; (c) drop it. It lost money overall in the data, and your failed-breakout-squat view says a leader's failed
   breakout is a later buy.
9. **The app's pattern-engine scanner** (members see its levels through Compass): (a) fix it (accept one-bar springs,
   entry at the reclaim, stop a few cents under the dip, target from the house trims, remove the unsourced Pruden
   statistics and the No Demand and No Supply lines); (b) hide it from members until fixed (add to
   `INTERNAL_PATTERN_IDS`); (c) leave it. Code changes are not mine to make in this task.
10. **Slow shakeouts** (SPY, March 2026: about four weeks under the floor, three of them under the 200-day, then back
    in): (a) a spring for the course, bought once back above the 200-day; (b) a different setup (a terminal shakeout / reclaim of the
    200-day, setup 13); (c) not taught.
11. **A spring under the 200-day after a long decline** (the classic accumulation spring): B26 says no. Teach it as watch
    only, buying the first spring or LPS after it is back above the 200-day? (yes / no)

---

## 11. Sources (all read on 2026-11-09 unless noted)

| # | Source | Publisher, author, date | URL or location | Reliability note |
|---|---|---|---|---|
| 1 | *Studies in Tape Reading* | Richard D. Wyckoff (as Rollo Tape), 1910; scan of a later reprint | https://archive.org/stream/studiesintapere00wyckgoog/studiesintapere00wyckgoog_djvu.txt | Originator; public domain; OCR errors. No "spring" or "upthrust" in it. |
| 2 | "Wyckoff Schematics: Visual templates for market timing decisions" | Hank Pruden and Max von Lichtenstein, *Market Technician* (STA) issue 55, March 2006 | https://www.wyckoffanalytics.com/wp-content/uploads/2019/09/WyckoffSchematics-VisualTemplatesForMarketTimingDecisions.pdf | Originator school; high. Cites Forte 1994 and Hutson 1986 (not read). |
| 3 | "The Wyckoff Method: A Tutorial" | Roman Bogomazov and Michael Lipsett (schematics edited by Hank Pruden), StockCharts ChartSchool | https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial | Originator school, republished by an established educator; high. No date shown. |
| 4 | "Wyckoff Method: Real Rules of the Game" | Wyckoff Analytics (Wyckoff Associates, LLC) | https://www.wyckoffanalytics.com/wyckoff-method/ | Same text as 3; a school that sells courses. |
| 5 | "Richard D. Wyckoff: His Method and Story" (PDF) | Wyckoff Analytics | https://www.wyckoffanalytics.com/wp-content/uploads/2022/06/Wyckoff-Method-Wyckoff-Analytics-English-V2.pdf | Used only for its quote of the Wyckoff course, section 9 (the Composite Man). Secondary for that quote. |
| 6 | "The Composite Man's Bull Market Campaign" | Hank Pruden, Bruce Fraser, Roman Bogomazov, *Technical Analysis of Stocks & Commodities* V.32:8 (2014) | https://www.wyckoffanalytics.com/wp-content/uploads/2019/08/V32C08822PRUD.pdf | Originator school; high. |
| 7 | "Wyckoff - Figure Chart" (slides) | Hank Pruden, CMT Association Educational Web Series, 2012-03-14 | https://cmtassociation.org/wp-content/uploads/2024/01/0314-pruden-1-1.pdf | Used for his bibliography (no hit-rate study listed). |
| 8 | "Francis Bacon Reveals the Nature of Trends" | Bruce Fraser, StockCharts, 2015-06 | https://articles.stockcharts.com/article/articles-wyckoff-2015-06-francis-bacon-reveals-the-nature-of-trends/ | Originator school (GGU instructor since 1987); high. The spring types. |
| 9 | "Take the Fork in the Road" | Bruce Fraser, StockCharts, 2015-08 | https://articles.stockcharts.com/article/articles-wyckoff-2015-08-take-the-fork-in-the-road/ | Same. |
| 10 | "Distribution Definitions" | Bruce Fraser, StockCharts, 2015-09 | https://articles.stockcharts.com/article/articles-wyckoff-2015-09-distribution-definitions/ | Same. UT and UTAD definitions. |
| 11 | "Context is King" | Bruce Fraser, StockCharts, 2015-09 | https://articles.stockcharts.com/article/articles-wyckoff-2015-09-context-is-king/ | Same. Short entry and stop on the UTAD test. |
| 12 | "Trading the Reaccumulation" | Bruce Fraser, StockCharts, 2016-04 | https://articles.stockcharts.com/article/articles-wyckoff-2016-04-trading-the-reaccumulation/ | Same. |
| 13 | "Springing into Action" | Bruce Fraser, StockCharts, 2016-05-06 | https://articles.stockcharts.com/article/articles-wyckoff-2016-05-springing-into-action/ | Same. Entry and stop for #2 and #3 springs. |
| 14 | "Point and Figure Pie in the Sky?" | Bruce Fraser, StockCharts, 2016-07 | https://articles.stockcharts.com/article/articles-wyckoff-2016-07-point-and-figure-pie-in-the-sky/ | Same. UTAD. |
| 15 | "Distribution Review" and "Divining Distribution" | Bruce Fraser, StockCharts, 2018-02 and 2018-03 | https://articles.stockcharts.com/article/articles-wyckoff-2018-02-distribution-review/ ; https://articles.stockcharts.com/article/articles-wyckoff-2018-03-divining-distribution/ | Same. |
| 16 | "Power Charting TV: Scanning for Springs and Upthrusts" | Bruce Fraser, StockCharts, 2022-01-16 | https://articles.stockcharts.com/article/articles-wyckoff-2022-01-power-charting-tv-scanning-for-954/ | Same. The videos it links were not watched. |
| 17 | "Reversal Bars Part 4-1: Springs and Upthrust" | Stewart Taylor, CMT, CMT Association (TradingView idea), 2023-08-21 | https://cmtassociation.org/tradingview-ideas/erjgdnni-reversal-bars-part-4-1-springs-and-upthrust/ | Educator; medium-high. Part 2 (trading it) not read. Disagrees with the Wyckoff school on volume. |
| 18 | ChartSchool Glossary S and U | StockCharts | https://chartschool.stockcharts.com/table-of-contents/glossary/glossary-s ; https://chartschool.stockcharts.com/table-of-contents/glossary/glossary-u | Educator; the 1-3 day window. |
| 19 | Wyckoff Analytics pages on Hank Pruden and David Weis | Wyckoff Analytics | https://www.wyckoffanalytics.com/hank-pruden/ ; https://www.wyckoffanalytics.com/david-weis/ | Biographical only. |
| 20 | "Richard Wyckoff" | Wikipedia | https://en.wikipedia.org/wiki/Richard_Wyckoff | Tertiary; used for dates, the controversy and the research note. Its citations not checked. |
| 21 | "Busted Rectangles" and the home page | Thomas Bulkowski, ThePatternSite.com (busted rectangles updated 2020-12-29) | https://thepatternsite.com/BustRectangles.html ; https://thepatternsite.com/ | Measured statistics, but no sample size on the page. **States a notice against AI training.** Read via WebFetch (plain curl refused) twice, by the writer and the checker; wording not checked against a saved copy. |
| 22 | UCT Substack, the 26 posts quoted in sections 6 and 8 (2025-06 to 2026-11), from the 103-post sitemap; all 103 bodies searched for the counts | Uncharted Territory: TSDR (the owner), Bracco, unsigned sections | https://unchartedterritoryy.substack.com/sitemap.xml and each post linked in section 6 | House voice; high for how we trade it. Re-fetched and checked word for word, twice. |
| 23 | Brain knowledge-base files (Discord summaries) | UCT, in the repo | `docs/study/levels/brain_kb_cycle_2026-11-06.json` (refs t11016, t13315, t10513); `docs/study/levels/brain_kb_rules_2026-11-06.json` (ref t9179) | Member-only material; paraphrased, not quoted. |
| 26 | "Wyckoff Market Analysis" | StockCharts ChartSchool, unsigned | https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/wyckoff-market-analysis | Added in checking: the home of the base catalog's "steadfast rules" quote. Educator paraphrase, not Wyckoff's words. |
| 27 | *Trades About to Happen*, publisher's page (table of contents) | Wiley | https://www.wiley-vch.de/en/areas-interest/finance-economics-law/trades-about-to-happen-978-0-470-48780-8 | Added in checking: confirms chapters 5 "Springs" and 6 "Upthrusts". Book not read. |
| 24 | Repo files | this repo, branch feat/study-content | `api/services/pattern_engine/detectors/uct/wyckoff_spring.py`, `wyckoff_upthrust.py`; `api/services/screener/base_catalog.py` (`WYCKOFF_SPRING`); `api/services/pattern_engine/setup_draw_r2.py`, `setup_draw_r3.py`; `api/services/auto_structures.py`; `api/services/pattern_engine/detectors/registry.py`; `api/routers/patterns.py`; `tests/fixtures/wyckoff_spring/_generate.py`; `app/src/pages/modelbook/setupCatalog.js`; `app/src/constants/setupGroups.js`; `docs/study/courses/V/V.04.json`; `docs/study/UNITS-foundations.md`; `docs/study/sizing_rule.md`; `docs/study/TRADE_PLANS.md`; `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | Read directly; the detectors were also imported and run read-only. |
| 25 | My computations | session scratchpad, `setups/35-wyckoff-spring-upthrust/tools/` | `wy_scan.py`, `analyze.py`, `alt_entries.py`, `baseline_random.py`, `app_det_run.py`, `house_examples.py`, `probe_detector.py`, `quotecheck.py` | Not peer-reviewed; limits in 4.3. |

**Named but not read** (so no wording from them is used): Wyckoff's 1931 course itself; Jack K. Hutson (ed.),
*Charting the Stock Market: The Wyckoff Method* (1986); Jim Forte, "Anatomy of a Trading Range", *MTA Journal* 43
(1994); Hank Pruden, *The Three Skills of Top Trading* (Wiley, 2007); Pruden's IFTA Journal articles (2004, 2008,
2010); David H. Weis, *Trades About to Happen* (Wiley, 2013); any Volume Spread Analysis source.

---

## 12. Removed or fixed in checking (2026-11-09, cold check)

Method: every URL and PDF in section 11 was fetched afresh (plain `curl`, or WebFetch for Bulkowski), the 103 Substack
posts were pulled from the sitemap, and a script matched all 204 double-quoted passages in this file against those
copies after normalising quotes, dashes and line-break hyphens. All 204 matched (the two Bulkowski quotes and the three
detector-narrative quotes were matched by eye against WebFetch's reading and the `.py` f-strings). The scanner summary in
5.1, the catalog in 5.2 and the drawing constants in 5.3 were re-read against the code and are correct; the writer's
probe and replay were re-run (section 4.4) and every number matched. Changes made:

- **Fixed.** Section 1: "Wyckoff's contemporaries accused him of market manipulation and ... his own trading record is
  disputed" overstated Wikipedia, which says he "was criticized for his market manipulation techniques by his
  contemporaries" and records profitable years (1915-19) and heavy losses (1921-23). Rewritten with the page's words.
- **Fixed.** Section 2: the course was dated "1931 to 1934" with no source; Pruden, Fraser and Bogomazov (2014) give
  1931, so the row now says 1931 and cites them.
- **Fixed.** Section 2: Hutson (1986) was "cited by Pruden as a source of the schematics"; Pruden's PDF credits the
  schematics to Forte and lists Hutson only in the bibliography. Corrected.
- **Fixed.** Section 2: Weis (2013) was said to have "chapters on springs and upthrusts (per Wyckoff Analytics' page on
  Weis)"; that page names the book but no chapters. The chapters are real (Wiley's table of contents: 5 "Springs", 6
  "Upthrusts"), so the claim stays with the right source.
- **Fixed.** Section 5.2: the catalog's "Instead of steadfast rules ..." quote, which the writer "could not trace", is
  ChartSchool's unsigned "Wyckoff Market Analysis" page. Added, with the caution that it is an educator's paraphrase.
- **Fixed.** Section 6: the "UNR / UnR" count (54 in 32) could not be reproduced; the checker's count over all 103 post
  bodies is 27 in 19 for the tokens, 48 in 34 counting "U&R" and "undercut and rally". The shakeout count moved from 110
  to 112 (counting "shake out"). Other counts matched.
- **Fixed.** Section 6.2 and 11: Manrav's MU note (ref t9179) is in `brain_kb_rules_2026-11-06.json`, not the cycle file.
- **Fixed.** Section 4.2: Bulkowski's 71% single-bust figure carries his own qualifier "in bull markets", which was
  missing; his wording is now quoted rather than paraphrased.
- **Removed.** Section 11, row 21: the page title "Trading Tricks & Traps", which neither reader could confirm on the
  site.
- **Removed.** Section 11, row 22: "the 31 posts quoted or checked" (26 posts are actually quoted, 25 in section 6 and
  one more in 8.1; the writer's extra five were read for the counts). Row now says 26 quoted, all 103 searched.
- **Checked and kept.** The Pruden 2007 / 2008 publication-date note (ChartSchool cites 2007; the 2014 article's
  references cite 2008), Fraser's 1987 Golden Gate start, the glossary's "1-3 days", Taylor's 2023-08-21 date, Forte
  1994 (*MTA Journal* 43, Summer-Fall), the detector docstring's "1908-1934", the blind-judge scores in 5.3, the V.04
  item keys (q45, q48, q57, q65) and the Discord-summary dates all check out against their sources.

---

## 13. Examples (from our data)

(Numbered 13 because section 12 above is the cold-check record; this is the examples section the workflow calls
"12. Examples (from our data)".) Scan written and run 2026-11-09 night in
`_study-resume/scratchpad/setups/35-wyckoff-spring-upthrust/` (`scan35.py`, `chart35.py`, hits in `final/hits.json`,
charts and the three phone sheets in `final/`). Nothing here has been shown to the owner; every chart was looked at by
the helper, not by him.

**The scan's rule (section 8 plus the house rules), in one paragraph.** Daily bars, 2000-01 to 2026-11, the 2,630
names that ever met B23 ($10 and $20M a day, both checked on the day before the trigger). *Spring:* the close is above
the 200-day SMA (B26); behind the trigger sits a sideways range of 60, 40 or 25 sessions (the longest that fits) whose
height is 6-20% of its floor, whose closes drift less than a quarter of that height, and whose floor was touched by at
least two swing lows within half an ATR of the lowest low, at least 5 sessions apart; the trigger day's low undercuts
that floor by 0.1 to 1.0 ATR(14) and the close is back above the floor the same day (one-bar) or the next day (two-bar),
the reclaim day closing in its upper half. *Upthrust:* the mirror at the ceiling, with the close below the 200-day.
Entry is a market order at the next open (E57); if that open is back under the floor (over the ceiling), the fill is
taken at the floor (ceiling) when price trades through it that day; no entry more than 4% past the floor/ceiling (C28).
Stop 3 cents beyond the probe's extreme low/high (A13 / F62), skipped when wider than 5%. No trigger within 3 trading
days of an earnings reaction day (B22, from the sandbox's Yahoo + 8-K dates). One hit per name per 30 sessions. Not
applied, because the sandbox has no RS rating or group data: C31's RS 80+ for springs and the "RS 20 or less, weak
group" filter for upthrust shorts. Outcome: the first of stop, 3R or 5R over the next 60 sessions, a fixed stop with
no trims, no breakeven move and no trail, so the percentages are a base rate for the entry, not the house trade.

**Base rate.** 4,774 hits (2,630 of 2,630 liquid names scanned, 105 seconds, complete): 25.4% reached 3R and 16.2%
reached 5R before the stop. By side: 3,173 springs, 27.1% to 3R, 17.7% to 5R, 83.8% stopped within the window (median
stop 2.15%); 1,601 upthrust shorts, 22.0% to 3R, 13.2% to 5R, 89.3% stopped (median stop 1.98%). Splits that the
proposed rules care about (springs): one-bar 27.2% vs two-bar 26.0% to 3R; stop under 3%: 27.1% to 3R / 18.5% to 5R,
stop 3-5%: 27.1% / 15.1%; probe 0.1-0.5 ATR 27.5% vs 0.5-1.0 ATR 26.0%; two floor touches 27.6% vs three or more 26.4%;
by era 2000-07 23.8%, 2008-09 20.5%, 2010-19 31.6%, 2020-26 24.9%. The upthrust short runs 21-23% to 3R in every split,
with no era or shape that stands out. Read with the caveat above: a fixed stop and no trims; the house trade (a third at
3R, a third at 5R, trail) is not what was measured, and the stop is hit far more often than the 3R target, so the
expectancy of the raw entry is roughly flat (section 4.4 measured it at +0.06R to +0.11R depending on the entry).

**The 10 examples** (one per ticker; prices as the sandbox's split-adjusted bars; "buy" is the next-open fill the scan
took, "stop" 3 cents past the probe's extreme; "best R" is the high-water mark before the stop within 60 sessions).

| # | Ticker | Trigger | Side | Range (sessions, floor-ceiling, height, floor touches) | Probe | Buy / short | Stop (%) | 3R in | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | GIS | 2001-10-15 | spring, one-bar | 60 d, 21.30-23.30, 9.4%, 4 touches | 0.13 ATR under the floor, 1.16x volume | 21.43 | 21.22 (0.96%) | 7 d | 23.8R | A flat 12-week shelf with four floor touches above a rising 200-day, a shallow one-day undercut that closes back inside, then a straight run through the ceiling. No earnings in the window. |
| 2 | AAPL | 2014-04-15 | spring, one-bar | 40 d, 18.41-19.69, 6.9%, 2 touches | 0.63 ATR, 1.01x | 18.50 | 18.23 (1.46%) | 6 d | 21.1R | Tight 8-week range on a leader above all its averages; the probe runs under the 21-day and the floor and closes near the high. Caveat for the learner: it had reached 1.87R when AAPL reported (04-23 after the close; the entry was 5 sessions before, so B22 allowed it) and the 3R came on the report gap of 04-24. |
| 3 | ULTA | 2015-05-15 | spring, one-bar | 25 d, 149.53-158.97, 6.3%, 2 touches | 0.15 ATR, 0.93x | 150.40 | 149.09 (0.87%) | 7 d | 15.9R | The quietest kind: a 5-week pause after a steady advance, a dip of a few cents under the floor on average volume, a reclaim the same day. Reached 4.65R before its 05-28 report. |
| 4 | PH | 2017-08-18 | spring, one-bar | 40 d, 155.04-167.50, 8.0%, 2 touches | 0.49 ATR, 0.81x | 155.40 | 153.62 (1.15%) | 8 d | 19.3R | A reaccumulation range in a stock well above its 200-day; the probe comes on below-average volume (Fraser's "quiet" spring, buy the reclaim). No earnings in the window. |
| 5 | KMX | 2020-12-29 | spring, two-bar | 25 d, 91.25-100.68, 10.3%, 4 touches | 0.31 ATR, 0.94x | 91.79 | 90.27 (1.66%) | 5 d | 29.4R | The two-bar form: the first day closes under the floor, the second closes back above it in its upper half. Four touches of the floor, stop still under 2%. (The 60 sessions before the range fell 13%, so it is a base after a correction, not Fraser's stepping stone; graded lower on that row.) |
| 6 | ODFL | 2021-10-01 | spring, one-bar | 25 d, 141.88-152.11, 7.2%, 5 touches | 0.75 ATR, 0.96x | 142.69 | 139.47 (2.26%) | 10 d | 13.7R | Five floor touches then one deeper probe (three-quarters of an ATR) that still closes back inside on normal volume; the kind of spring the test entry (8.2 B) would also have caught. Report came 18 sessions later, after 3R. |
| 7 | AVGO | 2023-05-04 | spring, one-bar | 40 d, 60.32-64.85, 7.5%, 2 touches | 0.15 ATR, 0.82x | 61.59 | 60.10 (2.43%) | 9 d | 20.6R | The dossier's own scan candidate, now checked by eye: a leader 11% above its 200-day, a tight 8-week range, a cents-deep probe on light volume, then the run (3R before the 06-01 report; the report gap came after 5R). |
| 8 | HWM | 2025-08-20 | spring, one-bar | 40 d, 170.34-193.26, 13.5%, 3 touches | 0.14 ATR, 0.84x | 171.85 | 169.42 (1.41%) | 10 d | 16.5R | A stepping-stone range after a 31% run (the preferred prior trend in 8.1), three floor touches, a shallow quiet probe; the only range here over 10% high, so it shows the upper end of the proposed 6-20% band. |
| 9 | GS | 2018-11-08 | upthrust, one-bar | 25 d, 208.40-232.80, 11.7%, 2 touches | 0.21 ATR over the ceiling, 0.81x | short 231.69 | 234.09 (1.04%) | 1 d | 33.3R | The short mirror where B26 allows it: below a falling 200-day, under the 50-day; the probe over the ceiling closes back inside, the next day breaks and the stock falls 30%. 3R on the first day. |
| 10 | TGT | 2023-07-27 | upthrust, one-bar | 25 d, 128.55-136.36, 6.1%, 4 touches | 0.80 ATR, 0.87x | short 135.85 | 138.31 (1.81%) | 13 d | 13.4R | A 5-week range at the lows after a 25% decline, four ceiling touches, the upthrust pokes most of an ATR over the ceiling and closes back inside. Reached 4.43R before the 08-16 report; the report gap added the rest. |

Years covered: 2001, 2014, 2015, 2017, 2018, 2020, 2021, 2023 (two: a spring and an upthrust), 2025. Two charts
were considered and dropped on sight: HSIC 2018-09-04 (the "range" is a shelf after a run with a gap inside it; not a
clean floor) and MSFT 2020-09-18 (the 18% "range" slopes, with the high at the end; not flat). NSC 2009-10-01 and
ROK 2023-05-11 were clean but duplicated a year or had a 17% range; EWJ, SKYY, XLI, IBB and GDX were skipped as ETFs.
Nothing was found wrong with the data of the ten (splits adjusted, no reused tickers). The RS-80 condition could not
be checked for any of them.

**Notable failures** (all house-legal by the scan's rules; from `final/hits.json`).
- **TSLA 2025-02-06** (spring, 25-day range 373.04-439.74, 17.9% high, three touches, probe 0.52 ATR, 0.97x volume,
  stop 2.65%): bought 373.04 (the floor: the entry-day open, 370.19, was under it). The entry day's high, 380.55, was
  7.51 (0.76R) over the fill, but the same bar's low, 360.34, went through the 363.15 stop and the scan counts the stop
  first, so the best is recorded as 0.0R (corrected 2026-11-10 against the bars): the earlier text said it never traded above the entry. It broke the
  spring low on the entry day and gapped on. A tall range (near the top of the 6-20% band) after a 73% run in the prior 60 sessions, in a market
  that was turning down; the dossier's own candidate failure, confirmed.
- **MSFT 2023-08-08** (spring, 40-day range, 13.1% high, three touches, a cents-deep 0.16 ATR probe on 0.76x volume,
  stop 1.07%): everything the rules ask for, and it was stopped on the entry day (2023-08-09). The day's high, 327.11,
  was 0.64 (0.18R) over the 326.47 fill, but the same bar's low, 321.05, went through the 322.97 stop and the scan
  counts the stop first (best 0.0R) (corrected 2026-11-10 against the bars): the earlier text said it never showed a profit and was stopped on the
  third day. The lesson is section 8.5's number: a spring that fails usually fails at once, so the stop under the spring low is the
  trade, not a formality.
- **AAPL 2021-10-01 and QQQ 2021-10-01** (both springs on the same day, both 0.0R): a market-wide shakeout that did
  not finish; the index's own spring failed, and so did the leader's. Wyckoff's step 5 (time the stock with a turn in
  the index) is the lesson.
- **NVO 2025-12-12** (upthrust short, stop 1.64%): ran to 2.98R, a hair short of the 3R trim, then gapped from 48.10
  to an open of 52.67 through the 50.78 stop on 12-23. B20 applies (the first 30-minute low becomes the new stop); a
  reminder that the upthrust short below the 200-day is still capped at grade B.

Charts: `final/01_GIS_2001-10-15.png` to `final/10_TGT_2023-07-27.png`; phone sheets `final/sheet_1-4.png`,
`final/sheet_5-7.png`, `final/sheet_8-10.png` (all outside the repo, in the scratchpad named above).

## 14. Failures and near-misses (from our data)

Added 2026-11-10 (deliverable 4 of `CRITERIA_PROGRAMME.md`). Everything below is read off the same scan as section 13
(`final/hits.json`) or off a re-run of `scan35.py`'s spring rule with one gate relaxed at a time (`near_scan.py`, the
full liquid universe, 240 seconds per gate), never off a chart alone. Charts: `final/fail_1-4.png` (the four failures,
one column), `final/near_1-4.png` (the four near-misses) and `final/pair_29-undercut-rally.png` (a textbook spring over
a textbook U&R), in `_study-resume/scratchpad/setups/35-wyckoff-spring-upthrust/` (scratch, not in the repo). Every
chart carries the floor, the stop, 3R and 5R and the range box, so a learner can compare a failure or a near-miss with
the winners of section 13 at a glance. SPY numbers are the sandbox's own bars. Springs only; the upthrust short (NVO
2025-12-12 in section 13) is not re-charted. "Buy" is the next-open fill the scan took (section 13), so "stopped on the
entry day" means the first session after the spring day, the session the position was opened in.

**Failures: valid springs, traded by the rules, stopped before 3R.** All four passed every gate the scan can read
(above the 200-day, a 25 to 60 session range 11.8% to 17.9% tall with 2 or 3 floor touches and closes drifting less
than a quarter of the height, a probe of 0.14 to 0.54 ATR that closed back inside the same day in its upper half, a stop
of 1.1% to 2.7%, $2 billion or more a day, no report in the window); all four were stopped on the entry day with a
best excursion of 0.0R.

| # | Ticker | Spring day | Range (sessions, floor-top, height, touches) | Probe / closes under / reclaim | Buy (next open) | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|---|---|
| 1 | GOOGL | 2019-05-09 | 40 d, 57.92-64.85, 12.0%, 2 | 0.14 ATR to 57.73, on 0.91x volume / 0 / same day | 58.44 (05-10) | 57.70 (1.27%) | 05-10, low 57.32, closed 58.38 | The entry day dipped through the stop and closed back above the entry; the stock then fell to 51.35 by 06-03 (53.42 twenty sessions on) as SPY made lower lows (279.93 on 05-13, under its 285.81 20-session low). Not a Green market. | spr.market_reading |
| 2 | AAPL | 2021-10-01 | 60 d, 140.67-157.26, 11.8%, 2 | 0.54 ATR to 139.11, on 1.24x / 0 / same day | 141.76 (10-04) | 139.08 (1.89%) | 10-04, low 138.27, close 139.14 | Stopped on the entry day as SPY made a lower low (426.36 under its 428.78 20-session low); QQQ sprang the same day and failed too (0.0R in the same scan). The index's own spring had not held. It was 149.80 twenty sessions later, from a later base. | spr.index_sprung |
| 3 | MSFT | 2023-08-08 | 40 d, 324.41-366.78, 13.1%, 3 | 0.16 ATR to 323.00, on 0.76x / 0 / same day | 326.47 (08-09) | 322.97 (1.07%) | 08-09, low 321.05, close 322.23 | A cents-deep probe on light volume, three touches, a 1% stop: everything the rules ask for, and it was stopped on the entry day (the day's high, 327.11, was 0.64 or 0.18R over the fill, but the same bar took the stop and the scan counts the stop first) (corrected 2026-11-10 against the bars); 311.55 on 08-18, the day SPY made its lower low (433.01). 332.88 twenty sessions on. A spring that fails usually fails at once. | spr.after_entry_stop |
| 4 | TSLA | 2025-02-06 | 25 d, 373.04-439.74, 17.9%, 3 | 0.52 ATR to 363.18, on 0.97x / 0 / same day | 373.04 (02-07, the open was under the floor; filled at the floor) | 363.15 (2.65%) | 02-07, low 360.34, close 361.62 | The entry day's high (380.55) was 0.76R over the 373.04 fill, but the same bar's low (360.34) took the stop, which the scan counts first (best 0.0R) (corrected 2026-11-10 against the bars): the earlier text said it never traded above the entry. It broke the spring low on the entry day and gapped on, 250.73 by 03-07 (262.67 twenty sessions on). SPY made no lower low in the next 10 sessions: this one was the stock's own, a 17.9% tall range (near the 20% limit) after a 73% run in the prior 60 sessions. | spr.range_height |

**Near-misses: charts that look like a spring and fail exactly one gate.** Each was found by relaxing that one gate in
the scan and keeping only the hits the strict rule rejects for it; every other gate passed. The four are the four tells
the card's lookalikes rest on: the depth of the dip, the speed of the reclaim, the number of floor touches and the
length of the range.

| # | Ticker | Date | The one criterion that fails | The number | Floor / probe / closes under / reclaim | What it really is |
|---|---|---|---|---|---|---|
| 1 | COST | 2021-01-20 | spr.dip_depth | The probe went 1.34 ATR under the 359.50 floor (to 352.44); the rule is 0.1 to 1 ATR (1 to 2 ATR grades lower, over 2 is a breakdown). | 359.50 (25 d, 6.1%, 2 touches) / 352.44 / 1 / next day | A deeper shakeout, two-bar: buy 361.30 at the 01-21 open, stop 352.41 (2.46%); made 0.52R and was stopped; the stock lost 13% in the next six weeks. By the card, a lower grade and a smaller size, or the test entry. |
| 2 | INTC | 2005-08-29 | spr.reclaim_window | 3 closes under the 25.61 floor; the close back inside came on day 4. The rule is the same day (one-bar) or the next (two-bar). | 25.61 (60 d, 12.6%, 2 touches) / 25.31 (0.57 ATR) / 3 / day 4 | A U&R of the range low at best (3 closes under is the U&R's limit), with more closes a Remount, not a spring. Buy 25.65 at the 08-30 open, stop 25.28 (1.44%); made 0.35R, stopped; 23.83 twenty sessions on. |
| 3 | AMZN | 2021-08-12 | spr.floor_touches | The floor (164.99) was touched by ONE swing low, 40 sessions old, that price rallied 14% off; the rule is a flat floor touched at least twice, 5 sessions apart. | 164.99 (one low, 06-15) / 163.48 (0.41 ATR) / 1 / next day | A 2B of a single swing low (setup 28), not a spring: there is no flat range to look left at. Buy 165.28 at the 08-13 open, stop 163.45 (1.11%); made 0.01R, stopped; 173.46 twenty sessions on, from a lower low (158.79). |
| 4 | NFLX | 2025-09-15 | spr.range_length | The range behind the probe is 19 sessions long (118.24-126.71 from 08-18); the rule is 20 or more. | 118.24 (19 d, 7.2%, 2 touches) / 117.32 (0.33 ATR) / 0 / same day | A U&R of a three-week shelf low (setup 29), not a spring. Buy 120.56 at the 09-16 open, stop 117.29 (2.71%); made 0.87R, stopped; 121.90 twenty sessions on. |

**What the failures have in common.** All four were quiet, shallow probes of a flat range in a leader above its
200-day, exactly what the card asks for, and all four were stopped on the entry day with a best excursion of 0.0R
(the scan's convention when the bar that took the stop also traded over the fill, as TSLA's and MSFT's did),
which is section 8.5's number in one picture (41% of springs broke their low before any test came). Three of the four
(GOOGL, AAPL, MSFT) came while SPY was making, or about to make, a lower low: the index had not sprung, so the stock's
spring was a shakeout that kept going. TSLA was the stock's own: a tall range near the 20% limit after a 73% run, in
which the "floor" was a ledge on the way down. The teaching is the card's own: the stop under the spring low is the
trade, not a formality, and Wyckoff's step 5 (time the commitment with a turn in the index) is a gate here, not a
footnote. The near-misses show the four counts a learner must make before calling a spring: how deep (0.1 to 1 ATR),
how fast back inside (the same day or the next), how many floor touches (two or more, 5 sessions apart), and how long
the range (20 sessions or more); miss one and it is a 2B, a U&R or a Remount, each with its own card.

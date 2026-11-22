# Setup 33: Failed Head & Shoulders / Rounded Top (asked for as a short; the house uses it as a long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. **Cold-checked 2026-11-09 by a second
reader:** every quote was re-opened at its source (the two book OCR texts re-downloaded from archive.org, the Brandt,
StockCharts, Wyckoff Analytics, IBD and Substack pages re-fetched, Bulkowski's pages read again through a fetch tool);
the scanner summary was re-read against the code; the bar-store prices in 4.6 and 6 were re-queried; the writer's
simulation summaries were compared line by line with the numbers quoted. Corrections are marked "[checked]" where they
sit and listed under "Removed in checking" at the end. Every quote below was copied from the page,
file or transcript named next to it, and kept to 40 words or fewer. Book quotes come from Internet Archive OCR text; I
removed line-break hyphens the scan left inside words, and throughout I wrote curly quote marks and apostrophes as straight
ones; nothing else was changed. Nothing here is a ruling. Where I could
not read a source, I say so and give no wording from it. Numbers marked [my computation] come from my own read-only
scripts run on the app's daily bar store with the app's own detectors (method and limits in 4.5). Numbers marked
[my proposal] are mine, for the owner to accept or change.

Tags used in section 8: **[originator]** the people who named or defined the pattern (Edwards and Magee, Murphy,
Bulkowski, Brandt); **[source consensus]** several outside sources agree; **[UCT]** UCT's own writers or the owner;
**[house rule]** the account rulebook, `docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation.

**The short version.**
- **The direction.** The task framed setup 33 as a short. Every house record frames it as a **long**: the Model Book
  card (`direction: 'long'`, "when the breakdown never comes, the squeeze fuels the next leg up"), the course plan
  (`UNITS-method.md` SET.29, "entry over the right-shoulder high"), the house research note (`definitions.json`, "The long
  side of a bearish pattern that does not work") and UCT's public posts (Bracco in 7 posts, the owner in 2,
  2025-09 to 2026-08; every one that names a failure reads it as bullish). The classical meaning agrees: a failed head-and-shoulders **top** is bullish.
- **Where a short does exist.** (1) The mirror image, a failed head-and-shoulders **bottom** (Bulkowski's "busted
  head-and-shoulders bottom"), which lives below the 200-day and fits rule D47 ("shorts are our long setups reversed").
  (2) The classical pattern working: shorting the neckline break of a head-and-shoulders top or rounding top. That second
  short mostly happens **above** the 200-day (70% of the neckline breaks from tops that formed above it, in my run,
  4.5), where rule B26 forbids shorts.
- **UCT's own line, the clearest in the record.** Bracco, 2026-04-19: "Remember the only way to trade a H&S pattern is
  to trade the failure of it." Bracco, 2025-09-01: "the best way to trade a head and shoulders top is to buy the failed
  breakdown of it."
- **Who named it.** No one coined "Failed H&S / Rounded Top" as one setup; it is the house's name. Murphy (1999) has a
  section titled "The Failed Head And Shoulders Pattern" and says the name is "often called". Edwards and Magee (11th
  edition; first published 1948) call the pre-break version "saved" and the post-break version a "false move". Bulkowski calls it a "busted"
  pattern and measures it. Peter Brandt calls it an "H&S failure" and trades it in three steps (A, B, C). The "rounded
  top" half has no failure literature by that name; Bulkowski measures the rounding top's **upward** breakout, which is
  the same event.
- **What has been measured.** Bulkowski: 32% of head-and-shoulders tops that break down "bust"; busted tops average a
  35% gain, single busts 67%. Rounding tops that break **up** rank 2 of 39 patterns (9% failure, 55% average rise).
  Edwards and Magee estimate (no data) that "perhaps 20%" of tops are saved before the neckline breaks.
- **My run of the app's own detectors** (600 liquid stocks and ETFs, 2010 to 2026, house trade management):
  a close back over the right shoulder **after** a neckline break (Brandt's "C") averaged **+0.11R** (95% CI +0.07 to
  +0.16; +0.13R above the 200-day), against **+0.01R** for a generic strong-day entry. The "breakdown never came"
  version averaged +0.04R. Shorting the neckline break averaged **-0.10R**. The short mirror (a failed inverse H&S)
  averaged -0.02R. The rounded top showed no edge either way. The failed-breakdown long was strongest when SPY was under
  its 50-day (+0.30R). These are small edges in a survivor-only
  sample with no costs; read 4.5 before using any of them.
- **The app.** No scanner looks for the failure. Two classical detectors (`head_shoulders.py`, `rounded_top.py`) look for
  the **forming top** and print **short** levels. Neither is linked to this tag. Their narrative text contains a Brandt
  quote I could not find, a Bulkowski number his own page contradicts, and a "Wyckoff 1908" date no source supports
  (section 5).
- **Rulebook fit.** The long fits the house well: 79% of post-break failures were above the 200-day (B26), and the house
  stop under the trigger day's low had a median distance of 2.1% (A13). The "structural" stop under the failed-break low
  did not fit (median 9.3%). The rounded-top detector's own stop was never within 3% (median 19.5%).

---

## 1. What it is, and the psychology

**In two sentences.** A stock builds a topping pattern that chart readers know well (three peaks with the middle one
highest, or a slow dome), so many expect a breakdown, and instead price either never breaks the neckline or breaks it
briefly and snaps back. The long is bought when price proves the top wrong, most commonly on a move back over the right
shoulder's high, with the stop a few cents under that day's low.

**Two versions of "failed".** The sources describe two different events, and the house uses both words:
- **A. The breakdown never comes.** Price stalls at the right shoulder, holds above the neckline and rises again.
  Edwards and Magee call these patterns "saved". The Model Book card describes this one ("when the breakdown never
  comes").
- **B. The breakdown comes and fails.** Price closes under the neckline, does not fall far, then climbs back over the
  neckline and the right shoulder. Murphy, Bulkowski and Brandt all describe this one, and so do all of Bracco's examples
  ("buy the failed breakdown").

**Why it can work (reasoning from the sources, not a measured fact).**
- **Trapped sellers.** The head-and-shoulders is famous, so a visible neckline gathers short sellers and stop orders from
  longs. Brandt: "novice market analysts are way to quick to mislabel market action as a H&S configuration." The Wyckoff
  school describes the same mechanics at a support break: a spring "takes price below the low of the TR and then
  reverses to close within the TR; this action allows large interests to mislead the public about the future trend
  direction" (Wyckoff Analytics). Bracco on AMD (2026-08-16): "Has potential to catch some people offsides imo…"
- **Supply absorbed.** When a widely expected breakdown does not follow through, the sellers who wanted out have sold.
  Patrick on the same AMD chart: "Everyone saw rounding top and it gave nothing back after a massive massive move higher
  in April May and June."
- **Information.** Brandt: "Often a pattern failure tells a better story than does a pattern completion."

**Why it often fails (also reasoning).**
- **It can be late in the move.** Edwards and Magee: "such developments almost never occur in the early stages of a
  Primary Advance. A Head-and-Shoulders Formation that does not work is a warning that even though there is still some
  life in the situation, a genuine turn is near."
- **Failures fail too.** Brandt: "Most chart formations fail and morph into other patterns, which in turn fail and morph
  again." Bulkowski counts patterns that bust two and three times (section 4).
- **Most "head-and-shoulders" are not.** Brandt warns that the pattern is over-called (quote above). A failure of a
  pattern that was never real tells you nothing.

---

## 2. Origin and naming

- **The head-and-shoulders top.** Edwards and Magee, *Technical Analysis of Stock Trends* (first edition 1948; I read the
  11th edition, 2018, edited by W.H.C. Bassetti), Chapter 6: "This is one of the more common and, by all odds, the most
  reliable of the Major Reversal Patterns." Brandt names the older source: "Schabacker, Edwards and Magee are the
  authoritative sources on classical charting principles." I could not read Richard Schabacker's book. Brandt dates his
  *Technical Analysis and Stock Market Profits* "written in 1937"; the app's detector text says 1932. [checked] The
  publisher of the modern reprint, Harriman House, dates the first edition 1932: his 1930 book "was followed in 1932 by
  Technical Analysis and in 1934 by Stock Market Profits: A Course in Forecasting" (author page, source 18). Brandt's
  1937 is not explained by that page; it may refer to a later edition, which I could not confirm.
- **"Failed head and shoulders".** John J. Murphy, *Technical Analysis of the Financial Markets* (New York Institute of
  Finance, 1999), Chapter 5 has a subsection titled "The Failed Head And Shoulders Pattern". He says the post-break
  version "creates what is often called, for obvious reasons, a failed head and shoulders", so the name was already in use.
- **"Saved" and "false moves".** Edwards and Magee's words for the pre-break and post-break failures (Chapter 6).
- **"Busted" pattern.** Thomas Bulkowski (thepatternsite.com and his *Encyclopedia of Chart Patterns*): price "moves no
  more than 10% after the breakout before reversing and zipping to the other side of the chart pattern" (his glossary).
  His page "Busted Head-and-Shoulders Tops" measures this exact event.
- **"H&S failure".** Peter Brandt (Factor Trading), e.g. "It's as easy as "ABC" – classic H&S failure in Corn"
  (2011-05-18).
- **Rounded top.** Edwards and Magee, Chapter 7, "Rounding Turns": "Rounding Tops are sometimes called Inverted Bowls."
  Bulkowski: "rounding top" ("Prices form a gentle curve, a half moon shape."). The app's detector also uses "Saucer Top"
  and "Dome Top"; I did not find those two names defined in a source I read. Murphy uses "saucer" only for bottoms.
- **Wyckoff names for the same mechanics.** A failed break of support in an uptrend is a "spring" or "shakeout" inside a
  "re-accumulation" range; a slow top is a "distribution" range (Wyckoff Analytics, section 3.6). Setup 35 (Wyckoff
  spring / upthrust) covers that vocabulary.
- **The house name.** Journal tag `Failed H&S/Rounded Top` (Swing list); Model Book card `Failed H&S / Rounded Top`
  (family Reversals & Reclaims). The house vocabulary file has no entry for it ("the authors did not name it in the
  Session 0 samples", `docs/wisdom/vocabulary/setup-vocabulary-v1.json`). The only UCT use of both halves together is
  Bracco's "failed rounded top / H&S" (AMD, 2026-08-16).
- **Not found.** Kullamägi (his 9 site posts have no mention), IBD (only article teasers were readable), Minervini,
  O'Neil's books, Weinstein's book and Stockbee were not read for this setup. Nothing is quoted from them.

---

## 3. Every definition I could find, source by source

### 3.1 Edwards and Magee, *Technical Analysis of Stock Trends*, 11th edition (CRC Press, 2018), Chapters 6 and 7 (originator)

The head-and-shoulders top (Chapter 6, "The Head-and-Shoulders Top Formation", items A to D):
- **Prior trend and left shoulder (A):** "A strong rally, climaxing a more or less extensive advance, on which trading
  volume becomes very heavy".
- **Right shoulder (C):** "A third rally, but this time on decidedly less volume than accompanied the formation of either
  the left shoulder or the head, which fails to reach the height of the head".
- **Confirmation (D):** "a close below that line by an amount approximately equivalent to 3% of the stock's market price.
  This is the "confirmation" or "breakout.""
- **All four are required:** "Note that each and every item cited in A, B, C, and D of Diagram 6.1 is essential to a
  valid Head-and-Shoulders Top Formation."
- **Volume (an estimate, not a count):** "Roughly estimated, about one-third of all confirmed Head-and-Shoulders
  Formations show more volume on the left shoulder than on the head".
- **The pre-break failure:** "Until the neckline is broken, a certain percentage of Head-and-Shoulders developments,
  perhaps 20%, are "saved"" and, in the same sentence, prices "simply flounder listlessly for a period of time in the
  general range of the right shoulder, then eventually firm up and renew their advance."
- **The post-break failure:** ""False moves" such as this are the most difficult phenomena with which the technical
  analyst has to cope. Fortunately, in the case of the Head-and-Shoulders, they are extremely rare."
- **What a failure means:** "such developments almost never occur in the early stages of a Primary Advance. A
  Head-and-Shoulders Formation that does not work is a warning that even though there is still some life in the
  situation, a genuine turn is near."
- **Entry, stop, target for a failure:** none given. The book treats the failure as a warning, not a trade.

The rounding top (Chapter 7, "Rounding Tops and Bottoms" and "How Rounding Turns affect trading activity"):
- **Shape:** "It pictures simply and plainly a gradual, progressive, and fairly symmetrical change in the trend
  direction, produced by a gradual shift in the balance of power between buying and selling."
- **Where it appears:** "Tops of the Rounding type are rare among stocks in the lower and medium-price ranges". The book
  adds that "Rounding Tops almost never develop" in "lower priced, speculative common stocks" (the OCR splits this
  sentence around a figure caption).
- **Volume:** "The volume pattern on Rounding Tops is seldom as clearly defined as at Bottoms. Indeed, it is apt to be
  rather high and irregular throughout the entire rounding-over movement in prices."
- **Target and reliability:** "We know of no measuring formula that can be applied to Rounding Turns" and "they almost
  never deceive."
- Source: Internet Archive OCR text of the 11th edition (link in section 11).

### 3.2 John J. Murphy, *Technical Analysis of the Financial Markets* (NYIF, 1999), Chapter 5 "Major Reversal Patterns" (originator of the name's best-known definition)

- **Standing:** "probably the best known and most reliable of all major reversal patterns".
- **The seven ingredients (his summary list):** "1. A prior uptrend." ... "5. A third rally (point E) on noticeably light
  volume that fails to reach the top of the head (at point C). 6. A close below the neckline." 7. a return move to the
  neckline followed by new lows.
- **Right-shoulder depth:** "(That last rally at point E will often retrace one-half to two-thirds of the decline from
  points C to D.)"
- **Confirmation filters:** "the 1-3% penetration criterion (or some variation thereof) or the requirement of two
  successive closes below the neckline (the two day rule) can be used for added confirmation."
- **Before the break, nothing is decided:** "Until that downside violation takes place, however, there is always the
  possibility that the pattern is not really a head and shoulders top and that the uptrend may resume at some point."
- **Volume:** "Volume should then expand on the breaking of the neckline, decline during the return move, and then expand
  again once the return move is over." Also: "A sharp increase in downside volume, however, is not critically important
  in the initial stages of a market top."
- **Before the break, for longs:** "This might be sufficient cause to liquidate long positions, but not necessarily enough
  to justify new short sales."
- **Target:** head-to-neckline height projected from the break; "It's important to remember that the objective arrived
  at is only a minimum target."
- **The failed pattern (pp. 113 to 115):** "At a top, once the neckline has been broken on the downside, any decisive
  close back above the neckline is a serious warning that the initial breakdown was probably a bad signal". And: "This
  type of pattern starts out looking like a classic head and shoulders reversal, but at some point in its development
  (either prior to the breaking of the neckline or just after it), prices resume their original trend."
- **Rounding:** Murphy describes only bottoms: "The saucer bottom shows a very slow and very gradual turn from down to
  sideways to up." He gives no rule for a rounding top.
- **Entry, stop, target for a failure:** none given. His lesson is to exit the losing short quickly.

### 3.3 StockCharts ChartSchool, "Head and Shoulders Top" (established educator)

- **Prior trend:** "Without a prior uptrend to reverse, there cannot be a Head and Shoulders reversal pattern (or any
  reversal pattern, for that matter)."
- **Symmetry:** "While symmetry is preferred, sometimes the shoulders can be out of whack."
- **Completion:** "The head and shoulders pattern isn't complete, and the uptrend is not reversed until the neckline
  support is broken. Ideally, this should also occur in a convincing manner, with an expansion in volume."
- **Retest:** "Sometimes, but certainly not always, the price will return to the support break and offer a second chance
  to sell."
- **Target:** neckline-to-head distance subtracted from the neckline; "Any price target should serve as a rough guide,
  and other factors should also be considered."
- No failure rule, no rounding-top article (ChartSchool's pattern list has "Rounding Bottom" only).

### 3.4 Thomas Bulkowski, thepatternsite.com (originator of the measured "busted" setup)

**Notice:** the site states it "shall not be used to train artificial intelligence (AI) systems". I read it through a
fetch tool (direct requests were refused, HTTP 406), for citation only, with short quotes.

Head-and-shoulders top (hst.html, statistics updated 8/26/2020):
- **Prior trend:** "Upward leading to the pattern". **Shape:** "A three-peak pattern with the middle peak above the
  others." **Symmetry:** "The two shoulders should peak near the same price, be nearly the same distance from the head,
  and look similar". **Volume:** "Highest on the left shoulder followed by the head. Trends downward 61% of the time."
- **Confirmation:** "The pattern confirms as a valid one when price closes below an up-sloping neckline or below the
  right armpit" when the neckline slopes down.
- **Tactics:** "Wait for confirmation before placing a trade." "Price must have something to reverse, so if the rise
  leading to the pattern is small, expect a small decline." "Pullbacks hurt post breakout performance."
- **Symmetry, measured (HSTExplained.html):** "The more unsymmetrical a head-and-shoulders top appears, the better it
  performs." A higher left shoulder "see declines that average 25% compared to declines of 20% for higher right
  shoulders and 19% for even shoulders" [checked: the sentence continues with the even-shoulder figure].

Busted head-and-shoulders top (BustHST.html, "Updated with new statistics on 12/28/2020"):
- **Definition:** price "breaks out downward and drops no more than 10%, turns around, and then closes above the top of
  the head-and-shoulders".
- **Entry:** "To trade this busted chart pattern, place a buy order a penny above the head (the highest high in the chart
  pattern)."
- **Exit:** "When you decide to sell is up to you." No stop is given.

Busted patterns in general (bustedsetup.html; glossary.html):
- "A busted pattern occurs when price breaks out in one direction and moves less than 10% away from the breakout price".
- Glossary: "Price that moves no more than 10% after the breakout before reversing and zipping to the other side of the
  chart pattern".

Rounding top (roundingtop.html, statistics updated 8/26/2020):
- **Chart:** "Rounding tops are large enough to appear on the weekly or daily chart." **Prior trend:** "Upward leading to
  the chart pattern." **Shape:** "Prices form a gentle curve, a half moon shape." **Rims:** "The rims of the inverted
  bowl bottom near the same price, but 58% of the time the end is slightly higher than the start."
- **Breakouts both ways:** "A close above the highest high signals an upward breakout. Downward breakouts are a close
  below the lower of the two rims (the lowest low in the pattern)."
- **An early long inside the pattern:** "For aggressive traders, if price retraces 32% of the rounding top's height,
  buy." (Measured from the right-rim low upward.)
- **Quality notes:** "Tall patterns perform better than short ones." "Heavy breakout volume suggests better
  performance." "When the right rim is above the left, the pattern under performs."

The short mirror, busted head-and-shoulders bottom (BustHSB.html, updated 12/28/2020):
- **Definition:** "Price rises no more than 10% before dropping and closing below the bottom of the chart pattern."
- **Entry in his example:** "If you place an order to short the stock a penny below the head, you would have entered the
  trade at 5.28."

### 3.5 Peter Brandt, peterlbrandt.com (Factor Trading) (originator of the "H&S failure" as a trade)

- **The trade, in his corn example (2011-05-18):** "On Wednesday, May 11, the market completed the top pattern (the "A"
  in the story)." Then: "Then on May 16 the market spent the entire day above the neckline, followed by a strong gain on
  May 17. This is the "B" in the story and confirmation that a bear trap had been sprung."
- **The trigger:** "The advance today, May 18, penetrated the May 10 right shoulder high and officially completed the
  failure pattern."
- **His view:** "I consider H&S failure patterns to be very tradable chart developments." "Often a pattern failure tells
  a better story than does a pattern completion."
- **Target:** "The target of 733 is based on projecting the distance between the April 26 high and the May 12 low (which
  is 69 cents) upward from the right shoulder high of 664." (Head high minus the post-break low, added to the right
  shoulder high.)
- **Protective level:** "The market should probably not take out Wednesday's low (652-3/4)." Wednesday was the trigger
  day, so his line in the sand was the trigger day's low.
- **On the pattern itself (2013-08-13):** the H&S, "when properly identified", "is the most reliable of all classical
  chart patterns. Unfortunately novice market analysts are way to quick to mislabel market action as a H&S
  configuration." And: "It is not unusual for H&S tops to be brief, whereas H&S bottom patterns tend to be much longer in
  duration."
- **On probabilities (public excerpt of a members-only post, 2018-10-31):** "Assigning fixed "one-and-done"
  probabilities to a pattern is a worthless endeavor."
- **Not read (members only):** "H&S failure" (Q&A, 2018-11-27; the public excerpt says "Peter is a discretionary trader
  and not a systematic trader"), "Head and shoulders top fails, completes in this commodities ETF" (2026-03-30), and
  "Must Read: Head and Shoulders Failures by Peter Brandt" (2026-04-16, posted by Jonathon King; its public excerpt cites
  a Palantir "H&S Failure pattern ... at $16.50 back in 2023" that I did not check).
- Note: corn is a futures market; Brandt's rules are for futures and stocks alike but his examples here are futures.

### 3.6 The Wyckoff school, Wyckoff Analytics, "The Wyckoff Method: A Tutorial" (established educator)

- **The failed break of support (spring):** "A "spring" takes price below the low of the TR and then reverses to close
  within the TR; this action allows large interests to mislead the public about the future trend direction".
- **In an uptrend it is re-accumulation:** "In a re-accumulation TR (which occurs during a longer-term uptrend), the
  points representing PS, SC and ST are not evident in Phase A."
- **The top version (for the short side):** "Aggressive traders may wish to initiate short positions after a UT or UTAD.
  The risk/reward ratio is often quite favorable." But "it is often safer to wait until Phase D and an LPSY." And "During
  Phase D, price travels to or through TR support."
- **A rounding top in Wyckoff terms:** one of the nine selling tests is "Crown forming (lateral movement)". Another:
  "Estimated downside profit potential is at least three times the risk if the initial stop-order were hit" (the page
  credits Pruden, 2007, for the list).

### 3.7 Investor's Business Daily (established educator; teasers only, paywalled)

- IBD treats the head-and-shoulders as a **short-sale** pattern after big advances. David Saito-Chung (updated 2022-02-16):
  "There are at least three keys to a smart search of how and when to sell a stock short. The first key? Look only at
  stocks that rise at least 300% to 400% in price to new highs." Then "The second key: Count the number of bases."
- Saito-Chung ("Late-Stage Breakout Failure? Good Short Selling Moment", published 2016-01-05, updated 2018-11-19
  [checked]): "the head-and-shoulders pattern, which can take as long as seven months to build".
- A 2024 IBD title warns: "Head-And-Shoulders Pattern Spots Short-Sale Entries, But Beware Of Potential Headaches".
  The body is paywalled; I could not read what the headaches are.

### 3.8 Comparison table

| Item | Edwards & Magee | Murphy | StockCharts | Bulkowski | Brandt | UCT (Bracco, Patrick) |
|---|---|---|---|---|---|---|
| Prior trend | required ("extensive advance") | required ("A prior uptrend") | required | "Upward leading" | not stated in the post read | leaders, after big moves (AMD "massive massive move") |
| Shape | 3 peaks, head highest, items A to D all required | 3 peaks; right shoulder retraces 1/2 to 2/3 of C to D | 3 peaks; symmetry preferred, not required | 3 peaks; asymmetric tops perform better | "when properly identified" | H&S or rounded top on the daily |
| Length | not given for daily patterns | not given | not given | not given | tops "brief", bottoms longer | weeks ("Could take a few weeks to form") |
| Volume | heavy left shoulder, light right shoulder (an estimate, 1/3 each way) | lighter on the head, lightest on the right shoulder, expand on the break | lighter head and right shoulder, expand on the break | highest on the left shoulder, declining 61% of the time | not given | not stated |
| Moving averages | none | none | "long-term moving averages" named among the other factors to weigh against a target [checked] | none | none | 50-day ("line in the sand"; "undercut of the 50SMA and launch"), 20-day, 200-day |
| Top confirmed by | a close about 3% under the neckline | a close under the neckline; 1-3% or two closes | a convincing break, with volume | a close under the neckline (or right armpit) | a completed top ("A") | a close under the neckline ($333 SMH) |
| Failure defined as | "saved" before the break (perhaps 20%); "false move" after (rare) | "any decisive close back above the neckline"; also before the break | not defined | busted: drop under 10%, then a close over the top of the pattern | B: a full day back above the neckline; C: over the right shoulder high | "failed breakdown", "failed H&S breakdown", "failed rounded top / H&S" |
| Long entry | none | none | none | buy a penny over the head | on the penetration of the right shoulder high | buy the failed breakdown; for indexes, TQQQ/SOXL |
| Stop | none | exit the losing short fast | none | none given | the trigger day's low ("should probably not take out Wednesday's low") | house: a few cents under the day's low (A3, F62) |
| Target | none for a failure; rounding turns have no formula | minimum = pattern height | rough guide only | none given for busts; averages 35% (all), 67% (single) | right shoulder high + (head high minus post-break low) | none stated |
| Rounding top | rare in speculative stocks; volume irregular; "almost never deceive" | not covered | not covered | breaks out both ways; up: rank 2 of 39 | not covered in posts read | "rounded top look" on the indexes; "Everyone saw rounding top" (AMD) |

**Where the sources disagree.**
1. **How often a top fails.** Edwards and Magee say post-break failures are "extremely rare" and give "perhaps 20%" for
   pre-break saves (estimates, no data). Bulkowski measured that 32% of downward breakouts from H&S tops bust, and a 19%
   break-even failure rate. My run of the app's detector found far more failures (61% never broke; 38% of breaks failed),
   but the app's detector is looser than any book (section 5).
2. **What a failure means.** Edwards and Magee: a warning that the end is near. Bulkowski and Brandt: a trade in the new
   direction, with large average moves. UCT sides with Brandt ("the only way to trade a H&S pattern is to trade the
   failure of it").
3. **The trigger.** Murphy: a decisive close back over the neckline. Brandt: the right-shoulder high. Bulkowski: a penny
   over the head. Bracco on AMD: a close through the falling line over the right side, still under the right shoulder.
   The later the trigger, the more proof and the higher the entry.
4. **Symmetry.** Bulkowski's guideline asks for similar shoulders, yet his own data say asymmetric tops performed better;
   StockCharts says symmetry is preferred, not required. The app's detector requires shoulders within 15% of the head.
5. **Rounding tops.** Edwards and Magee: rare in speculative stocks and they "almost never deceive". Bulkowski: they break
   out upward often enough to have their own statistics, and the upward breakout ranks 2 of 39.
6. **Volume.** Edwards and Magee: volume on rounding tops is "high and irregular". The app's rounded-top detector scores
   volume drying up through the dome and expanding on the right side, which is Edwards and Magee's description of a
   rounding **bottom**.

---

## 4. Measured evidence

### 4.1 Bulkowski, head-and-shoulders tops (thepatternsite.com/hst.html; statistics updated 8/26/2020)
- "Overall performance rank (1 is best): 9 out of 36"; "Break even failure rate: 19%"; "Average decline: 16%";
  "Pullback rate: 68%"; "Percentage meeting price target: 51%". "The above numbers are based on more than 2,800 perfect
  trades."
- How measured: "average decline" runs from the breakout to the "ultimate low", defined in his glossary as "The lowest
  valley before price rises at least 20%, measured from the low to the close." A break-even failure is a pattern that
  fails to decline "by at least 5%". A pullback is a return to the breakout price "within 30 days".
- Limits: "perfect trades" (no slippage, ideal exits); the page gives no years or universe; the decline is measured to
  the best low, not to a trading exit.

### 4.2 Bulkowski, busted head-and-shoulders tops (BustHST.html; updated 12/28/2020)
- "32% of head-and-shoulders will bust". Of those, "67% will single bust", "3% will double bust", "30% of them will triple
  bust".
- "Busted head-and-shoulders tops (all varieties: single, double, and triple or more busted) see price gain an average of
  35%." "Single busted patterns will see price rise by 67% on average".
- "Non-busted head-and-shoulders will see price rise by 45% on average." This sentence is unclear for a bearish pattern;
  the page does not say what "rise" means for tops that did not bust. I do not use it.
- Limits: the page gives no sample size or years ("Here's a few statistics from the book"); averages are to the
  ultimate high (best point before a 20% fall), not a trading result. "Triple bust" means the pattern reversed three or
  more times, so almost a third of busts were whipsaws before the final move.

### 4.3 Bulkowski, rounding tops (roundingtop.html; updated 8/26/2020) and his one-to-three-month table
- Upward / downward breakout: "Overall performance rank for up/down breakouts (1 is best): 2 out of 39/3 out of 36";
  "Break even failure rate for up/down breakouts: 9%/20%"; "Average rise/decline: 55%/17%"; "Throwback/pullback rate:
  63%/58%"; "Percentage meeting price target for up/down breakouts: 58%/14%". Based on "more than 950" perfect trades.
- The page does not say how often each direction happens.
- BestPatterns.html (a different method, "Note as of 9/20/21", "over 30,000 samples", price move 1, 2 and 3 months after
  the breakout): rounded top, up breakout +7%, +10%, +14%; rounded top, down breakout -6%, -4%, -4%; head-and-shoulders
  top -7%, -8%, -7%. He adds: "The following statistics have not been updated with more recent information, so they are
  outdated."
- Limits: as 4.1. Also, Bulkowski's upward breakout from a rounding top is "a close above the highest high", a new high
  for the pattern. That is the same event as the "failed rounded top" long.

### 4.4 Bulkowski, busted head-and-shoulders bottoms (the short mirror; BustHSB.html; updated 12/28/2020)
- "16% of head-and-shoulders bottoms will bust"; of those 47% single, 36% double, 17% triple. "Single busted patterns
  will see price drop 22% on average". Same limits as 4.2.

### 4.5 My computation: the app's own detectors, followed forward, under the house rulebook [my computation]

**Method.**
- **Data:** the local read-only test copy of the app's daily bar store (`bars.db`, 4,284 tickers with daily bars, to
  2026-11-09; 1,726 of them met the 1,000-bar and $20M tests below) [checked: the draft said 4,188; the copy holds 4,284].
  A random sample (seed 33) of 600 tickers with at least 1,000 bars since 2010 and an average daily dollar volume of
  $20M or more. Includes ETFs. Detection dates 2010-01-01 to 2026-08-31.
- **Detection:** every 5th bar, the app's own `head_shoulders.detect_head_shoulders` and
  `rounded_top.detect_rounded_top` were run on the last 200 bars with the app's `build_context`, the same read the code
  comments describe for production. A detection counts only if the stock closed at $10 or more and traded $20M a day
  (B23). The same pattern seen on later steps was counted once.
- **What happened next (40 bars):** for H&S, a close over the right-shoulder high before any neckline break (version A),
  or a close under the projected neckline (the break). After a break: a close back over the right-shoulder high while
  the low stayed within 10% of the break level (version B, Brandt's "C" and Bulkowski's 10% rule), or a 10% fall first.
- **Trades (house rulebook):** buy (or short) at the next day's open, a market order (E57). Stop 0.1% beyond the
  trigger day's low (or high), about "a few cents" (A3, F62). Stop moves to breakeven once 2R is reached (B19). A third
  off at 3R and at 5R (B19, E51; at the open if it gaps past, F63). The last third sells on a close below the 10-day
  average (E52). Out at the 10th day's close if still under 1R and no trim yet (C33). A gap through the stop fills at the
  open (B20's 30-minute rule cannot be tested on daily bars). Stop checked before targets on each bar.
- **Baselines:** the same simulation on sampled ordinary days in the same stocks: long, a close over the prior day's high,
  above the 200-day, closing in the top half of the range; short, the mirror below the 200-day.
- **Limits:** survivors only (current listings), so shorts look worse and longs better than reality; no commissions,
  slippage or borrow fees; overlapping signals in the same stocks (I show a per-ticker check); the app's detector is
  looser than the books (no prior-uptrend test, small pivots), so these are "what the app's scanner sees", not
  textbook patterns; daily bars only. A small average R with a 30% win rate is fragile. Scripts:
  `scratchpad/setups/33-failed-hs-rounded-top/tools/study.py`, `analyze.py`, `analyze2.py`, `analyze3.py`.

**What the app's H&S detector finds.**
- 55,782 distinct patterns in 590 of the 600 tickers (about 95 per ticker over the 16.7 years). 59% formed above the
  200-day.
- Median height (head to neckline) 11.3% (middle half 7.7% to 16.0%).
- Within 40 bars: **61%** closed over the right-shoulder high **before** any neckline break (version A); **32%** broke the
  neckline; 7% did neither.
- Of the breaks: **38%** failed (a close back over the right shoulder, fall under 10%); 36% fell 10% or more first; 26%
  did neither within 40 bars. 70% closed back over the neckline at some point before a 10% fall. 33% traded over the
  head within 60 bars with a fall under 10% (Bulkowski's bust; his own figure is 32%, by a different method).
- After the failures that went on to clear the head, the median best high within 60 bars was 9.0% over the head, and
  46% got more than 10% over it (Bulkowski's "single bust" threshold).

**The trades (house simulation).**

| Trade | n | Mean R (95% CI) | Win rate | Reached 3R before the stop | Stop distance, median | Within 3% (A13) | On the right side of the 200-day (B26) |
|---|---|---|---|---|---|---|---|
| Long B: failed breakdown, close over the right shoulder (Brandt's "C") | 6,543 | **+0.11** (+0.07 to +0.16) | 33% | 27% | 2.1% | 68% | 79% above |
| Long B, above the 200-day only | 5,189 | **+0.13** (+0.08 to +0.18) | 33% | | | | |
| Long B, above 200, stop within 3%, entry within 4% of the right-shoulder high (C28), within 10% of the 10-day (C29) | 3,482 | +0.13 (+0.06 to +0.19) | 30% | | | | |
| Long A: breakdown never came, close over the right shoulder | 32,514 | +0.04 (+0.02 to +0.07) | 29% | 26% | 1.9% | 74% | 75% above |
| Short at the neckline break | 16,965 | **-0.10** (-0.13 to -0.07) | 25% | 21% | 2.2% | 64% | 62% below |
| Short at the break, below the 200-day, stop within 3% | 5,915 | +0.01 (-0.05 to +0.07) | 25% | | | | |
| Rounded top: long on a close over the dome high | 374 | +0.03 (-0.14 to +0.20) | 30% | | 2.3% | 65% | 92% above |
| Rounded top: short on a close under the right rim | 683 | -0.05 (-0.19 to +0.08) | 25% | | 2.6% | 58% | 75% below |
| Baseline long (strong day, above 200) | 11,602 | +0.01 (-0.02 to +0.05) | 28% | 25% | 1.8% | 76% | all above |
| Baseline short (weak day, below 200) | 7,829 | -0.08 (-0.12 to -0.04) | 26% | 22% | 2.5% | 60% | all below |

**Checks on the long B result.**
- **Per ticker (equal weight, 552 tickers):** +0.10R (95% CI +0.03 to +0.17); baseline long -0.00R (-0.05 to +0.05).
- **By period:** 2010-14 +0.17R; 2015-19 +0.08R; 2020-22 +0.05R (CI crosses zero); 2023-26 +0.15R. The baseline was
  +0.07, -0.03, -0.07 and +0.06 in the same periods. Long B beat the baseline in every period.
- **Market (a rough stand-in for the app's market reading, SPY versus its 50-day on the detection day):** SPY over its
  50-day: long B +0.02R (-0.03 to +0.07). SPY under its 50-day: long B **+0.30R** (+0.21 to +0.38), win rate 37%
  (baseline +0.12R). The failed top in a stock was worth most while the market itself was correcting, which matches
  Bracco's "coming out of corrections" (section 6).
- **Depth of the failed break:** under 3% +0.12R; 3% to 6% +0.15R; 6% to 10% +0.05R (CI crosses zero).
- **Speed of the reclaim:** within 5 bars +0.10R; 6 to 15 bars +0.11R; over 15 bars +0.13R. Speed did not matter much.
- **Stop width:** 2% or less +0.11R (win 28%); 2% to 3% +0.07R; over 3% +0.15R (win 41%).
- **The structural stop does not fit:** a stop under the failed-break low would have been a median **9.3%** away (only
  4% within 3%).
- 75% of version-B triggers later traded over the head within 60 bars.

**Checks on the short.**
- Of breaks from H&S tops that formed **above** the 200-day (a top after an uptrend, the classical case), **70%** were
  still above the 200-day on the break day, where B26 forbids the short. Those shorts averaged -0.17R; the 30% that
  broke below the 200-day averaged -0.11R.
- The app's own short stop (1% over the right shoulder) was a median **9.6%** away at the break; only 4% were within 3%.
- **The short mirror (failed inverse H&S)** (`study_mirror.py`, same sample and rules, the app's
  `inverse_head_shoulders` detector): 62,871 patterns; only 34% formed below the 200-day (the detector also fires inside
  uptrends). Within 40 bars, 54% closed under the right-shoulder low before any breakout, 37% broke out, 9% neither. Of
  the breakouts, 30% failed back under the right-shoulder low after rising less than 10%, 33% rose 10% first.
  - Short B (failed breakout, Brandt's "C" mirrored): n=6,792, **-0.02R** (95% CI -0.06 to +0.02), win 29%; below the
    200-day -0.01R (-0.06 to +0.05); below 200 with the stop within 3% -0.01R. 58% were below the 200-day; the house stop
    was a median 2.5% away (59% within 3%); the structural stop over the post-breakout high a median 10.1%.
  - Short A (the breakout never came): -0.07R (-0.09 to -0.05); below 200 -0.04R.
  - Against the baseline short (-0.08R), the failed-breakout short was a little better, but not positive. Survivor bias
    pushes every short in this sample down, so read this as "no edge shown", not "no edge".

**The rounded-top detector.** 1,341 patterns in 433 tickers (rare next to the H&S detector). Within 40 bars, 29% closed
over the dome high (the failed version), 53% closed under the right rim, 18% neither. Its own stop (dome high + 1.5%)
was a median **19.5%** from its entry; **none** of 1,341 was within 3%.

### 4.6 Candidate model examples, for the owner to review [my computation]

Found by running the same detector and the same version-B rule on 52 well-known names. Each line passed: above the
200-day, the house stop within 3%, a pattern at least 5% tall. Prices are split-adjusted bar-store prices. "R" is the
house simulation above. I looked at all of these on a quick price plot; I have not graded them. Two were left out as
messy (ELF 2023 and AAPL June 2021: the "head" was not the high of the range).

| # | Stock | Neckline broken (first close under) | Trigger (close over the right shoulder) | Right shoulder high | Head | Entry (next open), chase over the right shoulder | Stop (trigger-day low) | Result |
|---|---|---|---|---|---|---|---|---|
| 1 | SMH | 2026-03-30 | 2026-04-08 | 404.39 | 427.94 | 423.17 (+4.6%, over C28's 4%) | 414.58 (2.0%) | +7.4R |
| 2 | QQQ | 2026-03-24 | 2026-04-08 | 605.90 | 636.60 | 605.93 (+0.0%) | 601.52 (0.7%) | +9.9R |
| 3 | COST | 2024-04-01 | 2024-05-03 | 740.68 | 787.08 | 749.59 (+1.2%) | 732.62 (2.3%) | +4.6R |
| 4 | MSFT | 2021-09-29 | 2021-10-14 | 300.90 | 305.19 | 302.34 (+0.5%) | 297.53 (1.6%) | +4.6R |
| 5 | GOOGL | 2026-03-24 | 2026-04-13 | 319.52 | 340.49 | 324.79 (+1.6%) | 315.15 (3.0%) | +4.9R |
| 6 | AMZN | 2021-06-03 | 2021-06-10 | 165.60 | 171.80 | 167.48 (+1.1%) | 163.89 (2.1%) | +4.0R |
| 7 | AAPL | 2022-03-14 | 2022-03-29 | 176.24 | 182.94 | 178.55 (+1.3%) | 176.16 (1.3%) | -1.0R (the March 2022 bear-market rally) |
| 8 | LULU | 2023-03-10 | 2023-03-29 (earnings gap) | 327.76 | 386.70 | 365.00 (+11.4%, C28 says skip) | 359.28 (1.6%) | -1.0R |
| 9 | NVDA | 2026-06-24 | 2026-08-05 | 212.71 | 236.54 | 221.53 (+4.1%) | 216.18 (2.4%) | -0.7R |
| 10 | SMH | 2025-11-20 | 2025-12-03 | 360.00 (my reading) | 372.78 | 363.26 (+0.9%) | 355.87 (2.0%) | -1.0R (stopped 2025-12-12; SMH later rose past 400) |

Notes: MSFT's head was only 1.4% over its right shoulder, closer to a flat top than a textbook H&S. Rows 1, 2 and 10 are
the house's own calls (section 6). Row 10's right-shoulder level is my reading of Bracco's chart, not the detector's.

---

## 5. Our app

**No scanner for this setup.** Nothing in `api/services/pattern_engine/detectors/` looks for a **failed** H&S or a
**failed** rounded top. The classical folder has three related detectors, all for the pattern **working**:

**`classical/head_shoulders.py` (bearish; member-visible).**
- Swing highs from `detect_pivots(bars, window=3)` (a peak higher than the 3 bars on each side). The latest 8 swing
  highs are tried as left shoulder, head, right shoulder.
- Head higher than both shoulders; `|left - right| / head < 0.15`; at least 5 bars between peaks; left to right shoulder
  at most 100 bars; troughs are the lowest lows between the peaks; neckline slope under 0.5% of the head price per bar;
  both shoulders above the neckline.
- The right shoulder must be within the last **12 bars** (cut from 30 on 2026-10-15 because the detector fired on 41.0%
  of ticker-days; at 12 bars it was 24.9%, measured in the code's own comment).
- "Not yet broken": two closes in a row under the neckline after the right shoulder kill the detection.
- Score: 40% geometry, 25% volume (right-shoulder volume under left), 20% context, 15% a fixed 50. Floor 50.
- Levels: entry = neckline x 0.999 (a short), stop = right shoulder x 1.01, target = neckline minus the head-to-neckline
  height.

**`classical/rounded_top.py` (bearish).**
- Two swing **lows** (window 3) are the left and right rims, within 5% of each other, 30 to 120 bars apart, the right rim
  within the last 25 bars; the highest high between them is the dome; depth from dome to left rim 12% to 40%; a
  quadratic fit through the closes must curve down; at least 40% of bars in the top quarter of the dome; no "handle" bump
  over 6% before or after the right rim.
- Levels: entry = right rim x 0.999 (a short), stop = dome high x 1.015, target = rim minus dome depth.

**`classical/inverse_head_shoulders.py` (bullish)** is the mirror, with the same thresholds; it is the base for the
short mirror in 4.5.

**The Model Book card** (`app/src/pages/modelbook/setupCatalog.js`): name "Failed H&S / Rounded Top", family Reversals &
Reclaims, **direction 'long'**, essence: "Everyone sees the topping pattern" then, after a dash, "when the breakdown never
comes, the squeeze fuels the next leg up." Its 10-candle glyph draws three rises with the middle peak highest and ends on a 7% candle that
closes at its high. It draws no neckline and no undercut.

**The journal tag** (`app/src/constants/setupGroups.js`): `Failed H&S/Rounded Top` in the Swing list, mapped to the
card's name in `app/src/pages/journal-2-0/lib/setupTagMap.js`. That file gives it **no** plan template
(`'Failed H&S / Rounded Top': null`) and maps **no** detector to it (`PATTERN_TO_TAG` has neither `head_shoulders` nor
`rounded_top`). `api/services/desk_session_insights.py` lists it in the setup playbook for transcripts.

**The course plan.** `docs/study/UNITS-method.md` SET.29, lesson M10.L5 "Failed H&S / Rounded Top: When the Breakdown
Everyone Sees Never Comes": "entry over the right-shoulder high"; supply "thin"; wins to come from `head_shoulders`
detections. `UNITS-foundations.md` F4.09 lists "Failed H&S" with tops and exhaustion. `TRADE_PLANS.md` has no plan for
it. The house note `docs/study/research/definitions.json` (2026-10-17) calls it "The long side of a bearish pattern that
does not work", nearest standard name "Busted head-and-shoulders top / busted rounding top (Bulkowski)".
`docs/superpowers/research/setups/setup_criteria.json` marks it `"starter_status": "ungrounded"`.

**Where the app disagrees with the sources, or looks wrong.**
1. **Direction.** The task says short; the app and every UCT post say long (see the short version).
2. **Card versus UCT's words.** The card describes version A ("when the breakdown never comes"). Bracco's examples are
   version B ("buy the failed breakdown"). The glyph shows no neckline and no undercut, so a member cannot see either.
3. **No prior uptrend.** Every source requires one (Edwards and Magee item A, Murphy item 1, StockCharts, Bulkowski). The
   H&S detector only adds context points for Stage 2 or 3; it fires in downtrends too, and its own text then calls the
   pattern "H&S as a bear-flag analog". The rounded-top detector has no trend test either.
4. **Size and window.** The H&S docstring says "Window: 30-100 bars", but the code checks only the 100-bar cap and the
   5-bar spacing, so a 10-bar pattern passes. With 3-bar pivots, small wiggles can qualify. In my run the patterns were
   mostly a usable size (median 11.3% tall; 0.4% under 1%, 7.9% under 5%), so the bigger problems are the missing trend
   test (item 3) and how often it fires.
5. **Volume is described, not tested.** The entry text says "close < ... on volume > 1.5x 20-bar avg", but nothing in the
   detector checks that volume.
6. **Unverified text shown to members (H&S, `_build_detection`, lines 509 to 541).**
   - "Bulkowski's empirical sample places confirmed H&S breakdowns at roughly 60-70% follow-through to the measured-move
     target." Bulkowski's own page says "Percentage meeting price target: 51%".
   - A quote credited to Peter Brandt, "the most reliable classical reversal pattern when the neckline breaks with
     volume". I did not find it. His published wording (2013) is that the H&S, "when properly identified", "is the most
     reliable of all classical chart patterns".
   - "origins traced back to Charles Dow": not verified in any source I read. "formally codified by Richard Schabacker in
     ... (1932)": the 1932 date matches the reprint publisher's own account (Harriman House, "followed in 1932 by
     Technical Analysis", source 18) [checked]; Brandt writes "written in 1937". Whether the book "formally codified" the
     pattern I could not check without reading it.
   - "the textbook 8-18 bar window where the highest-follow-through H&S patterns resolve": no source found.
   - The management text says to cover part "at 1R for a free trade"; the house first trims at 3R (B19).
7. **Unverified text shown to members (rounded top).**
   - "Richard Wyckoff (1908) - Phase A/B/C distribution schematic" and "first codified ... in 1908". No source I read
     supports 1908; Wyckoff Analytics ties the schematics to the course of the school he founded "In the 1930s".
   - It maps "the right-side decline is Phase C". Wyckoff Analytics puts the test of demand (upthrust) in Phase C and the
     move "to or through TR support" in Phase D.
   - "Bulkowski's research shows rounded tops produce 20-30% downside follow-through with high frequency." Bulkowski's page
     gives an average decline of 17% and 14% meeting the target for downward breakouts.
   - Statements credited to Adam Grimes and to Schabacker (1932, "saucer top") were not verified; I did not read those
     books.
   - "frequently extend 1.5-2x this measured move over the 12-26 weeks": no source found.
8. **The rounded-top stop can never fit A13.** Rims within 5% and depth of at least 12% put the dome high, plus 1.5%,
   at least about 9.9% over the entry by the code's arithmetic. In my run the median was 19.5% and none was within 3%.
9. **The volume model for rounded tops is the bottom's.** See 3.8, disagreement 6.
10. **The tag has no data.** `plan-review.html` lists "Failed Head and Shoulders" among the setups with no labelled data;
    nothing links the detectors to the tag, so there is no house sample of this setup yet.

---

## 6. UCT's own words

All from the public Substack (byline "Uncharted Territory"; sections named for their writer), read through the post API
on 2026-11-09. "Bracco" means a section headed "Bracco's Market Health Tracker" or "Bracco's Breakdown & Top Ideas";
"Patrick" means "TSDR's Weekly Outlook & Watchlist". The 2025-11-23 issue says it is by "Bracco and I, Patrick (TSDR
Trading)". Bar-store checks are [my computation].

**The rule, in Bracco's words.**
- 2025-09-01, QQQ (Bracco's tracker, https://unchartedterritoryy.substack.com/p/sunday-scans-4d1): "the best way to trade a
  head and shoulders top is to buy the failed breakdown of it. This would be an ideal undercut of the 50SMA and launch."
  Also: "Could take a few weeks to form." Check: QQQ never closed under its August lows; it closed over the August high
  (583.3) on 2025-09-11 (584.1). That is version A.
- 2026-04-19, SMH (Bracco's tracker, https://unchartedterritoryy.substack.com/p/sunday-scans-33a): "The most viscous
  failed Head and Shoulders pattern that I have seen in some time! Remember the only way to trade a H&S pattern is to
  trade the failure of it." And: "this is why coming out of corrections I try to get a position in TQQQ and SOXL."
  Check: example 1 in 4.6. Same issue, SPY weekly: "Failed breakdown from 6 months essentially of sideways into a rip to
  highs. Historic."

**SMH, autumn 2025 (Bracco's tracker).**
- 2025-09-01: "Considering Thursday a failed breakout which puts a potential right shoulder in play now."
- 2025-11-02 (https://unchartedterritoryy.substack.com/p/sunday-scans-b99): "Do not want to see this be the beginning signs
  of a Head and shoulders top here."
- 2025-11-23 (https://unchartedterritoryy.substack.com/p/sunday-scans-56d): "Turning $333 head and shoulder neckline into
  support is step 1. Step 2 is remounting the 50SMA and the 20EMA."
- 2025-11-30 (https://unchartedterritoryy.substack.com/p/sunday-scans-422): "Failed Head and Shoulders breakdown at $325.
  50SMA the line in the sand to stay above."
- Check: SMH closed under $333 on 2025-11-20 (325.10) and 11-21 (326.13), low 315.05 (5.4% under $333), back over $333 on
  11-24 (339.12), over the head (372.78) on 2025-12-10 (374.10). Under my proposed trigger it stopped out (-1R, 4.6 row 10)
  and later rose past 420 by late January 2026. A useful lesson in why the stop and the trigger matter.

**The rounded top.**
- 2026-03-22, the indexes (Bracco's Breakdown, https://unchartedterritoryy.substack.com/p/sunday-scans-cab): "Everyone
  obviously sees the big rounded top look on the leading indices and this massive support area we are losing (the
  November lows) as well as the 200-day moving average." And: the market "typically like to undercut big support areas
  before reclaiming (if they do)." His vehicles: "My main trading vehicle is always the TQQQ, SOXL, or Index futures."
  Check: QQQ closed under its neckline from 2026-03-24, low 555.6 on 03-30, and triggered on 04-08 (4.6 row 2).
- 2026-08-16, AMD (Bracco's Breakdown, https://unchartedterritoryy.substack.com/p/sunday-scans-da5): "Looks like a huge
  failed rounded top / H&S pattern after Fridays close. Has potential to catch some people offsides imo…"
- Same issue, AMD (Patrick): "Relative strength. Everyone saw rounding top and it gave nothing back after a massive
  massive move higher in April May and June."
- Check on AMD: one close under the June low area (2026-07-29, 429.56, under the 437.23 low of 06-09), back over it the
  next day; Bracco's Friday was 2026-08-14 (close 514.39, through the falling line on his chart, still under the
  right-shoulder highs of 561.47 and 574.20). Entered there with the day-low stop (483.20), it was stopped on 08-18. A
  close over 561.47 came on 2026-09-21 (entry 8.0% over that level next morning, so C28 says skip; its day-low stop was
  4.1% away, and it ended at breakeven); the trade from the
  lower 08-04 high (530.13) triggered 2026-09-17 and ran to +3.9R. AMD later traded at 658.52 before falling back to 449
  by 2026-11-06. Which peak is "the right shoulder" changed the outcome.

**Patrick (the owner) on the pattern.**
- 2026-06-28, TWLO (https://unchartedterritoryy.substack.com/p/sunday-scans-ae1): "About to find out if Head and
  Shoulders is a real pattern or if it is BS. by the way, it's BS! lol." He listed the support: "Holding ER close, gap
  support, 50SMA, inside day just below the 20EMA and AVWAP from earnings." Check: TWLO fell from 191.6 (06-26) to 183.4
  (07-22), about 4%, without a close under its June lows, then gapped up after its report (2026-08-06 in the house
  earnings cache, `docs/study/setups/earnings_dates_cache.json`) to close at 241.3 on 2026-08-07.
- 2025-11-23, CVNA, on the short side of a topping pattern: "Not particularly interested in shorts but this looks more and
  more vulnerable by the day. Stage 3 topping action and if the 200SMA is lost and sustains then stage 4 downtrend
  potential." He wanted the 200-day lost first, which is rule B26.
- His general stop habit, 2025-06-22 (https://unchartedterritoryy.substack.com/p/sunday-scans-0d2): "Stop at LOD if this
  triggers. My stops are always LOD until I can raise them to breakeven". The rulebook (A3, F62, B19) now governs.

**Member-only Discord archive** (in `docs/study/levels/brain_kb_*.json`; paraphrased, not quoted): Bracco (2024-07-24)
noted that head-and-shoulders patterns had been bullish in that market; Manrav (2024-05-05) said a possible QQQ H&S was
invalid above the 50-day; Bracco (2024-05-30) hoped the IWM weekly would become a handle rather than an H&S; Manrav
(2025-01-28) watched a possible SPY H&S. I found no owner (TSDR) entry on the pattern in that archive.

**Not found.** Bracco's "The Parabolic Short" (2025-06-13) has no H&S or rounded-top content; its top variations are
parabolic. No UCT post gives a stop, size or exit rule for this setup.

**[checked] The count.** A fresh search of all 103 public posts for "head and shoulders", "H&S", "rounded top" and
"rounding top" found 9 posts: the 7 Bracco issues and 2 owner sections quoted above, plus one more that is not this
setup: "The Rest of the Week." (2025-10-01), on SMCI, "Inverse head and shoulders look to it on the daily timeframe.
Clear resistance at $48 level." (a bullish inverse pattern, no failure; the section carries no writer's heading). The
2026-08-16 issue also says, of another stock, "Should have bought the inverse head and shoulders break on earnings."

---

## 7. How it fits the account rulebook (section 9)

**Rules that apply as written.** B23 (price and liquidity), B18/F65 (market reading), E57 (market orders), A3 and F62 (stop
a few cents under the day's low), A13 (stop within about 3%), C28 (no more than 4% over the buy point), C29 (not more than
10% over the 10-day), B19, E51, E52 (breakeven, thirds at 3R and 5R, trail on the 10-day or 21-day), F63 (trim at the open
on a gap), B20 (gap through the stop), C33 (time stop), B22 (no new buys in the 3 days before earnings), E56 (3 tries a
week, 6 a month), D41 (a real stop order).

**Fits well.**
- **B26 (the 200-day).** The long is an above-the-200-day trade: 79% of version-B triggers in my run were above it, and
  all of the house's examples were (SMH, QQQ, AMD). Skip the rest.
- **A13 with the house stop.** The trigger day's low was a median 2.1% away and within 3% for 68% of triggers. Brandt's
  own protective level was the trigger day's low.

**Conflicts and decisions.**
1. **The structural stop.** The natural "pattern" stop for a failed breakdown (under the failed-break low) was a median
   9.3% away. A13 and A3 say skip a trade whose honest stop does not fit. Using the trigger day's low solves it, but the
   low of the undercut is then only the invalidation line, not the stop.
2. **C28 on gap triggers.** Many failures complete on a gap (SMH 2026-04-08 opened 4.6% over its right shoulder; LULU
   2023 opened 11.4% over after earnings; AMD 2026-09-22 8.0%). C28 says skip them or wait for a retest. The SMH one was
   the house's best example; that is a real cost of C28 for this setup.
3. **C31 (RS 80 or more).** A stock in a topping pattern has often lost relative strength by the time it fails. Patrick's
   AMD note led with "Relative strength", so the house reads RS here. Whether C31 applies as written is a question for
   the owner (it is not a parabolic or mean-reversion trade, so by the text it does).
4. **B22 (earnings).** Several failures complete on earnings gaps (LULU 2023; TWLO 2026). B22 blocks buying in the 3 days
   before the report; a gap through the right shoulder on the report is then a C28 question.
5. **E56 (retries).** Bulkowski's 30% "triple" busts mean failures often whipsaw. E56's 3 tries a week caps the damage.
6. **The short versions.** (a) Shorting the classical neckline break of an H&S top: 70% of such breaks happen above the
   200-day, where B26 forbids it, and the app's stop (right shoulder + 1%) was a median 9.6% away (A13). (b) Shorting a
   rounded-top break: the app's stop was never within 3%. (c) The mirror short (failed inverse H&S) lives below the
   200-day, so B26 allows it, and C31's mirror (RS 20 or less) applies.
7. **E54 (leveraged ETFs).** Bracco trades the index version through TQQQ and SOXL. The rulebook prefers leveraged ETFs.
   The trigger and stop should be read on the underlying index ETF (QQQ, SMH) and the order placed in the leveraged one.

---

## 8. PROPOSED RULES for our course

Two cards are proposed. **8A, the long** (the house meaning). **8B, the short mirror** (only if the owner wants a short;
see question 1). The classical breakdown short is not proposed as a setup (8C explains why).

### 8A. Failed H&S / Rounded Top (long)

**What it is**
- **Prior trend:** the stock is in an uptrend into the pattern: close above a rising 200-day SMA when the left shoulder
  forms, and the head at least 25% above the lowest low of the 6 months before the left shoulder. [source consensus for
  "prior uptrend"; numbers are my proposal]
- **Structure, H&S:** three swing highs (each higher than the 5 bars on either side); the middle one (head) at least 3%
  above the higher shoulder; the two shoulders within 10% of each other; a neckline through the lowest lows between the
  peaks, sloping no more than 0.5% of price per day. [originator for the shape; numbers my proposal; the app uses 3-bar
  swings and 15%]
- **Structure, rounded top:** a slow arc of at least 20 trading days with no single swing high standing 3% above its
  neighbours, its "neckline" the lower rim (the lowest low of the arc). [Bulkowski's rim definition; numbers my proposal]
- **Length:** left shoulder to right shoulder (or rim to rim) 15 to 100 trading days. [my proposal; IBD says up to
  "seven months"; Brandt says tops are often "brief"]
- **Depth:** head to neckline 5% to 30%. [my proposal; Bulkowski: "Tall patterns perform better"]
- **The failure, version B (preferred):** at least one close under the neckline, or an intraday undercut of the right
  armpit low, that does not fall more than 10% under the neckline before the trigger. [originator: Murphy, Bulkowski's
  10%, Brandt's A and B; UCT: "buy the failed breakdown"]
- **The failure, version A (allowed, graded lower):** no close under the neckline; price turns up from the right shoulder.
  [Model Book card; Edwards and Magee "saved"; my run: +0.04R versus +0.11R for version B]
- **Volume:** no hard rule. The trigger day at 1.25x or more of the 50-day average volume is a grading plus. [my proposal;
  Bulkowski: "Heavy breakout volume suggests better performance"]
- **Location:** close above the 200-day SMA on the trigger day (hard). Close above the 50-day SMA on the trigger day.
  [house rule B26; UCT "50SMA the line in the sand"]
- **Liquidity:** $10 or more and $20M a day or more (B23); position under 1% of average daily volume (D42). [house rule]

**The buy**
- **Trigger:** the first trade above the right-shoulder high (for a rounded top, the dome high) after the failure.
  [originator: Brandt's "C"; course plan "entry over the right-shoulder high"]
- **Order:** a market order once price is through the level, during regular hours. [house rule E57, E58]
- **No chase:** not more than 4% above the right-shoulder high; on a gap past that, wait for a retest of the level or skip.
  [house rule C28]
- **Not stretched:** not more than 10% above the 10-day average. [house rule C29]
- **Options for the trigger, if the owner prefers:** (a) the earlier close back over the neckline (Murphy's warning;
  lower entry, less proof); (b) the right-shoulder high (recommended: it is Brandt's completion, a flat level a member
  can draw, and what the course plan already says); (c) a penny over the head (Bulkowski; the most proof, the highest
  entry; my run found 75% of (b) triggers reached the head within 60 bars).

**The stop**
- A few cents under the trigger day's low, with a real stop order. If that is more than about 3% under the entry, size
  it down to the risk or skip (A3, A13). [house rule; Brandt's protective level was the trigger day's low]
- The low of the failed breakdown is the **invalidation line**, not the stop (it was a median 9.3% away). [my
  computation]

**Trims and trail** (house defaults; nothing in the sources argues for different ones)
- Breakeven at 2R to 5R; a third at 3R, a third at 5R; trail the rest on a close below the 10-day average (fast movers)
  or the 21-day (steadier). [house rule B19, E51, E52]
- A reference, not a rule: the head is the first place sellers may return; Brandt's measured target is the right-shoulder
  high plus the distance from the head down to the post-break low. [originator]

**What invalidates it** (before the trigger)
- A fall of more than 10% under the neckline: the top worked; this setup is gone. [originator: Bulkowski's 10%]
- A close under the 200-day. [house rule B26]
- After the buy: a close back under the neckline is a failure of the failure; the stop should already be above that. [my
  proposal; Bulkowski's double bust]

**The short mirror:** see 8B.

**Best market conditions**
- A Green or Yellow market reading (F65); in Orange, A+ only.
- In my run the edge was largest when SPY was under its 50-day (a market correction) and the stock's own top failed: the
  leader refusing to break while the market falls. That matches Bracco's "coming out of corrections" and his March 2026
  index call. [my computation; UCT]
- For the index version (QQQ, SMH): read the pattern on the index ETF; trade the leveraged ETF if desired (E54). [UCT]

**Common mistakes**
1. Shorting the right shoulder before the neckline breaks. Murphy: the topping signs are cause "to liquidate long
   positions, but not necessarily enough to justify new short sales." [originator]
2. Calling every three bumps a head-and-shoulders. [originator: Brandt]
3. Buying the first bounce back to the neckline. That is the return move the short sellers expect (Murphy, StockCharts).
   Wait for the right-shoulder high. [originator + my proposal]
4. Using the undercut low as the stop. It is usually far more than 3% away. [my computation]
5. Chasing a gap far over the right shoulder (LULU 2023). [house rule C28]
6. Trading it below the 200-day, or in a laggard whose "top" was never a top. [house rule B26, C31]
7. Forgetting Edwards and Magee's warning: a failed top late in a long advance can be the last push. Grade it lower when
   the stock has already run for a year or more. [originator]
8. Re-buying every whipsaw. Count the tries (E56). [house rule]

### 8B. The short mirror: failed inverse head-and-shoulders (busted H&S bottom) (only if the owner wants it)

- **What it is:** a stock below a falling 200-day SMA (B26), RS 20 or less (C31 mirror), forms an inverse H&S (three swing
  lows, the middle lowest), closes over its neckline, rises less than 10%, and comes back. [originator: Bulkowski's busted
  H&S bottom; house rule D47]
- **Trigger:** the first trade under the right-shoulder low after the failed breakout (Brandt's "C", mirrored). Bulkowski's
  version: a penny under the head. Market order (E57); not more than 4% under the level (C28 mirror). [originator + house]
- **Stop:** a few cents over the trigger day's high, within about 3%. [house rule]
- **Trims and trail:** thirds at 3R and 5R; trail the rest on a close above the 10-day average. [house rule D47 mirror]
- **Skip:** hard to borrow or a high borrow fee (D48); a Red market is its best condition (D46).
- **Evidence:** Bulkowski, 16% of H&S bottoms bust, single busts average a 22% drop. My run: the failed-breakout short
  averaged -0.01R below the 200-day (CI -0.06 to +0.05), better than the baseline short (-0.08R) but not positive (4.5).
  This card is the weakest-supported part of the dossier.

### 8C. Why the classical breakdown short is not proposed

- Most H&S tops in strong stocks break while still above the 200-day (70% in my run), where B26 forbids shorting.
- In my run the neckline-break short averaged -0.10R under house management, and the app's own stop was a median 9.6% away.
- Murphy and StockCharts treat the neckline break as a reason to sell longs. The course can teach it that way: a sell
  signal for a long position, and the event that sets up 8A when it fails. [my proposal]

---

## 9. Grading: A+ versus B-

The owner ruled that grading is discretionary (E50). These are observable features from the sources and my run, offered
as a teaching aid, not a checklist.

**A+ (all or nearly all of these).**
- A leader: RS 80 or more, in a top group, a big prior advance (the AMD and SMH examples). [UCT; C31]
- A clear, widely visible top: the head clearly higher (3% or more) than both shoulders, or an obvious dome; a level or
  rising neckline. [originator]
- Version B: a brief, shallow undercut (under 6% below the neckline) that is bought back. In my run, depth under 6% did
  better than 6% to 10%. [originator; my computation]
- The trigger over the right-shoulder high on rising volume, within 4% of the level, with a stop of 3% or less. [house
  rules; Bulkowski on volume]
- Above a rising 50-day and 200-day on the trigger day. [UCT; B26]
- The market is correcting or just turning up (the index itself failing to break down, Bracco's March and April 2026
  calls). [UCT; my computation]
- Plenty of room: no earnings in the next 3 days (B22).

**B- (one or more of these).**
- Version A with no undercut, or an undercut 6% to 10% deep that recovers slowly.
- A pattern in a stock that was not a leader, or already a year or more into its advance (Edwards and Magee's late-stage
  warning).
- A gap trigger more than 4% over the level (C28 says skip; B- at best if bought on a retest).
- A messy structure: the head barely above a shoulder (MSFT 2021, 1.4%), or a "rounded top" that is really a range.
- The second or third try on the same pattern (Bulkowski's double and triple busts; E56).

---

## 10. Questions for the owner

1. **Direction.** The task said short; the house says long.
   (a) Long only, as the card and Bracco use it. (b) Long, plus the mirror short (failed inverse H&S, 8B). (c) Also teach
   the classical breakdown short as a setup. I recommend (a) now, with (b) as an optional Red-market card if you want a
   short for D46: (a) is the house's meaning and the only version with a measured edge in my run; 8B is the true D47
   mirror and fits B26, but my run showed no edge for it (-0.01R below the 200-day, in a sample biased against shorts);
   (c) conflicts with B26 most of the time and lost money in my run (-0.10R).
2. **Which failure counts.** (a) Only after a neckline break (version B, Bracco's "failed breakdown"). (b) Also when the
   break never comes (version A, the card's wording). I recommend both, with A graded lower, and the card's wording and
   glyph updated to show a neckline and an undercut.
3. **The trigger.** (a) A close back over the neckline. (b) The right-shoulder high. (c) A penny over the head. (d) A
   close through a falling line over the right side (Bracco's AMD). I recommend (b).
4. **The stop.** (a) A few cents under the trigger day's low (house default). (b) Under the low of the failed break. I
   recommend (a); (b) was a median 9.3% away.
5. **The rounded top.** (a) Keep it in this setup, with the dome high as the trigger. (b) Split it into its own card.
   (c) Drop it: a close over a dome's high is a new-high breakout, close to the Flat Base and Cup with Handle. Your
   examples use it twice (indexes, March 2026; AMD, August 2026). I lean (a).
6. **C31 for this setup.** Does RS 80+ apply on the trigger day, or is a lower RS (for example 70+) acceptable because the
   top itself pulled the RS down?
7. **C28 on gap triggers.** SMH 2026-04-08, your best example, opened 4.6% over its right shoulder. Keep C28 strict (skip
   or wait for a retest), or allow a larger gap when the gap is the failure itself?
8. **The index version.** Allow QQQ, SMH and the leveraged ETFs (TQQQ, SOXL), as Bracco trades it?
9. **Numbers.** Accept or change: head 3%+ over the higher shoulder; shoulders within 10%; 15 to 100 days; depth 5% to 30%;
   failed break under 10%.
10. **The app's detector text.** The H&S and rounded-top detectors show members a Brandt quote I could not find, a
    Bulkowski number his page contradicts, and a Wyckoff 1908 date no source supports (section 5, items 6 and 7). Correct
    or remove that text? (A code change, outside this dossier.)
11. **A scanner.** Build a "failed H&S" detector (a version-B rule on top of `head_shoulders`), or keep it a chart-reading
    lesson only?
12. **Examples.** Pick the model examples from 4.6 and section 6, and add your own journal trades tagged with this setup,
    if any (the house has no labelled data yet).
13. **The name.** Keep "Failed H&S / Rounded Top", or use Brandt's "H&S Failure" or Bulkowski's "Busted Top"?

---

## 11. Sources (all read on 2026-11-09)

| # | Source | Publisher / author | Published | Reliability note |
|---|---|---|---|---|
| 1 | *Technical Analysis of Stock Trends*, 11th ed., Internet Archive OCR text, https://archive.org/download/robert-d.-edwards-john-magee-w.-h.-c.-bassetti-technical-analysis-of-stock-trend/Robert%20D.%20Edwards_%20John%20Magee_%20W.H.C.%20Bassetti%20-%20Technical%20Analysis%20of%20Stock%20Trends%2C%20Eleventh%20Edition-CRC%20Press%20%282018%29_djvu.txt | Robert D. Edwards, John Magee, W.H.C. Bassetti (ed.); CRC Press | 2018 (first ed. 1948) | Originator; primary. OCR errors possible; the 11th edition adds editor's notes. Chapters 6 and 7 read. |
| 2 | *Technical Analysis of the Financial Markets*, Internet Archive OCR text, https://archive.org/stream/JohnJ.MurphyTechnicalAnalysisOfTheFinancialMarkets/John_J._Murphy_-_Technical_Analysis_Of_The_Financial_Markets_djvu.txt | John J. Murphy; New York Institute of Finance | 1999 | Primary for the "failed head and shoulders" name; futures-first text. Chapter 5 read. |
| 3 | "Head and Shoulders Top", https://chartschool.stockcharts.com/table-of-contents/chart-analysis/chart-patterns/head-and-shoulders-top (and the chart-patterns index page) | StockCharts ChartSchool | no date shown | Established educator; no author named. |
| 4 | thepatternsite.com pages: hst.html, HSTExplained.html, BustHST.html, BustHSB.html, bustedsetup.html, roundingtop.html, BestPatterns.html, glossary.html | Thomas N. Bulkowski | stats 8/26/2020; busted pages 12/28/2020; table note 9/20/21 | Measured ("perfect trades", no years shown). **The site states it "shall not be used to train artificial intelligence (AI) systems".** Read through a fetch tool for citation only (direct requests refused, HTTP 406); short quotes. |
| 5 | "It's as easy as "ABC" – classic H&S failure in Corn", https://www.peterlbrandt.com/its-as-easy-as-abc-classic-hs-failure-in-corn/ | Peter Brandt | 2011-05-18 | Originator of the trade; primary; a futures example. |
| 6 | "Apple and a history of head and shoulder patterns", https://www.peterlbrandt.com/apple-and-a-history-of-head-and-shoulder-patterns/ | Peter Brandt | 2013-08-13 | Primary. |
| 7 | "What does a chart pattern really mean…", https://www.peterlbrandt.com/what-does-a-chart-pattern-really-mean/ | Peter Brandt | 2011-09-19 | Primary. |
| 8 | "Do continuation head and shoulders patterns really exist?", https://www.peterlbrandt.com/do-continuation-head-and-shoulders-patterns-really-exist/ | Peter Brandt | 2011-09-15 | Primary; source of his Schabacker date. |
| 9 | Members-only posts, public excerpts only (WordPress post API): hs-failure (2018-11-27), assigning-fixed-one-done-probabilities-pattern-worthless-endeavor (2018-10-31), head-and-shoulders-top-fails-completes-in-this-commodities-etf-03-30-26 (2026-03-30), must-read-head-and-shoulders-failures-by-peter-brandt (2026-04-16, posted by Jonathon King), at https://www.peterlbrandt.com/<slug>/ | Factor Trading | as listed | Bodies not readable; only excerpts quoted. |
| 10 | "The Wyckoff Method: A Tutorial", https://www.wyckoffanalytics.com/wyckoff-method/ | Wyckoff Analytics (Wyckoff Associates) | not shown | Established school; its selling-test list credits Pruden (2007). |
| 11 | IBD article teasers (bodies paywalled): /research/the-short-side/how-to-sell-stocks-short-uncover-the-head-and-shoulders-pattern/ (Saito-Chung, upd. 2022-02-16), /how-to-invest/investors-corner/late-stage-breakout-failure-good-short-selling-moment/ (Saito-Chung, upd. 2018-11-19), /how-to-invest/investors-corner/head-and-shoulders-pattern-spots-short-sale-entries-but-beware-of-patterns-headaches/ (Gessel, upd. 2024-07-17), /uncategorized/head-and-shoulders-may-signal-a-stocks-top/ (Mao, 2008), /how-to-invest/investors-corner/the-head-and-shoulders-chart-pattern-says-time-to-sell/ (Stoddard), all at https://www.investors.com; found through the site's own sitemaps | Investor's Business Daily | as listed | Established educator; only the first lines were readable. |
| 12 | C.L. Osler and P.H. Kevin Chang, "Head and Shoulders: Not Just a Flaky Pattern", Staff Report No. 4, https://www.newyorkfed.org/research/staff_reports/sr4.html (PDF scan, pages 1 and 2 read as images) | Federal Reserve Bank of New York | August 1995 | Peer-reviewed later (Economic Journal, 1999). Foreign exchange, 1973 to 1994; not stocks. |
| 13 | A.W. Lo, H. Mamaysky, J. Wang, "Foundations of Technical Analysis", NBER Working Paper 7613, https://www.nber.org/papers/w7613 (and the PDF) | NBER; Journal of Finance 55(4), 2000 | 2000 | Academic; U.S. stocks 1962 to 1996; tests return distributions, not trades or failures. |
| 14 | UCT Substack, all 103 posts listed in https://unchartedterritoryy.substack.com/sitemap.xml, read through the public post API; quoted: sunday-scans-4d1, -b99, -56d, -422, -cab, -33a, -ae1, -da5, -0d2; checked: the-parabolic-short | Uncharted Territory (Patrick, TSDR Trading; Bracco) | 2025-06-22 to 2026-08-16 for the quoted posts | House source; quoted exactly; all quoted posts are public editions. Chart images in four posts viewed. |
| 15 | qullamaggie.com post sitemap and its 9 posts | Kristjan Kullamägi | various | Searched; no mention of H&S or rounded tops. |
| 16 | The app's daily bar store (local read-only copy of `bars.db`) | this app | bars to 2026-11-09 | Used for every [my computation] number; method and limits in 4.5. |
| 18 | Richard Schabacker author page, https://harriman-house.com/authors/richard-schabacker/technical-analysis-and-stock-market-profits/9780857199171 | Harriman House (publisher of the reprint) | page undated; read 2026-11-09 [added in checking] | Publisher's dating only ("followed in 1932 by Technical Analysis"); the book itself was not read. |
| 17 | Repo files: `api/services/pattern_engine/detectors/classical/head_shoulders.py`, `rounded_top.py`, `inverse_head_shoulders.py`, `api/services/pattern_engine/primitives/pivots.py`, `primitives/context.py`, `app/src/pages/modelbook/setupCatalog.js`, `app/src/constants/setupGroups.js`, `app/src/pages/journal-2-0/lib/setupTagMap.js`, `api/services/desk_session_insights.py`, `docs/study/sizing_rule.md`, `docs/study/TRADE_PLANS.md`, `docs/study/audits/2026-10-24/owner_verdicts.jsonl`, `docs/study/UNITS-method.md`, `docs/study/UNITS-foundations.md`, `docs/study/plan-review.html`, `docs/study/research/definitions.json`, `docs/superpowers/research/setups/setup_criteria.json`, `docs/superpowers/research/setups/PERFORMANCE_ranked.md`, `docs/superpowers/research/bases/01-bulkowski-classic-patterns.md`, `docs/superpowers/research/bases/06-edwards-magee-murphy-canon.md`, `docs/wisdom/vocabulary/setup-vocabulary-v1.json`, `docs/study/levels/brain_kb_2026-11-06.json`, `docs/study/levels/brain_kb_cycle_2026-11-06.json` | this repo, branch feat/study-content | as of 2026-11-09 | Read directly. The brain files hold member-only Discord material: paraphrased here, wording not copied. |

**Not read, and why.**
- Richard Schabacker's *Technical Analysis and Stock Market Profits*: no copy; the web-search budget for this session was
  used up before I could look for one. Nothing is quoted from it. [checked] Only the publisher's dating (1932, source 18)
  was added.
- Bulkowski's books (*Encyclopedia of Chart Patterns*, *Visual Guide to Chart Patterns*): the O'Reilly preview refused the
  request (HTTP 403). I used his website only.
- Savin, Weller and Zvingelis (2007), on H&S patterns in U.S. stocks: I could not reach a copy. Not used.
- Brandt's members-only posts, IBD article bodies, O'Neil's and Minervini's books, Weinstein's book, Stockbee, Linda
  Raschke: not read for this setup. Nothing is quoted from them.
- The app's detector text credits Adam Grimes and Charles Dow; I did not find or read those claims in a source.

---

## 12. Examples (from our data)

**The rule the scan used (one paragraph).** Daily bars, 2000-01-01 to 2026-11-09, the 2,630 names that ever met the
liquidity rule (B23). Swing highs are 5-bar swings (higher than the 5 bars on each side). An H&S is three swing highs,
left shoulder to right shoulder 15 to 100 bars, the head at least 3% above the higher shoulder, the shoulders within
10% of each other, no bar inside the pattern above the head; the neckline runs through the lowest lows between the
peaks and may slope at most 0.5% of price a day; head to neckline 5% to 30%. Prior uptrend: at the left shoulder the
close is above a rising 200-day SMA and the head is at least 25% above the lowest low of the prior 126 bars. The
failure, version B: within 60 bars of the right shoulder, a close under the neckline or an intraday undercut of the
right armpit low, with no close more than 10% under the neckline before the trigger; version A: price turns up from
the right shoulder with no close under the neckline. The trigger is the first trade over the right-shoulder high
(within 40 bars of the failure for B); a market order (E57) at the level, or at the open if it gapped over, skipped if
the entry is more than 4% over the level (C28) or more than 10% over the 10-day average (C29), or the close is not
above the 200-day SMA (B26), or price is under $10 or 50-day dollar volume under $20M (B23). The stop is 5 cents under
the lower of the trigger day's and prior day's lows, or under the trigger day's low alone if that was more than 3% away;
skipped past 5% (A13). The outcome is a fixed stop walked 60 bars forward with no trims and no trail: the first of the
stop, 3R or 5R touched (same day both: the stop). Rounded tops were not scanned separately (the arc rule in 8A has no
swing-high anchors to vectorise); every hit below is a head-and-shoulders. The scanner and its output are in the
scratchpad, `setups/33-failed-hs-rounded-top/scan_fhs.py` and `final/hits.json`.

**Base rate.** 13,148 hits, 2,630 of 2,630 liquid names scanned (complete, 171 seconds). **30.1% reached 3R and
20.0% reached 5R before the stop**; about 84% touched the stop inside the 60-bar window. Version B (a real break under
the neckline that failed), 7,059 hits: 30.2% to 3R, 20.0% to 5R. Version A (the turn-up with no break), 6,089 hits:
30.0% to 3R, 20.0% to 5R; no difference between the two under a fixed stop. Caveat: this is a fixed stop a median
2.3% under the entry, no breakeven move, no trims, no trail, so it counts touches of 3R and 5R, not the account's
realised R; it also counts every qualifying hit, with no grading, no market filter (F65) and no RS filter (C31). The
earnings table was not used as a filter: some triggers land on an earnings reaction day (flagged below).

**The 10 examples** (all version B, one per ticker, ten different years, each chart looked at; prices as stored,
split-adjusted). "Under" is how far the failed break closed or undercut below the neckline. Stop is 5 cents under the
lower of the trigger day's low and the prior day's low. Best R is the highest high in the 60 bars after entry, in R,
with the stop never touched before it.

| # | Ticker | Trigger | Pattern (LS to RS) | Shoulders / head / neckline | Failed break | Buy | Stop (%) | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|
| 1 | FDX | 2003-03-19 | 53 bars, head 13.6% over the neckline | 45.32 / 47.22 / 42.97, neckline 40.82 | 6.2% under, low 38.44 | 42.98 | 42.42 (1.3%) | 17.3R, 3R in 1 day | A clean three-peak top at the 2003 bear-market bottom; the break under the neckline failed in two weeks, the trigger day was the earnings reaction day (report before the open, 2.5x volume), and price never looked back. The "leader refusing to break while the market falls" case from 8A. |
| 2 | MGM | 2004-09-14 | 87 bars, head 16.9% over the neckline | 22.77 / 24.89 / 22.70, neckline 21.22 | 6.1% under, low 19.80 | 22.71 | 22.30 (1.8%) | 23.7R, 3R in 5 days | Shoulders within 0.3% of each other, a flat neckline, a four-week failed breakdown, then a trigger over the right shoulder with 1.9x volume. The most symmetrical pattern of the ten. |
| 3 | SPG | 2005-11-11 | 73 bars, head 12.4% over the neckline | 68.74 / 75.15 / 69.52, neckline 65.03 | 7.1% under, low 61.03 | 69.53 | 68.76 (1.1%) | 11.9R, 3R in 6 days | A textbook break under the neckline (seven weeks, 7% deep) that was fully recovered; the trigger came with the stock back over the 50-day. Shows that the invalidation line (61) was far from a usable stop; the trigger day's low gave 1.1%. |
| 4 | BXP | 2010-02-26 | 52 bars, head 11.7% over the neckline | 67.71 / 71.73 / 68.01, neckline 63.38 | 3.0% under, low 61.50 | 68.02 | 67.20 (1.2%) | 18.8R, 3R in 5 days | Nearly level shoulders (0.4% apart), a flat neckline, a two-week undercut, then a trigger that held above the 50-day. A learner can draw every line on this one. |
| 5 | MCO | 2011-01-06 | 43 bars, head 9.2% over the neckline | 28.02 / 28.93 / 27.71, neckline 26.41 | 1.0% under, low 26.10 | 27.98 | 27.66 (1.1%) | 21.1R, 3R in 1 day | The shallow version: the head only 9% over the neckline and a one-day, 1% undercut. Teaches that the failure can be small. The trigger day gapped 1% over the level (entry at the open, inside the 4% chase limit) on 2.6x volume; our earnings table lists an 8-K dated that day, so treat the gap as a news or earnings day, not a quiet one. |
| 6 | ICLR | 2015-01-14 | 71 bars, head 15.6% over the neckline | 53.50 / 59.81 / 56.17, neckline 51.94 | 3.2% under, low 49.75 | 56.18 | 54.96 (2.2%) | 13.3R, 3R in 21 days | A slow one: the trigger came on average volume (1.0x) and 3R took three weeks, then the stock ran 25%. Shows the trade does not need a volume spike to work, and why the trail (10-day or 21-day) matters. Right shoulder 5% above the left: graded lower than 2 and 4. |
| 7 | MUSA | 2022-03-15 | 62 bars, head 14.2% over the neckline | 187.55 / 202.20 / 184.96, neckline 176.18 | 6.8% under, low 164.30 | 184.97 | 182.98 (1.1%) | 39.0R, 3R in 1 day | The best outcome of the ten: a 7% break under the neckline during the early-2022 correction, recovered in three weeks; the trigger over the right shoulder was followed by a 40% run. The 8A "best conditions" case. |
| 8 | TOL | 2024-07-12 | 63 bars, head 16.1% over the neckline | 124.67 / 135.37 / 123.68, neckline 118.53 | 7.1% under, low 108.86 | 123.69 | 122.25 (1.2%) | 22.5R, 3R in 2 days | Equal shoulders (0.8% apart), a flat neckline, a seven-week failed breakdown to 109, then a trigger on 1.3x volume above the 50-day. The home-builder move of summer 2024 started here. |
| 9 | NFLX | 2025-04-21 | 69 bars, head 20.9% over the neckline | 94.17 / 106.45 / 99.87, neckline 87.88 | 6.0% under, low 82.11 | 99.88 | 97.26 (2.6%) | 13.1R, 3R in 3 days | The April 2025 undercut: a 6% break under the neckline that failed within two weeks. The trigger day was the earnings reaction day (report 2025-04-17 after the close; 2.0x volume); the open was under the level, so the entry was at the level, not a chase. Prices are split-adjusted. |
| 10 | ABNB | 2026-06-15 | 60 bars, head 15.7% over the neckline | 139.00 / 147.25 / 138.04, neckline 131.65 | 3.0% under, low 127.23 | 138.05 | 134.25 (2.7%) | 14.6R, 3R in 9 days | The most recent: shoulders 0.7% apart, a 3% undercut in late May, a trigger over 138 on 1.3x volume with the 200-day rising underneath, then a 35% advance. The stop is the widest of the ten (2.7%) because the trigger day's range was wide. |

The charts: `setups/33-failed-hs-rounded-top/final/01_FDX_2003-03-19.png` to `10_ABNB_2026-06-15.png`, and the three
phone sheets `final/sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png` (one column). Each chart draws the pattern box,
the LS / HEAD / RS peaks, the neckline, the failed-break bar, the buy level (right-shoulder high), the stop, 3R and 5R,
with the 10- and 21-day EMAs and the 50- and 200-day SMAs.

**Notable failures (from the same scan, looked at on the chart).**
- **AAPL, 2026-08-28.** A clean 51-bar pattern (shoulders 317.40 / 320.28, head 13.5% over the neckline, a 2.8%
  undercut). The trigger over 320.28 was stopped the next session (stop 315.40, 1.5% away, best 0.0R), and the stock
  then ran to 350 without the trade. A whipsaw, not a wrong read: the lesson is E56, count the tries and allow a
  second entry over the same level; a 1.5% stop under a big stock's trigger day is tight.
- **CAT, 2024-07-18.** The shoulders were 8.8% apart (334.87 left, 364.43 right), so the "right-shoulder high" sat
  almost at the head and the trigger was late and high. Stopped at once (best 0.0R); the stock chopped for two months
  before its autumn run. Grade uneven shoulders lower (Bulkowski's "even shoulders" note in 3.4; the 8A 10% tolerance
  is the outer limit, not the ideal).
- **DDOG, 2025-01-28.** The neckline sloped up so steeply (right armpit far above the left) that it ran 2.4% ABOVE the
  right-shoulder high at the trigger: the drawn pattern was not a top at all. The trigger failed in two days (best
  0.0R) and the stock lost 40% after its February earnings. When the neckline is above the buy point, the pattern is
  mis-drawn; skip it.
- **GOOGL, 2026-09-18.** The H&S formed under a higher high from May (405), so it was a lower-high structure inside a
  stock that had already topped; the trigger at 351.60 stalled under the 50-day and the neckline (362), reached 0.8R,
  and the stock fell 20% by late October. The 8A prior-trend test passed on the numbers but the chart showed the real
  top months earlier: Edwards and Magee's "last push" warning (common mistake 7).

**Limits of this check.** The scan is the H&S half of 8A only; a rounded-top scan was not written. The stop, chase and
stretch rules are the house defaults with no discretion; the market reading (F65), the RS rating (C31) and the grading
in section 9 were not applied, so the base rate is a floor for an ungraded, unfiltered signal, not what a member
following the full plan would see. The earnings table (complete from about 2005) was used only to flag the examples'
trigger days, not to filter. All numbers are from the local bar-store copy and were not re-run elsewhere.

---

## 13. Removed in checking (cold check, 2026-11-09)

**Method.** 104 quotes and attributions were matched word for word against freshly fetched copies of their sources
(99 exact; 4 differed only by OCR line-break artefacts in the Murphy scan; 1, the "Jonathon King" byline, was confirmed
through the site's author record rather than the post text). Bulkowski's eight pages were read again through a fetch
tool (direct requests still answer HTTP 406) and every number quoted from them was found on the page. The scanner
summary in section 5 was read against `head_shoulders.py`, `rounded_top.py` and `primitives/pivots.py`; every
threshold, level, weight and member-facing sentence quoted there is in the code. The 10 example rows in 4.6 and the
dated prices in section 6 were re-queried from the same bar-store copy and matched. The simulation figures in 4.5 were
compared with the writer's own summary files and matched; the simulation itself was not re-run.

**Nothing was removed.** Four statements were corrected in place, each marked "[checked]":
1. The bar-store copy holds **4,284** tickers with daily bars, not 4,188 (4.5).
2. IBD's "seven months" article was published 2016-01-05 and updated 2018-11-19; the draft dated it only "2018" (3.7).
3. Schabacker's book: the reprint publisher Harriman House dates the first edition **1932**, so the app's 1932 is the
   publisher's date and Brandt's "written in 1937" is the outlier; the draft said neither date could be verified
   (sections 2, 5, 11; new source 18).
4. The comparison table's StockCharts "Moving averages" cell was sharpened: the page names "long-term moving averages"
   only as one of the other factors to weigh against a price target (3.8).

**Added.** The rest of Bulkowski's symmetry sentence ("and 19% for even shoulders", 3.4); the count of UCT posts that
name the pattern, 9 of 103, with the one inverse-H&S mention that is not this setup (section 6).

**Still unverified, and said so in the text.** Brandt's 1937 date; "Charles Dow" as the pattern's origin; the simulated
R results in 4.5 and 4.6 (the writer's scripts and outputs were read, not re-executed); the NY Fed and NBER papers
(listed, never quoted); the owner's Discord archive entries (paraphrased from the house brain files, not from Discord).

## 14. Failures and near-misses (from our data)

(Charts 2026-11-10, same scan and same render as section 12, in
`_study-resume/scratchpad/setups/33-failed-hs-rounded-top/final/`: `fail_1-4.png`, `near_1-4.png`,
`pair_28-2b-reversal.png`. The near-misses come from `near_scan.py`, the section 12 rule re-run with the structure,
trend, depth, length, neckline, deep-break, 200-day, 50-day, chase and stretch gates turned into flags, keeping the
candidates that fail exactly one gate (`final/near_hits.json`, 2,630 of 2,630 names). All eight are version B. Buy =
the trade over the right-shoulder high (or the open if it gapped over); stop 5 cents under the lower of the trigger
day's and prior day's lows; "where it stopped" is the first session whose low reached the stop. The scan is still the
H&S half of 8A: no rounded-top failures were charted.)

**Four valid failed H&S longs that lost (every scan gate passed, traded by the rules).**

| # | Ticker, date | The pattern | Buy | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | AAPL 2026-08-28 | 51 bars, shoulders 317.40 / 320.28, head 344.57 (13.5% over the neckline), a 2.8% undercut | 320.29 | 315.40 (1.5%) | day 1, 2026-08-31, low 312.80 | 0R. The stock then rose 11% within 60 sessions without the trade. A whipsaw, not a wrong read. | fh.retries (count the tries; a second entry over the same level is allowed) |
| 2 | CAT 2024-07-18 | 73 bars, shoulders 334.87 / 364.43 (8.1% apart), head 382.01 (15.4% over), a 6.5% undercut | 364.44 | 355.70 (2.4%) | day 1, 2024-07-19, open 355.35 (a gap under the stop) | 0R. Two months of chop followed (15.7% under the entry at the 60-session low) before the autumn run. | fh.hs_structure (uneven shoulders put the trigger near the head; graded down); fh.stop_gap |
| 3 | DDOG 2025-01-28 | 39 bars, shoulders 133.66 / 147.64, head 170.08 (22.7% over), a 6.5% undercut; the neckline at the trigger (151.23) sits 2.4% above the buy level | 147.65 | 143.35 (2.9%) | day 1, 2025-01-29, low 141.96 | 0R, then the stock lost 44.7% within 60 sessions. | fh.neckline (a neckline above the buy point: the pattern was mis-drawn, skip) |
| 4 | GILD 2014-12-19 | 67 bars, shoulders 110.64 / 107.58, head 116.83 (19.1% over), a 2.0% undercut | 107.59 | 104.59 (2.8%) | day 1, 2014-12-22, open 96.73 (a gap under the stop) | The fill was far under the stop; the stock lost 20.1% within 60 sessions: the top worked. | fh.stop_gap (the first 30-minute low is the new stop, out past 2R); fh.inv_after_buy |

**Four near-misses (the chart looks like a failed H&S; exactly one gate fails).**

| # | Ticker, date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|
| 1 | VGK 2021-07-12 (an ETF) | fh.depth | the head is 4.7% over the neckline (rule: 5% to 30%) | a flat shelf in an uptrend, not a top; the "failed break" was a 1.5% dip. Stopped at 0R |
| 2 | JPM 2025-05-05 | fh.hs_structure | shoulders 226.75 / 254.67, 11.0% apart (rule: within 10% of each other) | a V-shaped recovery whose right shoulder sits near the head; the trigger is late and high. Stopped at 0R |
| 3 | CSCO 2025-05-13 | fh.inv_deep_break | a close 10.9% under the neckline before the trigger (rule: more than 10% and the top worked) | a completed top and a full V recovery; the buy over 62.04 was stopped at 0R |
| 4 | AMZN 2014-06-11 | fh.above_200 | the trigger close is 2.6% under the 200-day SMA (rule: above it) | a bounce inside a decline under the 200-day; B26 says no long. Stopped at 0R |

**What the four losses have in common.** All four were stopped on the very next session, two of them on a gap under
the stop. The stop under a big stock's trigger-day low is 1.5% to 2.9% away, tight against the next day's range, which
is why the whipsaw (AAPL) and the second try matter. Two of the four (DDOG, GILD) were tops that then worked, and the
fast failure of the buy was itself the signal: a close back under the neckline after the buy is the failure of the
failure. The other two (AAPL, CAT) were pattern reads that the stock later rewarded without the trade. For the member:
the trigger-day low is the stop and the failed-break low is only the invalidation line; a gap under the stop is handled
by the 30-minute rule; and uneven shoulders or a neckline above the buy point are reasons to pass, not to adjust.

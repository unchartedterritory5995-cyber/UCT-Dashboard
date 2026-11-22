# Setup 34: Capitulation (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Every quote was
copied from the page, post or file named next to it and then checked word for word, by script, against a saved copy of
that source (the two Bulkowski pages are the exception: his site refused direct requests, so those quotes are as a fetch
tool returned them, and I say so where they appear). Quotes keep the writer's own spelling and are 40 words or fewer.
Where I could not read a source, I say so and give no wording from it.

**Cold check (2026-11-09, a second reader).** Every quote in this file was re-opened at its source and matched word for
word by a separate script (the Bulkowski pages again through a fetch tool, since they still refuse direct requests);
every app claim was re-read in the code; the example table (6.4) and the study (4.5) were recomputed from fresh Yahoo
downloads with independently written code and match. Corrections are made in place; what could not be confirmed is
listed under "Removed in checking" at the end, and the checker's additions are marked "(added in checking)".

**Cold check, finished (2026-11-09, resumed by a third reader).** The earlier check had no "Removed in checking"
section; it is now at the end. This pass fetched every outside page and all 103 Substack posts again with its own
client, and a fresh script matched all 330 quoted strings in this file (every quote of three words or more) against
those copies and the repo files word for word. Every post quoted in section 6 was traced to its Substack date and to
the signed section it sits under (Bracco's, TSDR's, "Bracco - ..." in The Rest of the Week, or an unsigned intro or
index note), and the attributions hold. The detector summary (5.1) was re-read against `uct_capitulation.py`,
`uct_setups_common.py`, `liquidity.py`, `tag_textbook.py`, `setup_tags.py`, `registry.py` and `docs/feature_flags.json`;
the AAPL fixture levels (181.99 / 181.92 / 182.13 / 182.20) were re-run from the fixture file; the 4.5 study and the
6.4 table were recomputed from the saved bars and reproduce every number; and the detector was re-run on each UCT
example in 5.3 item 1 (C1 false on every one). Corrections from this pass are small and are listed at the end.

**Who is who in UCT quotes.** The owner is Patrick (TSDR). He writes the "TSDR’s Weekly Outlook & Watchlist" section of
the Sunday Scans (later titled "Patrick (TSDR)’s Weekly Outlook & Watchlist") and the "TSDR Trading" part of "The Rest
of the Week". Bracco writes "Bracco’s Breakdown & Top Ideas", "Bracco’s Market Health Tracker", his signed part of "The
Rest of the Week", and "The Parabolic Short". The intros and the index and ETF chart notes are not signed; I mark them
"unsigned". Dates are the Substack post dates (UTC). Two quotes come from the brain KB extract already in this repo
(both in `docs/study/levels/brain_kb_cycle_2026-11-06.json`; the other KB ids cited below are in that file,
`brain_kb_rules_2026-11-06.json` (15332) and `brain_kb_2026-11-06.json` (11061)); they are
Bracco's chat words as that file records them, cited by KB id. Other KB entries are summaries written by a tool, not
anyone's words; I cite those by id only and quote nothing from them.

**Tags used in section 8.** **[source consensus]** several outside sources agree; **[originator]** the named trader's
own words; **[UCT]** the owner, Bracco or a signed UCT contributor; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

**Limits of this research.** The session's shared web-search budget ran out after three searches in this run. After that
I could still read pages whose addresses I already had or could take from a page I had read, but I could not search for
new ones. So I did not read anything from William O'Neil or IBD, Brian Shannon, Linda Raschke, Larry Connors or Mark
Minervini on this setup, and I did not find Lance Breitstein's own written checklist for a capitulation trade. Investopedia
could not be fetched, and TraderLion's article on Breitstein returned 403. Where this matters, the section says so.

**Related dossiers.** 18 (Qullamaggie and the Kell cycle) covers Kullamägi's Parabolic Short and long and Kell's
Reversal Extension in more depth. 10 (Weinstein 4B-) covers buying late in Stage 4. 12 (MA pullbacks) and 13 (MA
reclaim) cover the "undercut and rally" of a moving average. The house Oops Reversal (Larry Williams) and the Wyckoff
Spring detector (`wyckoff_spring.py`) are the nearest relatives of the entry this dossier recommends. Where this dossier
overlaps a sibling, the owner should rule once for both. (Added in checking:) 38 (Parabolic Long) works from the same
B26 ruling and question 1 below is the same question; 36 (Mean Reversion) and 39 (Parabolic Short) also cover Bracco's
long-side flushes; 35 (Wyckoff spring), 30 (Oops) and 29 (undercut and rally) cover the recommended entry.

---

## 1. What it is, and why it works

**In two sentences.** A capitulation long is a short, fast trade bought after a burst of forced, panicky selling has
stretched a stock or index far below its own averages on heavy volume. You do not buy the falling price; you buy the
first sign that the forced sellers are done (a reclaim of the low, of VWAP or of the morning's range), with a stop under
the low, and you take profits into the snap back toward the short averages.

**The psychology.**
- **Who is selling.** Not patient holders. The CMT Association: "Climax structures are not created by strong
  handed/well informed buyers buying the weakness, but by over-levered and poorly placed longs capitulating and
  liquidating positions as their pain becomes too much to bear." Margin calls, stop orders and leveraged products
  unwinding all sell at any price. Bracco on a crypto flush: "Felt like first real capitulatory day in crypto land
  following recent breakdowns" (The Rest of the Week, 2025-11-05).
- **Who is trapped.** Late breakout buyers and dip buyers who are now underwater, and new shorts. CMT: "The bearish news
  also lures in new weak handed/trading shorts, who, trapped by the sudden reversal, are forced to cover." Bracco on
  FIGR: the drop "wiped out the late chasers and shook out the weak hands" (Sunday Scans 2026-01-18).
- **Who is buying.** Agile traders who supply liquidity when nobody else will. CMT: "Remember that the buyers during the
  SC are not generally long-term investors but are more likely sophisticated agile traders." The Wyckoff school says
  "heavy or panicky selling by the public is being absorbed by larger professional interests at or near a bottom."
- **Why the bounce is fast.** Once forced selling is done there is little supply left. CMT: "Once the immediately
  available supply is cleared, there is not much resistance to the market advancing." Academic work agrees that
  short-term reversals pay those who provide liquidity in a panic, and pay most when fear (the VIX) is high (Nagel, 2011;
  section 4).
- **Why it is dangerous.** The stretch can keep stretching. John Bollinger: "Closes outside the Bollinger Bands are
  initially continuation signals, not reversal signals." Bulkowski measured that after a one-day collapse, "Forty-six
  percent make a lower low the next day" (section 4). Kell: "Daily Reversal Extensions are volatile."

---

## 2. Origin and naming

- **"Capitulation" is general market language.** I found no single person who coined it. It means holders giving up and
  selling at any price. Pradeep Bonde used it on his blog in 2006 ("Total bull capitulation", 2006-07-13). I could not
  trace the first use.
- **Richard Wyckoff's "selling climax" (SC)** is the classic named version of the event (whether it is the oldest, I could
  not verify), inside his accumulation schematic
  (preliminary support, selling climax, automatic rally, secondary test). Today it is taught by the Wyckoff school: the
  tutorial by Roman Bogomazov and Michael Lipsett on StockCharts ChartSchool and on wyckoffanalytics.com. I did not read
  Wyckoff's own 1930s course, so I cannot give his words or a date.
- **The CMT Association** teaches the same event as a "selling climax" reversal-bar pattern (IBKR Campus, 2023-07-25):
  "Climaxes are exhaustion/capitulation patterns."
- **Lance Breitstein** (formerly a senior trader at the prop firm Trillium, per Chat With Traders) talks about the *trade*
  in interviews. His first Chat With Traders episode lists "the emotional edge in trading capitulations" (episode 228,
  published 2022-02-09; its notes say it was recorded in 2019). His entry idea is "the right side of the V" (his X post
  of 2022-03-29, section 3.6). Bracco credits him: "a concept I picked up from Lance
  Breitstein" (The Parabolic Short, 2025-06-13). I could not read Breitstein's own list of capitulation criteria.
- **Kristjan Kullamägi** calls the swing version a **"parabolic long"**: the long side of his Parabolic Short
  (qullamaggie.com, 2021).
- **Oliver Kell** calls the capitulation low in his Cycle of Price Action a **"Reversal Extension"** (TraderLion,
  2024-06-11, bylined Oliver Kell).
- **UCT's own names (Bracco):** "ATR mean-reversion long", "the classic mean reversion setup", "Rubber band longs",
  "rubber band / capitulation long", "parabolic long", "capitulation buy point", "5-star" (sections 6.1 to 6.3). The
  owner's account rulebook uses **"parabolic long"** and defines it as the mirror of Bracco's parabolic burst (B26).
- **Other names in use:** washout, flush, oversold bounce, mean reversion long, climax low, "puke" (Bracco: "ETH puked
  -15% in less than an hour", 2025-10-12), "MAU&R" (moving average undercut and rally, Bracco 2025-10-26), "buying the
  dip" (loosely).
- **In this app:** the scanner is `uct_capitulation` ("UCT Capitulation"), its Study skill is `scan.volume_climax` (shown
  as "VOLUME CLIMAX"), the market version is the first "Bottoms" signpost in the Model Book, and the journal has
  "Parabolic Long" and "Mean Reversion L/S" tags but no "Capitulation" tag (section 5).

---

## 3. Every definition I found, source by source

### 3.1 The Wyckoff school: selling climax (originator's school)

Source: "The Wyckoff Method: A Tutorial" by Roman Bogomazov and Michael Lipsett, StockCharts ChartSchool (page says "Last
updated 2 years ago"); the same text on wyckoffanalytics.com/wyckoff-method/.
- **Prior trend.** A long fall. Preliminary support comes "after a prolonged down-move."
- **Warning before it.** Preliminary support: "Volume increases and price spread widens, signaling that the down-move may
  be approaching its end."
- **The climax.** "heavy or panicky selling by the public is being absorbed by larger professional interests at or near
  a bottom." And: "Often price will close well off the low in a SC, reflecting the buying by these large interests."
- **The bounce.** Automatic rally: "A wave of buying easily pushes prices up; this is further fueled by short covering."
- **The test.** "If a bottom is to be confirmed, volume and price spread should be significantly diminished as the market
  approaches support in the area of the SC." And: "If the ST goes lower than that of the SC, one can anticipate either new
  lows or prolonged consolidation."
- **Not every bottom has one.** "Sometimes the downtrend may end less dramatically, without climactic price and volume
  action."
- **Where the Wyckoff trader buys.** Not at the climax. The buy is later, in Phase C: "In Wyckoff's method, a successful
  test of supply represented by a spring (or a shakeout) provides a high-probability trading opportunity."
- **Numbers.** None. No volume multiple, no depth, no length.

### 3.2 CMT Association: buying and selling climaxes (established educator)

Source: "Reversal Bar Patterns Part 3: Buying and Selling Climaxes", CMT Association, posted on IBKR Campus 2023-07-25
(also on TradingView). The CMT says the topics are part of its curriculum. (Added in checking:) IBKR Campus names the
author as Stewart Taylor of the CMT Association; the text is written in the first person ("I begin actively
monitoring"), so it is one CMT member's teaching, not an official CMT standard. It also uses "preliminary demand (PD)"
where the Wyckoff tutorial says "preliminary support".
- **Prior trend.** "Climaxes typically occur in extremely extended markets that have trended a long while."
- **Context.** Bearish news, dismal sentiment, extreme put/call readings. The author starts watching "when oscillators
  reach extreme readings or after a long period of trending behavior."
- **Shape.** "Climax patterns are typified by extremely heavy volume, much wider than normal price spreads and typically
  feature a clear reversal pattern (often a key reversal) bar or bars." "There is generally an acceleration of the trend,
  with wider price spreads and a steeper angle of decline."
- **Length.** "At one time climaxes were mostly single bar affairs, but now the climax structure often builds over several
  trading days."
- **The bounce.** "Small ARs are not to be trusted." SC buyers "often take advantage of the reaction rally to take trading
  profits."
- **The test.** "This is why climax structures MUST BE SUCCESSFULLY TESTED before they represent anything other than short
  term capitulation." The test should be "well separated in time" and on lower volume. "The successful completion of the
  test generally represents an all clear for longer term positions."
- **Time frame note.** "It is also worth noting that the notes around sentiment are not particularly meaningful when working
  in time frame shorter than daily."
- **Entry, stop, target.** Not given as numbers.

### 3.3 Oliver Kell: the Reversal Extension (originator)

Source: "Reversal Extension: How Stocks Bottom", TraderLion, bylined Oliver Kell, published 2024-06-11 (read as the
Internet Archive copy of 2025-08-20; the live page still returned HTTP 403 when checked). (Added in checking:) the page
carries Kell's byline but speaks of him in the third person ("As a long-biased trader, Oliver Kell uses the Reversal
Extension"), so it is most likely TraderLion's write-up of his method rather than his own prose.
- **What it is.** "A Reversal Extension is formed when the price pulls away from the moving averages, then snaps back up
  and is accompanied by heavy volume." "Heavy volume at the lows indicates fear has set in, and traders are capitulating
  their positions."
- **How far.** "When the price is extended well below the 10-day moving average, and the moving averages are extended away
  from each other, begin to look that snap back." No number.
- **Confirm higher up.** "Extensions on a daily chart should see support on a weekly chart"
- **A trade or not.** "The Reversal Extension is not necessarily a playable setup but more of a change in mindset." If
  taken: "Stops are placed just below the low of the Reversal Extension bar. Be quick to take profits and raise stops with
  the first profit target at the retest of the 20 EMA." And: "Often, trading the daily Reversal Extension is best avoided."
- **Size.** "If you take this trade, make sure your position sizing is appropriate and manage risk accordingly."
- **The intraday use.** In a daily uptrend, a Reversal Extension on a 5-minute chart can be used "as a pattern to add to
  positions when a stock pulls back."
- **The index use.** "Get aggressive trading individual stocks when you see a Reversal Extension on the index."
- **Hindsight.** "Reversal Extensions are not a certainty until after the fact."

### 3.4 Kristjan Kullamägi: the parabolic long (originator)

Source: "3 TIMELESS setups that have made me TENS OF MILLIONS!", qullamaggie.com, posted by Kristjan Kullamägi, dated
2021-01-08 and updated 2021-04-28.
- **When.** "Let’s take a look at a parabolic long setup. These are not very common but any time a successful parabolic
  short goes down 50-60%+ in a few days, that’s the premise for the long setup."
- **Entry.** "Entry is opening range highs or the first green 5-minute candle or any range break to the upside if the
  stock doesn’t rally out of the gate, which they usually do."
- **Size of the move.** "These things can bounce 50-100% in a few days."
- **How common.** "Most of these are short setups, but sometimes there are also good long setups but they don’t occur as
  often."
- **Stop and target for the long.** Not stated in the post. For the short side his target is "the 10- and 20-day moving
  averages, that’s where these stocks usually bounce." His example of the long is GBTC in 2017 (chart only).

### 3.5 John Bollinger: what a band breach means (originator of the indicator)

Source: "BOLLINGER BANDS RULES", bollingerbands.com, John Bollinger, CFA, CMT.
- Rule 6: "A tag of the lower Bollinger Band is NOT in-and-of-itself a buy signal."
- Rule 7: "In trending markets price can, and does, walk up the upper Bollinger Band and down the lower Bollinger Band."
- Rule 8: "Closes outside the Bollinger Bands are initially continuation signals, not reversal signals."
- Rule 22: "Bollinger Bands do not provide continuous advice; rather they help identify setups where the odds may be in
  your favor."
- This matters because our scanner's core test is a close far below the lower band (section 5), and the owner and Bracco
  both use a close outside the band as evidence of stretch (section 6).

### 3.6 Lance Breitstein: the right side of the V (originator of the entry idea)

Sources: his X post of 2022-03-29 (https://x.com/TheOneLanceB/status/1508815079541776397, text read through X's public
embed service); Chat With Traders episodes 228 (2022-02-09) and 236 (2022-06-27), show notes only.
- **The idea.** "THE “RIGHT” SIDE OF THE V: such a powerful concept that many traders don’t conceptually understand."
  And: "Same prices on same chart can have DRASTICALLY DIFFERENT E(V)!" (marked "(1/4)"; parts 2-4 not read). My
  reading: the same price is a better buy after the fall has turned up than while it is still falling. (Added in
  checking:) Bracco's own definition, in The Parabolic Short: "entering a trade after a stock's price reverses from a
  sharp incline or decline (forming a V-shape), aligning with the new intraday trend for higher-probability, lower-risk
  entries."
- **Capitulation.** Episode 228's notes list "the emotional edge in trading capitulations". Episode 236's notes list
  "The Broken Slot Machine, The Right Side of the V, and Channel Fundamentals."
- **What I could not read.** His own criteria list for a capitulation trade. Web pages that claim to list "his" checklist
  are community or AI-written summaries; I did not use them. (Added in checking:) a web search in the finishing pass
  found the same: no page in Breitstein's own words lists his capitulation criteria. TraderLion's "Lance Breitstein's
  Simple Setup That Made Millions" still returned 403; the rest were third-party sheets and video summaries, not used.
- **A secondary account (his mentee).** Austin Mitchum, an equities day trader, "Trading The Frontside vs The Backside"
  (Baytrading Substack, 2025-04-22): "This concept was made notorious by my mentor, Lance Breitstein". (Added in
  checking:) the sentence goes on: Breitstein, he says, "coined this change in character as the “right side of the V”",
  so the claim that Breitstein coined the phrase is Mitchum's, not confirmed from Breitstein himself. His own checklist
  for a capitulation day: "Has there been a price flush and volume capitulation in my stocks? This is a sign that the
  stops have gone off, which is step 1 for a reversal." Then: "Step 2 for a reversal is a retest of the open price and
  holding new highs." And: "Price has to be back above VWAP." These are Mitchum's words, not Breitstein's.

### 3.7 Pradeep Bonde (Stockbee): market-level capitulation (originator of his breadth tools)

Source: stockbee.blogspot.com posts found with the blog's own search for "capitulation".
- "Capitulation kind selling leads to sustainable bounces." (2011-09-23)
- "That kind of selling leads to capitulation bottom. Low intensity selling is more in line with correction after a big up
  move." (2012-05-31)
- On a panic bounce: "This kind of game is for extremely nimble players." And: "Such bounce in first phase invariably have
  the most oversold falling knives bouncing back." (2007-08-16)
- He reads capitulation from breadth (his Market Monitor). He did not publish a single-stock capitulation buy rule that I
  found.
- (Added in checking.) His one numeric definition I found is for the market, in "How to use market breadth to avoid
  market crashes" (2011-08-08): a chart of the "number of stocks up 25% in 65 days", where "Readings below 200 indicate
  seller capitulation." He adds that such low readings historically "lead to tradable bounce in next 1 to 6 weeks time
  frame." A 2007-08-16 post lists the common traits of a panic bounce, among them "break of some technical level like
  200 day MA, high volume selling, and capitulation by many players."

### 3.8 UCT (Bracco): the ATR mean-reversion long

Bracco's definition is the fullest anyone at UCT has written. It is set out in section 6 and summarised here so the table
can compare it. His FIGR checklist (Sunday Scans 2026-01-18): "A Cascading sell off (parabolic curve)", "Increasing volume
on each leg lower", "Extreme 244% ATR move", "600% above avg 5-minute volume", "Retesting the prior all-time high", "$50
psychological level". Entry on the washout of the level "on the highest volume of the day"; stop under the day's low;
partials on the bounce; plan to trail the 20 EMA. For indexes he adds a stretch of about 3 ATR below the 50-day, a gap
down of 1 ATR or more, and Monday turns (Sunday Scans 2026-03-22).

### 3.9 Comparison table

| Source | Prior trend | Shape and length | How stretched | Volume | Averages or bands | Trigger | Entry | Stop | Target |
|---|---|---|---|---|---|---|---|---|---|
| Wyckoff school | prolonged down-move | PS, then SC; widening spread | not given | heavy, climactic | none | none at the SC | later: spring or test in Phase C | not given | the AR high bounds the range |
| CMT Association | trended a long while; extreme | acceleration, steeper angle; one bar or several days | extreme oscillators | extremely heavy | none | reversal (key reversal) bar | not given; test must follow | not given | AR; longer positions after a successful test |
| Kell (Reversal Extension) | downtrend (or a pullback, intraday) | snap back from an extension | well below the 10-day; MAs spread apart | heavy at the lows | 10-day, 20 EMA | snap back with volume | often best avoided on the daily | just below the RE bar's low | first target: retest of the 20 EMA |
| Kullamägi (parabolic long) | after a parabolic run that failed | crash over a few days | down 50-60%+ in a few days | not stated | not stated | intraday turn | ORH, first green 5-min bar, any range break up | not stated for the long | not stated for the long; bounces of 50-100% |
| Bollinger | n/a | n/a | a close outside the band | rules 2-4: confirm with an unrelated indicator (momentum, volume, sentiment) | lower band | a band tag is not a signal | n/a | n/a | n/a |
| Breitstein (as read) | n/a | a "V" | not read | not read | not read | the turn ("right side of the V") | after the turn | not read | not read |
| Mitchum (secondary) | "Daily chart and multiple legs - the more extended, the better" (listed for fading a run-up; mirrored) | flush | not given | volume capitulation | VWAP | retest of the open, new highs | above VWAP | the prior low | not given |
| Stockbee | market correction | brutal, not low-intensity, selling | breadth extremes | high-volume selling | 200-day break named as a common trait | bounce | not given | not given | not given |
| Bracco (UCT) | leaders in uptrends, or indexes in corrections | cascading 1-3 day burst; capitulation often on a Monday | 2-2.5 ATR intraday move; index -3 ATR from 50-day (-5 in crashes) | rising on each leg; record; 5-min volume "600% above avg" | 20 EMA, 9 EMA, 5-day SMA, lower band, AVWAP | washout of a support level, then the turn | intraday, on the turn | under the day's low | partials on the bounce; trail the 20 EMA; 1-3 day hold typical |
| Our app (`uct_capitulation`) | a 3-session cascade of 1.5 ATR or more | climax day + optional gap below | close more than 1 ATR under the lower band | record, or 2x and rising over 3 down days | 20-day band; 50-day (label) | the flush day itself | the close | the day's low | 2R and 3R |

### 3.10 Where the sources disagree

1. **What comes before it.** Wyckoff, the CMT and our app want a long or multi-day decline first. Bracco's best trades
   (FIGR, SNDK, SOXL, KORU) were short, violent flushes in leaders; SNDK, SOXL and KORU were still far above their
   200-day lines, and FIGR was too new to have one.
   Kullamägi's long comes after a parabolic run has failed.
2. **Buy the climax or wait for the test.** Wyckoff buys at the spring or test, not the climax. The CMT says a climax
   "MUST BE SUCCESSFULLY TESTED". Kell says trading the daily Reversal Extension "is best avoided". Kullamägi, Breitstein
   and Bracco buy only on an intraday turn: sometimes on the flush day itself (Bracco's FIGR; his ETHU fill was in after
   hours on the flush day), sometimes days later (Bracco's SOXL entry on 6/11 came two sessions after the 6/9 low and four
   after the 6/5 flush). Our app buys the climax close.
3. **What a close below the lower band means.** Bollinger: "initially continuation signals". Bracco: a breach "is
   typically short-lived, often foreshadowing a counter-trend snap back move" (The Parabolic Short). The owner on TQQQ:
   "Outside completely lower Bollinger band." Our app requires it.
4. **The first target.** Kell: the 20 EMA retest. Kullamägi (short side, mirrored): the 10- and 20-day averages. Bracco
   (short side, mirrored): the 9 EMA. Wyckoff: the automatic rally high.
5. **How long to hold.** Bracco: "not meant to be held longer than 1-3 days" (2025-10-19); the owner: "a solid 2-3 day
   bounce opportunity" (2026-03-29). Kullamägi: bounces of 50-100% "in a few days". Bracco's SOXL trade ran longer: in
   from 6/11, a quarter trimmed by 6/21, the rest sold the next trading day (SS 2026-06-28), so about six sessions.
   Wyckoff and the CMT treat a successful test as the start of a longer position.
6. **Which volume.** Wyckoff and the CMT: climactic volume. Bracco: rising volume on each leg and heavy 5-minute volume.
   Our app: a record over about a year, or 2x average rising across three down days.
7. **Stop.** Kell: just below the Reversal Extension bar's low. Bracco: under the day's low (49 under a 49.81 entry). Our
   app: the climax day's low, measured from the close, which is often a fraction of a percent away (section 5).

---

## 4. Measured evidence

No source I read publishes a success rate for the capitulation long as UCT or our app defines it. What exists is
nearby. Every number below names who measured it.

### 4.1 Bulkowski: the dead-cat bounce (an event pattern after a one-day collapse)

Source: "Dead-Cat Bounce", thepatternsite.com/dcb.html, Thomas Bulkowski, "Updated and added 10 examples on 7/29/25".
**The site states a notice against AI use:** "This website, in whole or in part, shall not be used to train artificial
intelligence (AI) systems, technologies," I read it for research and cite it with a link and short quotes. Direct
requests were refused (HTTP 406), so the quotes are as a fetch tool returned them. (Added in checking:) the finishing
pass re-read both Bulkowski pages through the fetch tool and through a request that named itself as a research check
(a bare request still got 406); the quotes below match the page text word for word.
- **Event.** "Price usually gaps downward, closing 15% to 70% lower than the prior day."
- **Next day.** "Forty-six percent make a lower low the next day, 17% continue lower the next day, then 9%, and then 3%,
  respectively." "From the event day to the trend low averages 7 days."
- **The bounce.** "The average bounce height from event low to bounce high is 28% and takes 23 days."
- **Then.** "Once the bounce completes, price resumes declining, averaging 30% from the bounce high to post-bounce low in
  49 days." "This places price an average of 18% below the event low 67% of the time."
- **Bigger drops bounce more.** Losses above the median 28% (measured "from the close the day before the event to the
  trend low") "had bounces averaging 35% in 25 days." "Those below the median bounced 22% and took 20 days."
- **His own trading tip (added in checking).** "Swing traders can buy near the event trend low and ride price upward until
  it peaks in the bounce phase." And: "Only try this if the event day decline is a large one, say over 30%." The page
  says nothing about stops.
- **Limits.** One-day news collapses, not multi-day cascades. "The numbers cited in this article are based on hundreds of
  perfect trades." (The page italicises "perfect"; an earlier copy here carried that as underscores.) No date range is given. It measures from the event low, which no trader buys exactly. It supports
  two points: buying the first close is early (nearly half make a lower low the next day), and the bounce is a trade, not
  a bottom (most fall to new lows later).

### 4.2 Bulkowski: buying in Stage 4 (his own trades)

Source: his page on the four stages of price movement, thepatternsite.com/Stages.html (its "As of" line changes; it read
"As of 11/09/2026" when checked, so it does not date the study). Same AI notice; same fetch-tool caveat.
- Method: "I logged 440 buys and 444 sales from April 1987 until February 2010."
- Result: "For example, 69.3% of the stage 1 buys were profitable while just 24.41% of those stocks bought in stage 4 made
  money." His table: Stage 4 buys averaged -8.3% over 127 trades, 24.4% of them profitable.
- Limits: one trader's discretionary trades, stages assigned by him, no split for capitulation buys, ends 2010. It is the
  measured reason behind the house rule against longs below the 200-day (B26), which a capitulation long often breaks.

### 4.3 Academic studies of short-term reversals (portfolio level, not a chart setup)

All read as NBER working-paper abstracts, 2026-11-09. I did not read the full papers.
- **Lehmann (NBER w2533, 1988).** Weekly losers and winners reverse: "systematic tendencies for current 'winners' and
  'losers' in one week to experience sizeable return reversals over the subsequent week".
- **Campbell, Grossman and Wang (NBER w4193, 1992).** On daily index returns, the abstract says their model implies that
  "a stock price decline on a high-volume day is more likely than a stock price decline on a low-volume day to be
  associated with an increase in the expected stock return." The paper's finding is that return autocorrelations decline
  with volume. This is published support for heavy volume on the drop as a bullish sign, at the index level.
- **Llorente, Michaely, Saar and Wang (NBER w8312, 2001).** For single stocks it depends on why people sold: "returns
  generated by risk-sharing trades tend to reverse themselves while returns generated by speculative trades tend to
  continue themselves." So a high-volume drop driven by real news (informed selling) may keep going.
- **Nagel (NBER w17653, 2011).** Reversal returns are a pay for providing liquidity, and they are "strongly time-varying
  and highly predictable with the VIX index." "Expected returns and conditional Sharpe Ratios increase enormously along
  with the VIX during times of financial market turmoil".
- **Limits.** Portfolios of many stocks, before trading costs, mostly older samples, no stops. They support the logic
  (forced selling on volume, high VIX) but they do not test a stop-based trade.

### 4.4 Our app's own evidence

- `registry.py` says the second set of trader-setup scanners, capitulation included, was "Lab-measured and independently
  blind-adjudicated", with "86-92% precision" in the next comment line. That is recognition: judges agreed the charts it found look like the setup. It is
  not a profit test.
- `tag_textbook.py` records a blind judging score of 2.89 for the capitulation member tag (round 2; the pass mark is a
  pooled 2.4). Again recognition, not outcome.
- I found no outcome study of the capitulation scanner in the repo.

### 4.5 My own exploratory check (not a published statistic)

I ran the app's own detector, unchanged (`uct_capitulation.evaluate` with the production liquidity floor), over Yahoo
Finance adjusted daily bars (downloaded with yfinance on 2026-11-09) for 97 liquid US stocks and ETFs, 2010-01 to
2026-11-06. The list was large and popular names plus 3x ETFs (for example AAPL, NVDA, TSLA, MU, INTC, COIN, MSTR, SPY,
QQQ, SMH, TQQQ, SOXL). Fires on the same ticker within a few sessions were counted once.
- **Where it fires.** 208 fire clusters on 74 tickers. **72% were below the 200-day SMA** (88% of the 4- and 5-star
  ones). The close-to-low distance (the app's stop) had a median of 1.2%.
- **Entry A, the app's plan (buy the climax close, stop at its low).** 197 cases with 10 sessions of follow-up. Median
  stop 1.3%. **49% traded below the climax low on the very next session**; 79% within 10 sessions. 2R was reached before
  the stop in 32%. With a simple exit (stop = -1R, take 2R, else sell at the 10th close) the average was **+0.10R**, the
  median -1R. The 9 EMA sat a median 8.6R above the entry and was reached before the stop only 11% of the time.
- **Entry B (buy a break of the climax day's high within 3 sessions; stop at the lowest low since the climax).** 87
  cases. Median stop **7.4%**, only 15% within 3%. Average **-0.16R** with the same exit.
- **Entry C (undercut and reclaim: within 3 sessions a session opens below the climax low and trades back up to it; buy
  at the climax low, stop at that session's low).** 67 cases. Median stop **3.4%** (42% within 3%). 2R before the stop in
  39%. Average **+0.35R**. The 9 EMA sat a median 2.7R above the entry and the 20 EMA 4.0R; the 9 EMA was reached before
  the stop in 34%.
- **A looser rule loses the edge.** I also tried a broad "burst down" rule (2+ down closes, the low 2 ATR under the prior
  close, 1.5x volume, 3 of 5 mirrored burst boxes). It fired 1,485 times; Entry A averaged about 0R and Entry C +0.18R.
  Selectivity matters: the stricter app rule did better.
- **Against doing nothing.** Over the same tickers, the average 10-session return of any day was +1.13% (every 5th day
  sampled, 58,779 days). The app's fires averaged -0.3% over 10 sessions close to close, and +1.4% over 5 sessions
  (base +0.58%). The bounce, where it comes, is short.
- **Limits, and they are large.** The tickers were picked in 2026, so most are survivors and winners. The samples are
  small (67 cases for Entry C). Daily bars cannot show the order of prices inside a day; when a stop and a target fell on
  the same bar I counted the stop. No costs or slippage. Fires cluster in a few years (2015: 33, 2025: 21, 2020: 20), so
  the cases are not independent. 3x ETFs decay. This is not the owner's discretionary trade, which is entered intraday.
  Treat it as a reason to ask questions, not as a rule.
- **Checker's notes on Entry C (added in checking).** The numbers above were reproduced exactly by independently written
  code (208 clusters on 74 tickers, 72%, 49%, +0.10R, 87 and -0.16R, 67 and +0.35R, 2.7R and 4.0R). Two limits the
  writer did not state: (1) the test counted only sessions that OPEN below the flush low; a session that opens above it,
  dips under and comes back was not tested, although 8.2 proposes it. (2) The stop was the whole entry session's low and
  the path started the next day, but daily bars cannot show whether that low came before or after the reclaim. In 45% of
  the 67 cases the entry session closed back under the flush low (the entry price), so some of those trades may have
  been stopped the same day under a real stop set a few cents under the low so far. This flatters Entry C; read its
  +0.35R as optimistic. (Finishing pass: the study was run a third time from the saved bars and gives the same numbers.)

---

## 5. Our app

### 5.1 What the scanner tests (`api/services/pattern_engine/detectors/uct/uct_capitulation.py`)

Shared helpers are in `uct_setups_common.py`. ATR is the 14-day simple average of true range; the band is the 20-day
lower Bollinger band at 2 standard deviations (population formula); "50-day" is the 50-day SMA of closes.

**A setup day** (`setup_day`) fires on session *d* when all of these hold:
- **C1, the stretch:** the close is more than 1 ATR (ATR of day *d*) below the lower band.
- **C2, the range:** the day's range is at least 2 ATR (ATR of the prior day), or the low is at least 2 ATR under the
  prior close.
- **C7, the cascade:** the three sessions before it fell at least 1.5 ATR (close of *d*-4 minus close of *d*-1). The
  code note says blind judges rejected "one-day shocks out of nowhere".
- **And at least one fuel test:** C3, accelerating losses (three down closes, each loss larger than the one before); or
  C4 hard, record volume (at least the highest of the prior 252 sessions, judged only with 190 or more prior sessions);
  or C4 soft, volume at least 2x the 50-day average (the average to the prior day), three down closes, and volume rising
  across those three days (the second day above the first, the third above the second).
- **Veto:** a 5-session volume slope that is falling blocks it, unless the volume is a record.

**A gap below** (`gap_below`) fires on the session after a setup day when it opens below that day's low.

**Labels only (never a reason to fire):** "three_day_drop_from_trend" (the close is more than 15% under the close three
sessions earlier, which was above its 50-day; the constant is named `CAP_JERSACE_DROP`, apparently after Jersace, a
UCT team trader (`api/services/desk_team_seed.py`); the repo does not record the rule's origin), and "loose_stretch" (the low under the band, with either a
wide range or a close 4 ATR or more under the 50-day). **Stars, 0 to 5:** C1, C2, (C3 or record volume), two or more open
down-gaps in the last 10 sessions, and 4 ATR or more under the 50-day.

**Levels:** entry = the close; stop = the session low; targets at 2R and 3R (`make_levels`). If the close is the low, the
stop is moved to 0.5% under the entry. **Filters:** price at least $2 and 20-day average dollar volume at least $10,000
(`liquidity_floor`). A fire is reported for up to 3 sessions while its low holds, and only if its confidence score is 50
or more (`CONFIDENCE_FLOOR`; it can drop a 0-star `gap_below` fire on low volume in a weak context). **Who sees it:** the scanner is
internal (`INTERNAL_PATTERN_IDS`). Members see a "Capitulation" tag in the chart's Setups list (flag
`AUTO_STRUCTURES_SETUP_TAGS_ENABLED`, on since 2026-10-24) with the text "A wide-range flush that closes far below the
lower Bollinger Band after a multi-day slide." That tag is shown only when `tag_textbook.capitulation_r2` also holds: a
red candle, a range of 2 ATR or more, volume at least 2x the 50-day average, a close below the band, a prior close at
least 10% under the highest close of the prior 14 sessions with 5 or more down closes in the 8 sessions before, and a
prior close at least 15% under the highest close 2 to 25 sessions back, set 5 or more sessions before the prior day.
The tag also needs at least 260 bars before the session it names (the module's docstring), and members see only bullish
rows.

### 5.2 What the Model Book and the journal say

- **Model Book setup cards** (`app/src/pages/modelbook/setupCatalog.js`): **no Capitulation card.** The nearest card,
  "Parabolic Long", reads: "Riding the steepening curve of a runaway move" and "managed bar by bar as the angle goes
  vertical." That is a momentum ride, not a capitulation buy, and it contradicts both Kullamägi and the owner's ruling
  that a parabolic long is the mirror of Bracco's burst (rulebook B26). Dossier 18 already flagged this card.
- **Model Book Bottoms view** (`bottomsCatalog.js`): "Capitulation" is signpost 1 of a market bottom: "Climactic,
  high-volume selling" and "Capitulation is the market running out of sellers, not the market finding buyers." It is about
  the index, not a stock trade. Its dated examples (nine market bottoms, from "The 1974 Secular Low" to "The 2022 Rate
  Bear") are market days.
- **Journal tags** (`app/src/constants/setupGroups.js`): Swing has "Parabolic Long"; Intraday has "Mean Reversion L/S".
  There is no "Capitulation" tag.
- **Study bank:** the scanner's examples drill skill `scan.volume_climax`; the chip reads "VOLUME CLIMAX" while the
  question asks whether "the firm's Capitulation setup" fires (`docs/study/RESUME.md`, noted as the owner's call). The
  2026-10-21 audit noted that "'Capitulation' is not a setup in the firm's setup catalog".

### 5.3 Where the app disagrees with the sources or looks wrong

1. **It misses UCT's own examples.** I ran it on the trades and ideas UCT named (section 6.4). It fired on none of the
   single stocks or sector and 3x ETFs: FIGR, SNDK, SOXL, KORU, IGV, ETHA, ETHU, CAR, TQQQ, UAMY, USAR, ABAT, FFTY, AGQ,
   OKLO, PLTR, and GBTC (Kullamägi's example). It caught only SPY and QQQ on 2025-04-04 and 2025-04-07. In every miss, C1
   failed: the close was not more than 1 ATR under the lower band. In fast flushes the ATR balloons and the band lags, so
   a leader can fall 30% to 50% in two days without closing that far outside it.
2. **It lives below the 200-day.** In my check 72% of its fires were below the 200-day SMA (section 4.5). UCT's named
   stock examples were mostly far above it (SNDK +222%, SOXL +166%, ABAT +133%, UAMY +223%, PLTR +88%). The rulebook
   forbids longs below the 200-day unless "parabolic long" (B26, a hard rule). As built, the scanner mostly finds trades
   the rulebook bans, and misses the ones UCT takes.
3. **Its entry fights the sources.** It buys the climax close with the stop at the climax low. Its own narrative says
   traders "usually wait for the turn rather than catching the bar". Bulkowski: 46% of collapses make a lower low the next
   day. My check: 49% of fires traded under the low the next session. Every source that trades it (Breitstein, Kullamägi,
   Bracco, Mitchum) waits for an intraday turn.
4. **Its stop is often too tight to mean anything.** When the climax closes at its low, `make_levels` moves the stop to
   0.5% under the entry. KORU (2026-06-05) closed at its low. The app's own AAPL 2023-08-04 fixture closed 7 cents above its low: the
   scanner returns entry 181.99, stop 181.92, and 2R and 3R targets at 182.13 and 182.20, 14 and 21 cents away. A stop
   that is a small fraction of the ATR is a coin toss.
5. **Its targets are not the sources' targets.** 2R and 3R from a tiny stop sit far below the 9 EMA, 10-day or 20 EMA
   that the sources name (median 8.6R to the 9 EMA in my check). With an entry on the turn, the 9 EMA sits near 3R, which
   lines up with the house first trim (section 7).
6. **The gap-below variant can borrow its cascade.** `gap_below` accepts yesterday's flush if *today's* cascade test
   passes, and today's test looks back over yesterday's drop. It also skips the falling-volume veto for yesterday. The
   2026-10-21 audit cut the NFLX 2024-04-22 example for this: it "fires only through the gap_below variant on a
   0-of-5-star day", contradicting the NFLX 2024-04-19 negative.
7. **Bollinger's own rule 8.** A close outside the band is "initially" a continuation signal. The scanner treats a close
   far outside it as the setup. Waiting for the turn answers this; buying the close does not.
8. **The liquidity floor is far below the house rule.** $2 and $10,000 a day versus the rulebook's $10 and $20 million a
   day (B23).
9. **The record-volume test sees less than a year in production.** The common module notes that production's scan
   passes 200 bars, so "the lookback actually seen there is 199", not 252. The detector reports the lookback it used.
10. **Daily bars only.** UCT's trades (FIGR at 49.81, SNDK) were intraday turns. A daily scanner can flag the day; it
    cannot see the turn. That is fine for a watchlist, not for an entry.
11. **Naming.** Three names for one thing: "Capitulation" (tag), "VOLUME CLIMAX" (Study chip), and "Parabolic Long"
    (journal and Model Book). The owner should pick one (question 1).

---

## 6. UCT's own words

All Substack links are on https://unchartedterritoryy.substack.com. "SS" = Sunday Scans; "RotW" = The Rest of the Week.

### 6.1 Bracco: the setup, defined by his trades

- **What it is for.** "This is the ATR mean-reversion long setup I use to get exposure to powerful, trending leaders"
  (SS 2026-01-18, [link](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1)).
- **The checklist (FIGR, 2026-01-12).** "A Cascading sell off (parabolic curve)"; "Increasing volume on each leg lower";
  "Extreme 244% ATR move"; "600% above avg 5-minute volume"; "Retesting the prior all-time high"; "$50 psychological
  level" (same post).
- **The entry and stop.** "I initiated after it washed out the $50 psych level and previous ATH peak on the highest volume
  of the day. Entry around 49.81, stop at 49." (same post)
- **The plan after.** "Scaled out a few partials on the initial bounce and held a core piece to swing". "My original plan
  was to trail the 20EMA and look for re-add spots." He sold the rest early for 14% and called it a "Brutal mental
  mistake" (same post).
- **The same trade, written the next day.** "Got long at 49.81 yesterday on the classic mean reversion setup. Cascading
  sell off with volume increasing on each intraday leg lower." And: "It was also U&R of the previous all time high.
  Risked 80 cents and covered some on the bounce." (RotW 2026-01-14,
  [link](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305))
- **SNDK, two days earlier.** "It hit over -200% ATR move at the lows of the day and held right at S3 (support pivot). It
  also undercut the 5 day SMA." And: "SNDK was the lesson, FIGR was the exam." (SS 2026-01-18)
- **Rubber bands after a parabolic top.** "In some cases, stocks that set up for a parabolic short and blow off at the
  highs can actually turn into parabolic/mean reversion longs in just a couple of days." On UAMY, USAR and ABAT: "If these
  see a signifigant gap down Monday I think it can set the stage for a quick snap back rally of 30-50%." And: "These are
  short lived trades and not meant to be held longer than 1-3 days. Mean reversion play." (SS 2025-10-19,
  [link](https://unchartedterritoryy.substack.com/p/sunday-scans-6cc))
- **Moving-average undercuts.** "The big theme early-mid last week was some rubber band / mean reversion longs on some
  short term oversold momentum leaders" and "These all staged MAU&R’s (moving average undercut and rallies) with most
  closing strong on Friday." (SS 2025-10-26, [link](https://unchartedterritoryy.substack.com/p/sunday-scans-13e))
- **ETH, a 5-star.** "With parabolic mean reversions being my specialty, this was a 5-star trade opportunity,
  specifically on ETH." And: "it is uncommon to see downside continuation immediately following a liquidation and panic of
  that magnitude." (SS 2025-10-12, [link](https://unchartedterritoryy.substack.com/p/sunday-scans-296))
- **ETH again.** "Think potential rubber band / capitulation long setup here for a short term trade opportunity." The
  evidence he gave: "ETHU (Ethereum 2x ETF) traded its highest volume ever while ETHA traded its 2nd highest volume ever."
  He wanted more: "Any sort of bigger move lower to sub 3k on ETH and sub 100k on BTC will be in play for a capitulation
  long." (RotW 2025-11-05, [link](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9))
- **IGV.** "IGV traded it highest volume in its 26-year history today on its 6th consecutive down day and 4th consecutive
  down weak." And: "We have range and volume expansion as the ETF nears a huge 2+ year support area." (RotW 2026-02-04,
  [link](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-732))
- **SOXL and KORU.** "SOXL down -36% in just 2 days and worth watching for a mean reversion long next week. Notable range
  and volume expansion on Friday. Ideal situation is a gap down or further weakness before the turn." (SS 2026-06-07,
  [link](https://unchartedterritoryy.substack.com/p/sunday-scans-d16)) Two weeks later: "following the capitulation low on
  6/9", "I trimmed 25% of my position for a 40% gain from $202 entry on 6/11", and "I have moved my stop in profit to
  last weeks low" (SS 2026-06-21, [link](https://unchartedterritoryy.substack.com/p/sunday-scans-bc0)). (Added in
  checking:) a week later: "reiterated my conviction on my SOXL long from 6/11. The following day I quickly pivoted my
  stance and decided to close out my remaining exposure" (SS 2026-06-28,
  [link](https://unchartedterritoryy.substack.com/p/sunday-scans-ae1)). In the 6/7 post he also wrote: "Felt like
  classic capitulatory action in the semi's all day Friday".
- **CAR, too early.** "CAR - After falling -77% in 3 days this may be setting up for a parabolic long trade at some point
  in the next 1-2 weeks I would imagine." And: "Huge volume capitulation on Thursday." (SS 2026-04-26,
  [link](https://unchartedterritoryy.substack.com/p/sunday-scans-f2d))
- **Leaders near a bottom.** "They are very oversold from short term MA’s, down multiple weeks/days in a row and are
  seeing an increase in daily volume." (SS 2025-11-16, [link](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a))

### 6.2 Bracco: the index version, and when it is not a setup

- **The stretch, in ATRs from the 50-day.** "intermediate corrections will typically find a tradable bottom around an
  average of -3 ATR’s below the 50-day." And: "During major corrections or crashes such as Covid, 2022 bear market, or the
  Tariff Crash, this reading can hit -5 or lower." (SS 2026-03-22,
  [link](https://unchartedterritoryy.substack.com/p/sunday-scans-cab))
- **What he looks for.** "Whenever I am looking for a potential mean reversion turning point out of a downtrend, I really
  try to focus on a few characteristics. First will be range and volume expansion." (same post)
- **The gap.** "The most ideal scenario would be a significant gap down over the weekend, ideally 1 full ATR or more on
  the indexes." (same post)
- **The undercut.** The market "typically like to undercut big support areas before reclaiming (if they do)." (same post)
- **The "Monday Effect".** "We also have what I call the “Monday Effect” going for us, where through my studies notable
  capitulations and turns have occurred on a Monday". His list: March 23 2020, "March 24 2022 - January 2022 Bottom",
  August 5 2024, April 7 2025 (same post). **Check:** 2022-03-24 was a Thursday; the January 2022 low was Monday
  2022-01-24. The other three dates are Mondays. The list likely has a typo; see question 12.
- **Breadth.** On the T2108 (percent of stocks above their 40-day average): "the T2108 has only broken lower than the 15%
  floor once in the last 3 years, during the April 2025 crash." (same post)
- **The VIX.** "Anytime we get a fast move up into 30 it is usually a good time to start paying attention for a mean
  reversion opportunity." (SS 2026-03-08, [link](https://unchartedterritoryy.substack.com/p/sunday-scans-dcf))
- **When it is not a setup.** "There has been really no fear/panic in the tape, just a very choppy, controlled mark down
  for the last few weeks." And the S&P was "not nearly stretched down enough for a high quality reversal trade." (same
  post) Also: "I personally did not view Friday as a good opportunity to try bounce/mean reversion long plays. Was only
  second day down in a row as well as first day breaking down below a 3-month support level." (SS 2026-11-01,
  [link](https://unchartedterritoryy.substack.com/p/sunday-scans-669))
- **A model he names.** February 2022: "we had a downside trending market, a very elevated VIX in the 30’s, Nasdaq -20%
  off highs, and 5 down days in a row leading into the attack. Perfect setup for a capitulatory event and mean reversion
  trade opportunity." (SS 2026-03-01, [link](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8)) On Yahoo data,
  QQQ closed lower five days running (2022-02-16 to 02-23) and was 18.4% under its closing high on 2022-02-23 (my check).
- **Hard to trade.** "Given that I excel in trading the market turns, especially the upside reversals around fear and
  panic". And: "I was in and out of SOXL KORU SNDK multiple times on Wednesday, just to get whipped around". And: "That was
  hands down one of the most difficult mean reversion turns i've traded from a technical perspective" (SS 2026-08-02,
  [link](https://unchartedterritoryy.substack.com/p/sunday-scans-cd2)).
- **The parabolic short, mirrored.** "There are various types of mean reversion trades" (The Parabolic Short,
  2025-06-13, [link](https://unchartedterritoryy.substack.com/p/the-parabolic-short)). On Bollinger bands in that post: a
  breach "is typically short-lived, often foreshadowing a counter-trend snap back move". His ATR multiple above the 50-day
  (a column in that post's extension table) is "an indicator inspired by @jfsrevg and @RealSimpleAriel on X". (Added in
  checking:) his execution rule for the short, which mirrors to the long as a VWAP reclaim: "I will never take an entry
  until the stock at least breaks below the intraday VWAP". His own rule on losers: "I never add when I am down" (SS
  2026-01-25, [link](https://unchartedterritoryy.substack.com/p/sunday-scans-7fb)).
- **Chat, from the KB extract.** "Technically you don’t buy the reversal extension, it’s more of a indication than a
  setup" (KB 15731, 2024-03-13). "most traders are not as good at that and woudl rather buy the wedge pop into a new
  uptrend versus the oversold bounce" (KB 12095, 2025-12-01). Other KB entries (ids 11061, 10873, 11993, 15165, 15332,
  12124, 12403) are tool-written summaries of his posts about oversold bounces, rubber-band longs and index capitulation
  lows; they are not his words and I quote nothing from them. They come from the private archive; whether any of it may
  go into the public course is question 11.

### 6.3 The owner (TSDR)

- **TQQQ, the index rubber band.** "Extended below 5SMA, 9EMA, 20EMA, 50SMA. Outside completely lower Bollinger band. Not
  bottom calling, but stretched and a very viable reversion trade opportunity here." And: "Right now I see a solid 2-3 day
  bounce opportunity". In the same post: "Generally, below the 200SMA no participation is best." And on META: "Probably
  stupid, but there is an edge in significant asymmetric mean reversions. Bracco is skilled at them." (SS 2026-03-29,
  [link](https://unchartedterritoryy.substack.com/p/sunday-scans-352))
- **Waiting for Bracco's washout.** "Like Bracco’s write up and waiting for that washout upside trade to come." And:
  "Bracco laid out the case above and TQQQ is the go to for these type of extension plays." (SS 2026-03-22,
  [link](https://unchartedterritoryy.substack.com/p/sunday-scans-cab))
- **What he looks for now.** "I will look for capitulation, extension, or higher lows." (SS 2026-11-01)
- **His latest stance.** "Some of the best traders I know often suggest 0 activity below the 200SMA." And: "I will gladly
  try some Reversal Extensions, Upside Reversals, Relative Strength names as they pullback and give me a good spot." And:
  "Trading Reversal Extension on AI names. Both are hard given the market environment. I would honestly recommend
  neither" (SS 2026-11-08, [link](https://unchartedterritoryy.substack.com/p/sunday-scans-70f)).
- **Unsigned notes in the same posts.** "At this point we are waiting for capitulation, Follow Through Day, and Webby’s
  Checklist to signal active participation again." (index notes, SS 2026-11-08) "My first thing I look for to add exposure
  or participation is an Upside Reversal or Reversal Extension." And: "we do not know if it is a reversal extension until
  after the fact and until we get a wedge pop." (intro, SS 2026-04-05,
  [link](https://unchartedterritoryy.substack.com/p/sunday-scans-356))

### 6.4 UCT's named examples, measured

My computation from Yahoo Finance adjusted daily bars (yfinance, read 2026-11-09). ATR under prior close = (prior close
minus the day's low) / ATR(14) of the prior day, which is my reading of Bracco's "% ATR move" (FIGR: 2.7 here, 244% in
his post; SNDK: 1.8 here, "over -200%" in his; close but not exact, so his ATR length or anchor may differ). "App" = did
`uct_capitulation` fire within 3 sessions either side.

| Example (who named it) | vs 200-day | ATR under prior close | Volume vs 50-day | App | What followed (from the flush close) |
|---|---|---|---|---|---|
| FIGR 2026-01-12 (Bracco, traded) | n/a (IPO 2025-09) | 2.7 | 2.7x | no | low held; +49% best high in 5 sessions |
| SNDK 2026-01-08 (Bracco) | +222% | 1.8 | 1.8x | no | low held; +27% in 5, +52% in 10 sessions |
| SOXL 2026-06-05 (Bracco) | +166% | 2.8 | 1.5x | no | closed near its low; undercut on session 2 (the 6/9 low); +65% best in 10 |
| KORU 2026-06-05 (Bracco) | +85% | 3.1 | 2.8x | no | closed at its low; undercut 3% on session 2; +82% best in 10 |
| IGV 2026-02-03 (Bracco) | -20% | 2.1 | 4.4x | no | gapped under the low next day; best +2% in 10 sessions |
| ETHU 2025-10-10 (Bracco) | +25% | 2.0 | 2.3x | no | low broken on session 2 (-13%); -9% after 5 sessions. Bracco bought "around $100 in after hours", below this regular-session low of 112.61, which daily bars do not show |
| CAR 2026-04-23 (Bracco, "1-2 weeks") | +45% | 2.3 | 7.0x | no | low broken next day; -25% under it within 5 sessions |
| TQQQ 2026-03-27 (owner) | -21% | 1.1 | 1.2x | no | low broken next day (lowest 3% under it within 5); +31% best in 10 sessions |
| ABAT 2025-10-17 (Bracco) | +133% | 0.6 | 2.0x | no | low held; +45% in 5 sessions (price under $10, fails B23) |
| QQQ 2025-04-07 (Bracco, Monday) | -14% | 1.6 | 3.9x | yes (gap_below) | low held; +10% in 5 sessions |
| QQQ 2024-08-05 (Bracco, Monday) | +2% | 2.3 | 2.6x | no | low held; +11% best in 10 sessions |
| INTC 2024-08-02 (app fixture) | -44% | 7.3 | 6.2x | yes, 5 stars | gapped under the low next day; never above the flush close in 10 sessions |
| MU 2025-04-04 (app fixture) | -36% | 2.2 | 2.3x | yes, 4 stars | low broken next day (lowest 3.6% under it within 5); +21% best in 5 sessions |
| COIN 2026-02-05 (app fixture) | -50% | 2.2 | 3.3x | yes, 5 stars | +15% best in 5; low broken on session 5 |

Lessons from the table: the winners were mostly leaders above the 200-day, or indexes, flushed for 1 to 3 days on
heavy volume; the stock or ETF often undercut the flush low once before it turned (SOXL, KORU, TQQQ, MU); and buying the
first close was often early: 9 of these 14 traded under the flush low within 5 sessions.

---

## 7. How it fits the account rulebook (section 9)

| Rule | Fit | Note |
|---|---|---|
| B26 no longs below the 200-day SMA unless a parabolic long (hard) | **Conflict, unless Capitulation = Parabolic Long** | 72% of the app's fires are below the 200-day. Bracco's stock examples are mostly above it; the index and ETF ideas (the owner's TQQQ, Bracco's IGV, QQQ on 2025-04-07) were below it. If the course teaches Capitulation as the house Parabolic Long (the mirror of Bracco's burst), the exception covers it. If not, every below-200 capitulation is banned. Question 1. |
| B26 definition of parabolic (Bracco's burst, mirrored) | Fits as a gate | Mirror: three straight down days, two consecutive gap downs, two of three days of range expansion, two days of rising volume, a gap down on the climax day. In the rulebook's words, "the more boxes checked, the stronger." |
| A3 and F62 stop a few cents under the day's low | Fits | The sources stop under the flush low or the turn day's low. |
| A13 stops usually within about 3% | **Tension** | Entry on the close: 1.3% median, but half are hit the next day. Entry on the undercut and reclaim: 3.4% median, 42% within 3%. Entry on a break of the climax high: 7.4%. 3x ETFs run wider. A13 is a guideline; A3 says size from the stop or skip. |
| A5 size from the stop, capped at 40% (A7) | Fits | A wide stop means fewer shares, not more risk. |
| E57 market orders | Fits | Kullamägi and Bracco enter on intraday breaks. |
| C28 no chasing more than 4% past the buy point | Fits, and matters | After a reclaim, price can run 5-10% in minutes. |
| C29 skip a long more than 10% above the 10-day | Not relevant | The setup is far below the 10-day. |
| C31 RS 80+ | Exempt | "unless parabolic or mean reversion". Bracco prefers leaders anyway ("powerful, trending leaders"). |
| B23 $10 and $20 million a day | Applies | Some UCT examples fail it (ABAT at $4.85). The app's floor is $2 and $10,000. |
| D42 never more than 1% of average daily volume | Applies | Bracco on KORU: "Not the best liquidity there and spreads can be awful sometimes". |
| E54 leveraged ETFs preferred | Fits well | UCT's index capitulations are traded through TQQQ, SOXL, KORU, ETHU, AGQ. |
| B19, E51 trims: a third at 3R, a third at 5R; breakeven at 2R-5R | Fits with a turn entry | With the undercut-and-reclaim entry, the 9 EMA sat a median 2.7R away and the 20 EMA 4.0R (section 4.5). With the close entry it sat 8.6R away. |
| E52 trail under the 10-day or 21-day | **Needs an adaptation** | At entry the 10-day is far above the price and falling. Until price closes back above it, the trail has to be the higher daily lows. |
| C33 time stop: under 1R after 10 days, sell | **Tension** | UCT holds these 1-3 days (Bracco 2025-10-19; the owner's "2-3 day bounce"). Question 6. |
| C35 swing, days to weeks | Fits the short end | Bracco held SOXL for weeks after it worked. |
| B18, F65, D46 market filter: Orange only A+; Red mostly cash and shorts | **Tension** | Capitulations happen in Orange and Red markets by nature. Question 7. |
| B20 gap through the stop: first 30-minute low is the new stop; out past 2R | Applies | Volatility after a climax makes gaps likely. |
| B21 re-entry only on a new trigger; E56 3 tries a week, 6 a month | Applies, and matters | Bracco was "in and out of SOXL KORU SNDK multiple times" in one day. |
| B22 no new buys in the 3 days before earnings | Applies | A capitulation after a report is fine; buying into one is not. |
| D38, E49 size by grade | Applies | Bracco takes size only on a 5-star; Kell warns to size for volatility. |
| D47 shorts are long setups reversed | Mirror exists | The short mirror is the Parabolic Short (Bracco's post), already a house setup. |

---

## 8. Proposed rules for our course

These rules describe one setup with two settings: **(A) the leader flush**, a stock that was a strong leader (usually
above its 200-day) collapsing for 1 to 3 days, and **(B) the index or sector washout**, traded through an index or
leveraged ETF. The deep-downtrend climax that our scanner finds today is (C), taught as watch, do not buy, unless it
also passes the parabolic-long gate. Every number marked [my proposal] is a starting point for the owner to change.

### 8.1 What it is (all measurable on a daily chart, with the turn read intraday)

- **The burst (gate).** At least 3 of these 5, the house parabolic-long mirror: (1) 3 or more straight lower closes;
  (2) 2 consecutive opening gaps down; (3) on 2 of the last 3 days a bigger percent loss than the day before; (4) volume
  higher on each of the last 2 days; (5) a gap down on the climax day or the next morning. [house rule: B26 mirror;
  UCT: Bracco's checklist "not every criteria needs to be fully satisfied"]
- **The flush day.** The day's low at least 2 ATR(14) under the prior close (Bracco's "% ATR move"; his examples 200% and
  244%) [UCT; my reading of his metric], or a range of at least 2 ATR [app C2].
- **Volume.** Flush-day volume at least 2x the 50-day average [my proposal; app soft rule], and ideally the highest of
  the decline or of the year [UCT: IGV, ETHU; app C4]. A decline on falling volume does not qualify [app veto; Stockbee:
  "Low intensity selling is more in line with correction"].
- **The stretch.** One of: (A) a fall of at least 15% (stocks) or 30% (3x ETFs) from the highest close of the last 10
  sessions [my proposal, from UCT's examples: SOXL -36% in 2 days (Bracco's figure; -35% close to close on Yahoo bars),
  KORU -50% (Bracco's figure; -49%), IGV -19% from its highest close of the prior 15 sessions but only -14% from the
  prior 10, so a sector ETF may need the longer window; Kullamägi's 50-60% is for small caps after a parabolic run];
  (B) for an index, a close at least 3 ATR under the 50-day SMA [UCT:
  Bracco's "-3 ATR's" for intermediate corrections, -5 in crashes].
- **Location.** Into a level that matters: a prior all-time high or breakout level, a round number, the 200-day or
  50-week average, an anchored VWAP from a major low, or an old gap [UCT: FIGR, SNDK, IGV, ETHA; Kell: "Extensions on a
  daily chart should see support on a weekly chart"].
- **Averages.** Price below the 5-day, 9 EMA and 20 EMA [UCT: the owner on TQQQ]. A close below the lower band is
  supporting evidence only, never the trigger [originator: Bollinger rules 6 and 8].
- **Not a one-day shock out of nowhere.** At least 2 lower closes before the flush day [app C7 and the lab's blind
  judges; UCT: Bracco skipped a "second day down" breakdown].
- **Liquidity.** Price at least $10 and at least $20 million traded a day [house rule B23]; never more than 1% of average
  daily volume [house rule D42].

### 8.2 The buy

- **Do not buy the falling price or the flush close.** [source consensus: Breitstein, Kullamägi, Bracco, Mitchum, Kell,
  the CMT; my check: 49% of closes were undercut the next session]
- **Trigger, intraday (recommended for members who can watch):** after the flush low is in, buy the first of: a reclaim of
  VWAP, a break of the opening range high, or a break of the prior 5-minute bar's high once a higher low has formed;
  market order [originator: Kullamägi's "opening range highs or the first green 5-minute candle"; Breitstein's right side
  of the V; UCT: Bracco's FIGR entry; house rule E57].
- **Trigger, daily (recommended as the taught default, because it can be checked on a chart):** the undercut and reclaim.
  Within 3 sessions after the flush day, a session trades below the flush low and then back above it. Buy at the reclaim
  of the flush low [my proposal, from Bracco's "undercut and rally", the house Oops Reversal and Wyckoff's spring; my check:
  Entry C, +0.35R on 67 cases, a small and biased sample]. If the flush day itself undercuts a big level and closes back
  above it (FIGR, SNDK), the same day counts.
- **Options, and my recommendation.** (a) the close (the app today): tight stop, frequent stop-outs, weak results; (b) a
  break of the flush high: much wider stop, weak results; (c) the undercut and reclaim: the best of the three in my check,
  stops near 3%. **Recommend (c) on the daily and the intraday turn for those who can watch.**
- **No chasing.** Not more than 4% above the trigger price [house rule C28].

### 8.3 The stop

- A few cents under the low of the session you bought in (that is the undercut low for entry (c)) [house rules A3, F62;
  originator: Kell, "just below the low"].
- If that is more than about 3% away, cut the shares so the risk stays the same, or skip [house rules A3, A13].
- A gap through the stop: the first 30-minute low is the new stop; out if the loss passes 2R [house rule B20].

### 8.4 Trims and trail

- **First trim:** a third at 3R [house rule B19]. With the reclaim entry this is near the 9 EMA, the first mean-reversion
  target [UCT: Bracco's parabolic-short target mirrored; my check: 9 EMA at a median 2.7R].
- **Second trim:** a third at 5R [house rule E51], near the 20 EMA [originator: Kell's "retest of the 20 EMA"; Kullamägi's
  10- and 20-day target mirrored].
- **Breakeven:** at 2R [house rule B19, the low end, because these bounces fade: Bulkowski's dead-cat data].
- **Trail the rest:** under each higher daily low until price closes back above the 10-day; after that, sell on a close
  below the 10-day [house rule E52 adapted; UCT: Bracco moved his SOXL stop to "last weeks low"; my proposal for the
  adaptation].
- **Time stop:** if 1R is not reached within 3 sessions, sell [UCT: "1-3 days", "2-3 day bounce"; my proposal]. The
  rulebook's 10-day time stop (C33) is the fallback if the owner keeps one rule for all setups (question 6).

### 8.5 What invalidates it

- A trade below the low of the entry session (the stop) [originator: Kell, "Stops are placed just below the low of the
  Reversal Extension bar"; Wyckoff school: a test below the climax low means "new lows or prolonged consolidation"; the
  app's narrative. The CMT page gives no stop, so it is not counted].
- The bounce stalls on the first day and closes in its lower third [app narrative: "A bounce that stalls immediately and
  closes weak is the early warning"].
- The index makes a new low on rising volume while you hold [my proposal].
- No burst: a slow grind or a "controlled mark down" [UCT: Bracco 2026-03-08].
- A real business break (fraud, guidance collapse) where the selling is informed [academic: Llorente et al.,
  speculative trades "tend to continue"; my proposal to teach it].

### 8.6 The short mirror

The mirror is the **Parabolic Short**, already a house setup (Bracco's post; rulebook D47 and B26). No new short setup
is needed. Note that both live on the "wrong" side of the 200-day rule and are covered by the parabolic exceptions.

### 8.7 Best market conditions

- Fear is high and rising fast: a VIX spike toward 30 or more [UCT: Bracco 2026-03-08; academic: Nagel].
- Breadth washed out: T2108 near or under 15-20% [UCT: Bracco 2026-03-22, his "15% floor" and a 16.74% close; Stockbee
  agrees that breadth extremes mark seller capitulation but uses his own count (stocks up 25% in 65 days under 200),
  not T2108].
- Several straight down days into a Friday, then a gap down on Monday [UCT: Bracco's "Monday Effect"].
- For the leader flush: the index holding up or itself stretched [UCT: Bracco 2025-10-26, leaders flushing while "the
  Nasdaq contracting and building higher lows"].
- Not: a calm, orderly decline; not the first day of a breakdown [UCT: Bracco 2026-03-08 and 2026-11-01].

### 8.8 Common mistakes

- Buying the knife before the turn [source consensus].
- Averaging down [UCT: "I never add when I am down"].
- Calling a slow decline a capitulation [UCT; Stockbee].
- Buying the first day of a breakdown [UCT: Bracco 2026-11-01].
- Holding a bounce as if it were a new uptrend [Bulkowski: most dead-cat bounces fall to new lows; UCT: "1-3 days"].
- Too big: the stop is wide in dollars and gaps happen [originator: Kell on size; house rules A5, B20].
- Whipsaw re-entries in one day [UCT: Bracco 2026-08-02; house rule E56].
- Treating a close outside the lower band as a buy signal [originator: Bollinger].
- Breaking B26: a below-200 capitulation that does not pass the burst gate [house rule].

### 8.9 Ten model examples to study (for the owner to approve)

Facts from Yahoo daily bars (section 6.4). Good models: **FIGR 2026-01-12** (leader, intraday undercut of the prior
all-time high and $50; Bracco traded it); **SNDK 2026-01-08** (leader, -200% ATR move, held a pivot); **SOXL
2026-06-05 to 06-09** (3x ETF, -36% in 2 days, undercut on 6/9, Bracco's 6/11 entry); **KORU 2026-06-05** (3x ETF, -50% in
2 days; liquidity warning); **ABAT 2025-10-17** (rubber band after a parabolic top; fails B23 on price, so a teaching
example only); **QQQ 2025-04-04 to 04-07** (index, Monday gap and reclaim; the app caught it); **QQQ 2024-08-05** (index,
Monday); **TQQQ 2026-03-27** (the owner's idea; undercut next day, +31% best in 10 sessions); **MU 2025-04-04** (the app's
fixture; below the 200-day, so a B26 test case); **AMZN 2026-02-06** (the app's fixture; a weak bounce).
Counter-examples: **CAR 2026-04-23** (Bracco said wait 1-2 weeks; it fell 25% more), **IGV 2026-02-03** (gap under the
low, no bounce), **INTC 2024-08-02** (5 stars, never recovered the flush close), **ETHU 2025-10-10** (low broken on
session 2).

---

## 9. Grading: A+ versus B-

The owner ruled that grading is discretionary (E50), so this list is evidence for his judgment, not a checklist.

**A+ (Bracco's "5-star"):**
- All 5 burst boxes, with at least 3 straight down days and a gap down on the day [house rule B26 mirror].
- Record or decline-high volume; 5-minute volume many times normal [UCT: FIGR "600% above avg 5-minute volume"].
- A low 2 ATR or more under the prior close [UCT: FIGR, SNDK].
- Into a big level, ideally two (prior high plus round number) [UCT: FIGR].
- A real leader with a story [UCT: "powerful, trending leaders"; FIGR, SNDK].
- Market-wide fear at the same time: VIX spiking, breadth washed out, Monday gap [UCT; Nagel].
- A clean undercut and reclaim with a stop near 3% [my check].

**A or B:** 3 or 4 burst boxes; heavy but not record volume; a level nearby; the index neutral.

**B- or lower (size down or skip, E49):**
- Only 1 or 2 down days, or a one-day shock with no cascade [app C7; UCT: Bracco 2026-11-01].
- Volume only modestly heavy, or falling [app veto; tag_textbook "volume only modestly heavy"].
- No level under it.
- A slow, controlled decline [UCT: Bracco 2026-03-08].
- Deep in Stage 4 below a falling 200-day with no burst [Bulkowski stage data; house rule B26].
- A stop that must be wider than 5% to make sense [house rule A13].

---

## 10. Questions for the owner

1. **Is Capitulation the same setup as Parabolic Long?** (a) Yes: one setup, called Capitulation (Parabolic Long),
   gated by the mirrored burst, so the B26 exception applies (recommended); (b) separate: Capitulation is allowed only
   above the 200-day; (c) separate, with its own written exception to B26.
2. **Which settings do we teach?** (a) leader flush and index washout (recommended); (b) also the deep-downtrend climax
   the scanner finds now; (c) index washout only.
3. **Entry.** (a) undercut and reclaim on the daily, plus the intraday turn (recommended); (b) intraday turn only; (c)
   the close, as the app does now.
4. **Stop.** (a) under the entry session's low (recommended); (b) under the flush low; and (c) may a 3x ETF trade use a
   wider stop than about 3% if the size is cut to keep the risk the same?
5. **Trims.** (a) the house 3R and 5R (recommended; they land near the 9 and 20 EMAs with the reclaim entry); (b) sell into
   the 9 EMA and the 20 EMA regardless of R.
6. **Time stop.** (a) 3 sessions to reach 1R (recommended, matches "1-3 days"); (b) the house 10 days (C33).
7. **Market filter.** Capitulations happen in Orange and Red markets. (a) allow A+ capitulations in Orange and Red as an
   explicit exception; (b) Orange only, A+ only (F65 as written); (c) never in Red.
8. **Risk.** (a) B- risk (0.25-0.5%) by default, 1-1.5% only for a 5-star; (b) the normal grade table.
9. **The scanner.** (a) rebuild it around the burst gate and the reclaim entry, add the leader setting above the 200-day,
   raise the floor to $10 and $20 million (recommended); (b) relax C1 (the 1-ATR-below-band test) only; (c) leave it as an
   internal watchlist and fix only the entry and stop.
10. **Names, card and tag.** Add a Model Book "Capitulation" card; rewrite the "Parabolic Long" card's text; add a
    journal tag "Capitulation" or keep "Parabolic Long"; and rename the Study chip "VOLUME CLIMAX"?
11. **Private archive.** May summaries of Bracco's Discord posts (KB 11061, 10873, 11993 and others) be used in the public
    course, or only his Substack and chat words already in the repo?
12. **Bracco's Monday list.** His "March 24 2022" is a Thursday; the January 2022 low was Monday January 24. Confirm the
    date with Bracco before we teach the list.
13. **The model examples in 8.9.** Approve, swap or add.

---

## 11. Sources

All read on 2026-11-09.

| # | Source | Publisher, author | Date | Reliability |
|---|---|---|---|---|
| 1 | "The Wyckoff Method: A Tutorial", https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial | StockCharts ChartSchool; Roman Bogomazov and Michael Lipsett | "Last updated 2 years ago" | Established educator; the Wyckoff school's standard text. Not Wyckoff's own words. |
| 2 | "Wyckoff Method", https://www.wyckoffanalytics.com/wyckoff-method/ | Wyckoff Analytics (same text as 1) | not shown | Same as 1. |
| 3 | "Reversal Bar Patterns Part 3: Buying and Selling Climaxes", https://www.interactivebrokers.com/campus/?p=193900 | CMT Association, on IBKR Campus | 2023-07-25 | Established educator (CMT curriculum). Qualitative. |
| 4 | "Reversal Extension: How Stocks Bottom", https://web.archive.org/web/20250820211726/https://traderlion.com/technical-analysis/chart-patterns/reversal-extension-how-stocks-bottom/ | TraderLion, bylined Oliver Kell | 2024-06-11 | Originator. Read as an archive copy (dossier 18: the live page refuses requests). |
| 5 | "3 TIMELESS setups that have made me TENS OF MILLIONS!", https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Kristjan Kullamägi | 2021-01-08, updated 2021-04-28 | Originator. |
| 6 | "BOLLINGER BANDS RULES", https://www.bollingerbands.com/bollinger-band-rules | John Bollinger | not dated | Originator of the indicator. |
| 7 | X post, https://x.com/TheOneLanceB/status/1508815079541776397 | Lance Breitstein | 2022-03-29 | Originator; first post of a 4-part thread; parts 2-4 not read. Text read via X's public embed service. |
| 8 | Chat With Traders 228, https://chatwithtraders.com/228 ; 236, https://chatwithtraders.com/236 | Chat With Traders; guest Lance Breitstein | 2022-02-09; 2022-06-27 | Show notes only; I did not hear the episodes. |
| 9 | "Trading The Frontside vs The Backside", https://baytrading.substack.com/p/trading-the-frontside-vs-the-backside | Baytrading; Austin Mitchum | 2025-04-22 | Secondary (Breitstein's mentee); free part only. |
| 10 | Stockbee blog search "capitulation", https://stockbee.blogspot.com/search?q=capitulation (posts of 2006-07-13, 2007-08-16, 2011-09-23, 2012-05-31) | Pradeep Bonde | as listed | Originator of his breadth tools; market-level only. |
| 11 | "Dead-Cat Bounce", https://www.thepatternsite.com/dcb.html | Thomas Bulkowski | updated 2025-07-29 | Measured. **States a notice against AI training.** Bare requests refused (406); read through a fetch tool and, in the finishing check, a self-identified research request. |
| 12 | Four stages of price movement (stages page), https://www.thepatternsite.com/Stages.html | Thomas Bulkowski | the "As of" line is the site's live date (11/09/2026 when checked); the study ends February 2010 | Measured (his own trades). **Same AI notice.** Read the same way as 11. |
| 13 | "Fads, Martingales, and Market Efficiency", https://www.nber.org/papers/w2533 | NBER; Bruce N. Lehmann | 1988 | Peer-reviewed line of work; abstract only. |
| 14 | "Trading Volume and Serial Correlation in Stock Returns", https://www.nber.org/papers/w4193 | NBER; John Y. Campbell, Sanford J. Grossman, Jiang Wang | 1992 | As 13; abstract only. |
| 15 | "Dynamic Volume-Return Relation of Individual Stocks", https://www.nber.org/papers/w8312 | NBER; Guillermo Llorente, Roni Michaely, Gideon Saar, Jiang Wang | 2001 | As 13; abstract only. |
| 16 | "Evaporating Liquidity", https://www.nber.org/papers/w17653 | NBER; Stefan Nagel | 2011 | As 13; abstract only. |
| 17 | UCT Substack, Sunday Scans and The Rest of the Week (sitemap: https://unchartedterritoryy.substack.com/sitemap.xml; all 103 posts read and searched; posts quoted are linked in section 6) | Uncharted Territory; Bracco and the owner (TSDR) by section | 2025-06-01 to 2026-11-08 (the sitemap's 103 posts, re-fetched in the finishing check) | UCT's own words. Section authorship as explained at the top. |
| 22 | "Reversal Bar Patterns Part 3: Buying and Selling Climaxes" on TradingView (CMT_Association account), found by search in the finishing check; the same text as 3 | CMT Association | 2023 | Confirms the "(also on TradingView)" note in 3.2; not read separately. |
| 18 | "The Parabolic Short", https://unchartedterritoryy.substack.com/p/the-parabolic-short | Uncharted Territory; Bracco | 2025-06-13 | UCT; the owner's B26 reference. |
| 19 | Brain KB extract, `docs/study/levels/brain_kb_cycle_2026-11-06.json` and `brain_kb_rules_2026-11-06.json` | this repo | 2026-11-06 | Chat words where marked; other text is tool-written summary. From a private archive (question 11). |
| 20 | App code: `uct_capitulation.py`, `uct_setups_common.py`, `primitives/liquidity.py`, `registry.py`, `setup_tags.py`, `tag_textbook.py`; `setupCatalog.js`, `bottomsCatalog.js`, `setupGroups.js`; `docs/study/audits/2026-10-21/auditC_verdicts.jsonl`; `docs/study/RESUME.md`; `docs/study/sizing_rule.md` section 9; `docs/study/TRADE_PLANS.md`; `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | this repo | as of 2026-11-09 | Primary for what the app does. TRADE_PLANS.md has no capitulation row; the owner's verdicts have no capitulation ruling beyond B26 and C31. |
| 21 | Yahoo Finance daily bars via yfinance (adjusted), 2010-01 to 2026-11-06 | Yahoo | downloaded 2026-11-09 | Free data; adjusted prices can differ from what traded. Used only for my own check (4.5) and the example table (6.4). |

**Not read (search budget or access):** William O'Neil and IBD on selling climaxes and bottoms; Brian Shannon on
anchoring VWAP to capitulation lows; Linda Raschke; Larry Connors' oversold studies (the repo file
`docs/superpowers/research/setups/setup_criteria.json` quotes Connors, but I did not verify those quotes); Investopedia
(could not be fetched); TraderLion's article on Breitstein (403); Breitstein's own capitulation checklist.

---

## 12. Examples (from our data)

Scanned 2026-11-09 with `scan_cap.py` (scratch folder `_study-resume/scratchpad/setups/34-capitulation/`), charts in its
`final/` folder (`01_ICE_2009-07-10.png` ... `10_AEM_2026-02-02.png`, phone sheets `sheet_1-4.png`, `sheet_5-7.png`,
`sheet_8-10.png`, the picked hits in `examples.json`, every hit in `hits.json`). Daily bars from the local sandbox
(read-only), 2,630 names that ever met the liquidity rule, 2000-01-05 to 2026-11-06, every name scanned (109 seconds,
no budget cut).

**The rule the scan used (section 8, setting A, the daily trigger (c)).** A flush day is a session with at least 3 of
the 5 burst signs of 8.1 (3 straight lower closes; 2 consecutive opening gaps under the prior low; a bigger percent
loss than the day before on 2 of the last 3 days; volume higher on each of the last 2 days; a gap down that day or the
next morning), whose low is at least 2 ATR(14) under the prior close or whose range is at least 2 ATR, on volume at
least 2x the 50-day average, with the low at least 15% under the highest close of the prior 10 sessions, the close
under the 5-day SMA, 9 EMA and 20 EMA, at least 2 straight lower closes (not a one-day shock), price at least $10 and
50-day dollar volume at least $20 million (B23). The trigger: within the next 3 sessions a session trades under the
flush low and closes back above it; the market-order buy is the reclaim of the flush low (flush low + $0.01, E57);
the stop is 5 cents under the undercut low (A3, F62); stops wider than 5% were dropped; one trade per flush and no
re-entry for 10 sessions. 3R and 5R are measured from that fixed stop over the next 60 sessions, with no trims, no
breakeven move and no trail, so "reached 3R" means the first bounce carried 3 risk units before the stop was touched.
The 4% chase limit (C28) did not need modelling: all 10 examples undercut and reclaimed inside one session, so the
reclaim price was there to be bought. The scan did not model the intraday trigger of 8.2, the location rule of 8.1
(a level under the flush), the 3-session time stop, or the 1%-of-volume size cap.

**Base rate.** 2,220 hits. 52.3% reached 3R and 43.1% reached 5R before the stop; 81% were stopped at some point in
the 60 sessions (the stop never moves, so the fade after the bounce usually comes back to it). Split by the 200-day
rule (B26): 410 hits with the reclaim close above the 200-day SMA (the setting (A) leader flush the course teaches):
57.8% to 3R, 48.8% to 5R, median best 4.8R; 1,810 hits below the 200-day (the deep-downtrend climax (C), which B26
forbids as a long unless the parabolic gate passes): 51.0% to 3R, 41.8% to 5R. Above the 200-day with a stop of 3% or
less (A13): 315 hits, 63.5% to 3R, 54.6% to 5R. A same-session undercut and reclaim (240 hits) did a little better
than a reclaim 2 or 3 sessions after the flush (170 hits): 59.6% against 55.3% to 3R. Caveats: the median stop is
1.7%, so 3R is about a 5% bounce and 5R about 9%, and the rate measures the first bounce, not a trend trade; of the
346 above-200-day hits that have earnings dates, 150 (43%) had an earnings report inside the flush window, so those
"flushes" are earnings reactions, not panic selling, and the course should keep them apart (none of the 10 examples has
a report in its window; TSLA 2014-05-08 and TTWO 2018-02-08 were dropped from the first pick for that reason, and
ALNY 2017-09-07 because its flush was a single-day shock on 8x volume out of a flat base and the gain came from a gap
8 sessions later, not from the reclaim). The last hits of 2026 have fewer than 60 forward sessions. These are fixed-stop
numbers with no trims; the house trade (a third at 3R, a third at 5R, breakeven at 2R, trail under the 10-day) was not
simulated.

**The 10 examples.** "Lower closes" counts straight lower closes into and including the flush day. "Drop" is the flush
low against the highest close of the prior 10 sessions. "ATR" is how far the flush low sat under the prior close in
ATR(14) units. Stops are 5 cents under the undercut low. Best R is the highest high in the 60 sessions after entry,
in units of the fixed risk. All 10 reclaim closes are above the 200-day SMA.

| # | Ticker | Flush day | Lower closes | Drop | ATR | Volume | Burst | Reclaim day | Buy | Stop (risk) | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | ICE | 2009-07-08 | 2 | -29.3% | 2.66x | 4.96x | 3/5 | 2009-07-10 (2 sessions later; undercut 16.60, close 16.94) | 16.75 | 16.55 (1.2%) | 17.0 | A leader two weeks off its high loses 29% in three sessions on 5x volume, the biggest bar on the chart; the second session after the flush undercuts the low and closes back above it. 3R on day 1, +9.4R at the 10th close. |
| 2 | ALB | 2010-05-06 | 3 | -17.2% | 3.94x | 3.12x | 4/5 | 2010-05-07 (undercut 38.31, close 39.23) | 38.49 | 38.26 (0.6%) | 22.5 | The index washout of 2010-05-06 (the flash-crash session) in a leader in an uptrend above a rising 200-day: three lower closes, a 4-ATR spike low, next day an undercut of that low that closes above it. Teaches the tiny-stop case: 5R is only +3% above the buy. |
| 3 | SBUX | 2011-08-08 | 3 | -15.7% | 2.06x | 2.51x | 3/5 | 2011-08-09 (undercut 16.86, close 18.02) | 17.03 | 16.81 (1.3%) | 21.3 | The August 2011 market crash: three straight lower closes, the flush closing on its low, then the next session undercuts and closes 6% higher, back above the 200-day. Teaches the retest: the low was tested again on 2011-08-19 without touching the stop. |
| 4 | ROKU | 2019-03-13 | 2 | -18.9% | 2.37x | 2.82x | 3/5 | 2019-03-14 (undercut 59.63, close 61.82) | 60.14 | 59.58 (0.9%) | 19.9 | A parabolic leader (30 to 70 in 10 weeks) flushes 19% in two sessions to its 21-day EMA and reclaims the next day. 3R on day 1; the stock traded 73% higher inside 60 sessions. |
| 5 | ACMR | 2020-09-08 | 3 | -40.3% | 4.38x | 3.73x | 3/5 | 2020-09-09 (undercut 19.34, close 20.03) | 19.49 | 19.29 (1.0%) | 65.8 | The widest flush in the set: 40% off the 10-day high close in three sessions, the low 4.4 ATR under the prior close, into the June-July base. Reclaimed the next day; +15.6R at the 10th close. Thin name ($39M a day), so size is capped by D42. |
| 6 | LYV | 2022-03-07 | 3 | -20.8% | 2.41x | 2.25x | 3/5 | 2022-03-08 (undercut 98.01, close 106.01) | 99.87 | 97.96 (1.9%) | 11.2 | The early-March 2022 market washout: three lower closes into the round number 100 and the 200-day, then an undercut that closes 6% higher. 3R on day 1. The cleanest "into a level" example. |
| 7 | ALGM | 2023-04-27 | 7 | -22.2% | 2.24x | 3.73x | 3/5 | 2023-04-28 (undercut 34.19, close 35.77) | 35.06 | 34.14 (2.6%) | 19.6 | The model of the burst: seven straight lower closes that accelerate into a climax bar on the highest volume of the decline, 12% above the 200-day. Reclaimed the next day; 3R came on day 3, the slowest of the ten, and the stock traded 51% higher inside 60 sessions. |
| 8 | HIMS | 2024-10-30 | 2 | -21.0% | 2.40x | 2.84x | 3/5 | 2024-10-31 (undercut 18.32, close 18.83) | 18.64 | 18.27 (2.0%) | 44.3 | A leader breaks its 21-day EMA with a 21% two-session flush to the top of the September base and the rising 50-day, then undercuts and closes back above the low. 3R on day 1; +88% inside 60 sessions. |
| 9 | OKTA | 2025-04-04 | 2 | -23.4% | 2.67x | 2.28x | 4/5 | 2025-04-07 (Monday; opened 88.34 under the flush low, undercut 87.93, closed 91.24) | 89.37 | 87.88 (1.7%) | 25.6 | The tariff crash of April 2025 and Bracco's "Monday Effect" on a leader 4% above its 200-day: Thursday and Friday flush 23%, Monday gaps under the flush low and closes above it. Same shape as the dossier's QQQ 2025-04-04 to 04-07. |
| 10 | AEM | 2026-01-30 | 2 | -15.5% | 3.22x | 2.84x | 3/5 | 2026-02-02 (Monday; undercut 187.04, close 190.82) | 188.53 | 186.99 (0.8%) | 43.3 | A leader 28% above its 200-day flushes 15% in two sessions to its 21-day EMA, the low 3.2 ATR under the prior close; Monday undercuts and reclaims. 3R on day 1, +15.9R at the 10th close, and the stock ran 35% in the next 60 sessions. |

**Notable failures (all above the 200-day, all stopped on the first session after entry).**

- **COP 2022-06-22.** The energy washout of June 2022: a 24% flush on 2022-06-17 (2.0 ATR, 3.3x volume, burst 3/5),
  reclaimed on the second session (2022-06-22: the market was closed on 2022-06-20 for Juneteenth) at 92.82 with the
  stop at 91.41. The next session traded through the stop; the stock fell to 78.30 inside 30 sessions, 16% under the
  buy. The warning signs were a sector still breaking and a first bounce day that opened 93.75 and closed 87.89 in its
  lower tenth, not a late reclaim; the stop did its job (corrected 2026-11-10 against the bars): the earlier text counted the reclaim as the third
  session.
- **WDC 2024-07-29.** A 16% flush on 2024-07-25 (burst 4/5), reclaimed on the second session at 50.20 with a 0.65% stop
  at 49.87. Stopped the next day, then 39.89 inside 30 sessions (-20%). The first bounce never got going: the reclaim
  session opened 4% up and closed at 50.21, two cents over the flush low, the stall-and-weak-close warning of 8.5.
- **DLTR 2022-05-19.** The whipsaw: a 23% flush on 2022-05-18 with the low 5.7 ATR under the prior close on 4.1x volume
  (burst 4/5), reclaimed the next day at 128.03, stop 125.69 (1.8%). The following session traded both under the stop
  and up to 136.19 (the scan counts the stop first), and the stock closed at 159.88 ten sessions later, 25% above the
  buy. A 1.8% stop under a 5.7-ATR bar is the "cut the shares or skip" case of 8.3; the intraday turn of 8.2 is the
  entry that would have survived it.

---

## 13. Removed in checking

Nothing was removed outright: every quote (330 strings of three words or more), every attribution, every statistic
and every app claim was confirmed at its source in the finishing check. What was corrected in place:

- Bulkowski's "hundreds of _perfect_ trades" is "hundreds of perfect trades" on the page (the word is italicised; the
  underscores were a fetch-tool artefact). Fixed in 4.1.
- Source 12's "As of 11/06/2026" was the site's live date on the day the writer read it, not a date for the study; the
  table now says so (the study itself ends February 2010).
- The Model Book Bottoms view's dated examples run from the 1974 low to the 2022 bear (`bottomsCatalog.js`), not "1974
  to 2020". Fixed in 5.2.
- Source 17's date range: the sitemap's earliest post is 2025-06-01, not 2025-06-13.
- 8.1 "IGV -20% in 15 sessions": on the saved Yahoo bars IGV's 2026-02-03 close was 19% under its highest close of the
  prior 15 sessions and 14% under the prior 10; the line now gives both so the proposed 10-session window is tested
  honestly against it. SOXL and KORU figures are marked as Bracco's own, with the Yahoo check beside them.
- 8.5 first bullet carried a [source consensus] tag resting on Wyckoff, "the CMT" and the app; the CMT page gives no
  stop, so the tag now names Kell (who does), the Wyckoff school and the app narrative.
- 8.7 breadth bullet cited "Stockbee's Market Monitor" as an originator for a T2108 threshold; Stockbee's published
  number is his own count (stocks up 25% in 65 days, "Readings below 200"), so the tag now says what each source
  actually gives.
- A checker's paraphrase in 4.5 ("few cents under the low so far") was in quotation marks although it is nobody's
  quote; the marks are gone.
- Added: Mitchum's claim that Breitstein "coined" the right side of the V (3.6); confirmation that the CMT article is
  also published on TradingView (3.2, source 22); the result of the finishing pass's search for Breitstein's own
  capitulation criteria (none found in his words, 3.6).

---

## 14. Failures and near-misses (from our data)

Built 2026-11-10 from the same `final/hits.json` as section 12 (`charts.py`, `near_scan.py` in the scratch folder
`_study-resume/scratchpad/setups/34-capitulation/`). The four failures are hits that passed every gate of the criteria
card (above the 200-day, no report inside the flush window, stop 3% or under) and were stopped before 3R; the four
near-misses come from `near_scan.py`, which re-runs the section 12 rule with one gate relaxed at a time and keeps only
the hits the strict rule rejects for that one criterion (the 200-day near-miss is a below-200 hit from `hits.json`).
Charts: `final/fail_1.png` to `fail_4.png` (sheet `fail_1-4.png`), `final/near_1.png` to `near_4.png` (sheet
`near_1-4.png`), and the confusable pair `final/pair_38-parabolic-long.png` (ALGM 2023-04-28 above BABA 2022-03-15).
Buy, stop, 3R and 5R are drawn exactly as on the winners. All numbers are read off the daily bars.

**Failures (every gate passed, stopped before 3R).**

| # | Ticker | Flush, reclaim | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | BN | 2020-03-09, 2020-03-10 | 19.57 | 19.40 (0.89%) | day 1, 2020-03-11, low 18.98 | -16.5% off the 10-day high, 3.29 ATR, 3.03x volume, burst 5/5; the index made a new low the same week and the stock traded 11.55 inside 30 sessions, 41% under the buy. The crash had one more leg. | cap.inv_index_new_low |
| 2 | COP | 2022-06-17, 2022-06-22 | 92.82 | 91.41 (1.52%) | day 1, 2022-06-23, low 87.26 | the reclaim came on the second session (the market was closed on 2022-06-20, Juneteenth) (corrected 2026-11-10 against the bars); day 1 opened 93.75 and closed 87.89 in its lower tenth, through the stop; 78.30 inside 30 sessions. | cap.inv_stall |
| 3 | VOYA | 2023-03-13, 2023-03-15 | 64.66 | 63.75 (1.41%) | day 1, 2023-03-16, low 63.52 | the bank-panic flush, burst 5/5; day 1 traded 23 cents under the stop and closed 66.15 near its high; 70.12 ten sessions later, 8.4% above the buy. A whipsaw: the stop was right by the rule and the trade still lost. | cap.stop |
| 4 | MP | 2025-04-04, 2025-04-07 | 22.13 | 21.72 (1.85%) | day 1, 2025-04-08, low 21.57 | day 1 opened 26.00, above the 5R line (24.18), then closed 21.94 in its lower tenth through the stop. With the house rule the two trims are taken at the open and only the last third is stopped; the fixed-stop scan counts the whole trade as a loss. | cap.trim_gap_open |

**Near-misses (one gate fails, everything else passes).**

| # | Ticker | Flush, reclaim | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | MS | 2025-03-04, 2025-03-06 | cap.burst | 2 of 5 boxes (a bigger loss on 2 of 3 days, the gap); the rule needs 3 | a 2.61 ATR drop on 2.02x volume, 15.3% off the 10-day high, into the 200-day, but no burst: a controlled three-week mark down (cap.inv_no_burst). Closer to Mean Reversion form A than to a capitulation; stopped the next day. |
| 2 | AMZN | 2018-03-28, 2018-03-29 | cap.stretch_stock | the flush low 12.9% under the 10-day high close; the rule needs 15% | a 2.95 ATR flush on 2.23x volume with burst 3/5, but only a 13% dip to the rising 50-day in a leader: a pullback, Mean Reversion form A at most. Stopped the next day. |
| 3 | LLY | 2024-07-25, 2024-07-29 | cap.volume | flush-day volume 1.96x the 50-day average; the rule needs 2x | the whole shape is there (2.13 ATR, 15.2% off the high, burst 3/5, above the 200-day) and the volume misses by 2%. The rule says no; Mean Reversion form A (1.5x) would take it. Stopped the next day. |
| 4 | UBER | 2024-12-11, 2024-12-16 | cap.above_200 | the reclaim closed 15.9% under the 200-day SMA (71.67); burst 3/5 does not pass the parabolic-long gate | setting (C), the deep-downtrend climax: 2.19 ATR on 3.48x volume, 17.6% off the high, but in a stock that had been falling for two months. Watch, do not buy (B26). Stopped the next day. |

**What the failures have in common.** All four were stopped on the first session after the buy, and in three of the
four that session closed in its lower tenth (COP, MP) or the index itself made a new low (BN): the bounce has to show
up at once or it is not coming, which is why 8.5 puts the stall-and-weak-close warning first and why a 3-session time
stop costs nothing. Two of the four (BN, MP) were market-wide washouts where the leader was bought before the index
had finished; the one that worked out for a buyer who stayed (VOYA, +8.4% in ten sessions) was taken out by 23 cents,
the price of a stop that sits right under the undercut low. The MP case is the one to teach with the management rule
beside it: the stock opened above 5R the next morning, so the trade is a winner under cap.trim_gap_open and a loss
under a fixed stop. WDC 2024-07-29 (section 12) is no longer counted as a failure: its report came on 2024-07-31,
two sessions after the reclaim, so the buy fails cap.earnings_window and the case belongs with the near-misses.

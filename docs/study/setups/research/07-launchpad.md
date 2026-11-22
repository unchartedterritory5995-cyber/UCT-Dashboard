# Setup 07: Launchpad (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page
or file named next to it and checked word for word against a saved copy (the check script and the copies are in the
session scratchpad, not in the repo). Nothing here is a ruling. Where I could not read a source, I say so and give no
wording from it.

**Cold check, 2026-11-09.** A second reader re-opened every source, re-ran the kept-chart numbers on the same local
bars, and edited this file in place. The biggest changes: TSDR is the owner (the Sunday Scans say "Bracco and I,
Patrick (TSDR Trading)"), so his launchpad posts are his own words; Ross Haber's TraderLion article, listed as unread,
was read (section 3.8) and gives the originators' own stop rule (3% or pass); a 2024 TraderLion post splits the setup
into a "Power of 3" reclaim bar and a "Launch Pad" retest (section 3.7); Deepvue is run by the same people as TraderLion,
so it is not an independent source. Everything removed or corrected is listed at the end.

This file goes deeper than the earlier levels dossier (`docs/study/levels/dossiers/launchpad.md`, entry and stop only)
and the earlier outside notes (`docs/study/levels/external_research.md` section 6). Where they overlap, this file adds
the sources, the app's code, UCT's public posts, and new measurements.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** the named trader's own
words; **[UCT]** UCT's own writers or the owner's verdict log; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

Words used below. **The bundle**: the 8-day EMA, 21-day EMA and 50-day SMA (simple average) when they bunch together.
**EMA / SMA**: exponential / simple moving average. **ATR**: average true range, the stock's typical daily range
(here the 14-day simple average). **R**: the risk on a trade (entry minus stop); 2R is a gain of twice that risk.
**Launch day**: the day the stock closes above every average. **Kept / cut**: the owner's verdicts on the bank's charts
(`docs/study/audits/2026-10-24/owner_verdicts.jsonl`).

---

## 1. What it is

After a real correction, a stock goes sideways for weeks while its 8, 21 and 50-day averages squeeze into one tight
bundle near the 200-day, and price lives under and through that bundle. The launch is the first strong day that closes
above every average, the 200-day included, as the short averages turn up and stack in order.

The owner's own words for it (MSTR, 2023-10-23, his model chart): "Yeah look at all those moving averages chunked up
there, great example on a stock that can move really nicely. Hanging underneath the MAs and then getting above the
launchpad as the MAs stack" (owner_verdicts.jsonl line 72; cut at 34 words, before "and get into trend alignment with
the 9>20>50").

**Why it works (the psychology).** The points below are reasoning, backed where shown by an educator's words. None is a
measured fact; section 4 shows how little the pattern alone adds in the numbers.

- **The squeeze means agreement.** When short and long averages meet, short-term traders and longer-term holders are
  paying about the same price. StockCharts on the Guppy ribbon: "When the shorter-term ribbon converges into the
  longer-term ribbon, this means that both short-term traders and long-term investors are in “agreement” on the value
  of a stock. This also means that there is no trend for the time being."
  ([ChartSchool, Guppy Multiple Moving Average](https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/moving-average-trading-strategies/guppy-multiple-moving-average-an-ma-ribbon-designed-to-tip-the-markets-hand))
  The originator circle says the same in its own words. Ross Haber (TraderLion): "Converging averages mean every
  timeframe of holder — the two-week money, the two-month money, the ten-month money — has arrived at roughly the same
  cost basis, stacked under the stock." (section 3.8)
- **Quiet comes before a move.** ChartSchool on moving average ribbons: "If the ribbon is contracting (the moving average
  lines are getting closer together or even crossing), this can indicate the start of a new trend."
  ([ChartSchool, Moving Average Ribbon](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-average-ribbon))
  John Carter's squeeze rests on the same idea; ChartSchool says it "capitalizes on the tendency for price to break out
  strongly after consolidating in a tight trading range."
  ([ChartSchool, TTM Squeeze](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/ttm-squeeze))
- **Who is buying in the base.** After a correction, the sellers who wanted out are mostly gone and larger buyers can
  build a position without chasing. The Wyckoff school calls this building a cause: "In Phase B, institutions and large
  professional interests are accumulating relatively low-priced inventory in anticipation of the next markup."
  ([ChartSchool, The Wyckoff Method: A Tutorial](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial),
  by Roman Bogomazov and Michael Lipsett)
- **Who is trapped under the bundle.** While price hangs under the averages, people who bought higher sell every rally
  into them to get out near breakeven, and short sellers lean on the falling or flat averages. When a strong day closes
  above all of them, including the 200-day that many funds and screens watch, that overhead selling has been absorbed.
  Shorts who sold the base are now wrong and must buy back, and trend followers who wait for price to clear all the averages
  start to buy. (Reasoning, not a sourced fact.)
- **Why the owner likes the "dangle and retest".** A pullback to the averages after the first push, on light selling,
  shows the old ceiling now acts as a floor. Wyckoff's word for it is the last point of support, "the low point of a
  reaction or pullback after a SOS", and "Backing up to an LPS means a pullback to support that was formerly
  resistance, on diminished spread and volume." (same ChartSchool tutorial; SOS = sign of strength). TraderLion's
  2024 post puts the same idea at the centre of its Launch Pad: "We’re looking for the same moving averages that were
  acting as resistance to now become ones acting as support." (section 3.7)
- **The catch.** Converged averages are common. Our own app's code says so: "on a typical day a meaningful share of
  liquid stocks will show converged averages, so the condition alone says where risk is defined, not that a move is
  imminent" (`uct_launch_pad.py`, narrative text). Section 4.3 measures that point.

---

## 2. Origin and naming

**Who named it.** I could not find who first used the name. The earliest dated public use I found is TraderLion's:
- TraderLion's "TL's Key Moving Averages (KMAs)" indicator on TradingView, first published 18 Jul 2021, offers to
  "Label our unique "LaunchPad" criteria on your daily charts with any shape below the Daily Price Bar."
  ([TradingView](https://www.tradingview.com/script/p2BuMHPo-TL-s-Key-Moving-Averages-KMAs/)). The script is protected,
  so its criteria are not public.
- Ameet Rai's "ZIM MarkUp – 2021 Winners" on TraderLion is dated 8 Dec 2021 and uses the word in passing: "stock builds
  launch pad near $40 spot and goes to new high ground."
  ([traderlion.com](https://traderlion.com/profile/ameet-rai/zim-markup-2021-winners/); the post shows a later
  modification date, 10 Oct 2024, so the 2021 wording cannot be proven.)
- TraderLion's thread of 7 May 2022 (by the TraderLion account, tagging Ross Haber and Richard Moglen) gives the first
  written definition I could read (section 3.6).
- Ameet Rai, "3 Early Entry Techniques To Improve Win Rate", TraderLion, 14 Jul 2024, separates a "Power of 3" reclaim
  bar from the "Launch Pad" retest that follows it (section 3.7).
- *The Trader's Handbook: Winning Habits and Routines of Successful Traders* by Richard Moglen, Nick Schmidt, Ross Haber
  and Ameet Rai (Harriman House, 2025, ISBN 9781804090183; listings disagree on the release date, unresolved) teaches
  it. I did not read the book. TraderLion's own review of it says the book "breaks down patterns like gap-ups, launch
  pads, base breakouts" ([traderlion.com, 21 May 2025](https://traderlion.com/trading-books/the-traders-handbook/)); a
  secondary summary says the book calls it "one of the bread and butter setups of the TraderLion methodology" (section
  3.7).
- Deepvue (a charting and screening platform; the article's byline is "Deepvue") published "The Launch Pad
  Setup" on 21 Sep 2024 and ships "Launch Pad" and "Weekly Launch Pad" chart signals (section 3.9). Deepvue is not
  independent of TraderLion: its About page lists Ameet Rai, Richard Moglen and Ross Haber as co-founders
  ([deepvue.com](https://deepvue.com/?p=1923)), and Haber writes that "Deepvue also built the Launch Pad indicator around
  this exact technique".
- Ross Haber, "Launchpad Setup: How I Find Early Entries", TraderLion, 21 Aug 2026 (modified 1 Oct 2026). Read
  (section 3.8).

So every outside source that defines the setup by name, except the anonymous scripts and The StratLab (which credits
TraderLion), is one circle: TraderLion and the four Handbook authors, three of whom (Rai, Moglen, Haber) are also
Deepvue's co-founders. Treat them as one school, not as independent confirmations of each other.

**At UCT.** The owner's newsletter credits Manrav. In the "Shoutout Section!" of the Sunday Scans, 2 Nov 2025, the
writer (unnamed in that section; the brain's KB 5187 reads it as Manrav "trading since 2022 with Bracco") says of
Manrav: "We have been trading together since 2022", and "If there is a Launchpad, Slingshot, HVC edge, or
Oops Reversal he will be slapping it. These setups I have adopted and use consistently in my trading and the results
have shown." ([Sunday Scans, 2025-11-02](https://unchartedterritoryy.substack.com/p/sunday-scans-b99)). The same
paragraph links Manrav to the TraderLion circle: "He is a student of the market that is cut from the same cloth as
StockBee, Mike Webster, and Ameet Rai." Manrav's own words in the brain's KB name Rai as a teacher ("learnt that from
Ameet Rai", 2024-10-06, KB 11169). That is the likely path of the name into UCT, but no source says so outright. The
brain's KB has Manrav using "launch pad" from at least 15 Apr 2024 (KB 15459, "bearish launch pads" on the indexes; a
summary).

**Who TSDR is.** TSDR is the owner. The Sunday Scans of 23 Nov 2025 open: "Bracco and I, Patrick (TSDR Trading), have
an immense passion for helping traders navigate the market effectively."
([sunday-scans-56d](https://unchartedterritoryy.substack.com/p/sunday-scans-56d)), and every stock quote in section 6.2
sits in the section headed "TSDR’s Weekly Outlook & Watchlist". The other dossiers in this set treat TSDR as the owner
too. So the TSDR lines in sections 3.5, 6.2 and 6.4 are the owner's own public words.

**A wrong attribution to fix.** The study catalogue labels the brain's template "Launchpad (Qullamaggie)"
(`docs/superpowers/research/setups/setup_criteria.json`). I found no support for that. Kristjan Kullamägi's own setups
page lists the breakout, the episodic pivot and the parabolic short; the only "launch" on that page is a reader's
comment ("launching off a flat long base")
([qullamaggie.com](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/)). A search found no
Qullamaggie page that names a launch pad.

**Other names.** "Launch Pad", "LaunchPad", "LP" (Manrav, KB 11726), "Moving Average launchpad" (Sunday Scans),
"Launching Pad" (a 2022 ProRealCode forum thread), "pinched" (a search alias in
`api/services/wisdom/archive/ask_setup.py`) and "pinch" (the `pinch_50_200` label in `uct_launch_pad.py`). The short
version is the "bearish launch pad" (section 8.6). TraderLion's thread files it under "Respect for Key Moving Averages".

**Close cousins (not the same setup).**
- TraderLion's "Power of 3": "the Power of 3 Setup occurs when a stock goes from trading below its 10, 21, and 50-day
  Simple Moving Averages to trading above in a single session." (Rai, 2024, section 3.7; Deepvue's knowledge base has
  a "Power of Three" signal on the 10/21/50 SMAs.) This is very close to the owner's launch bar. In TraderLion's terms
  the owner's launch day is a Power of 3, and their "Launch Pad" is the retest of the averages that follows it.
- Stan Weinstein's Stage 1 base turning into Stage 2. The owner's version (a flat base after a correction, near the
  200-day, then the push above everything) is a daily-chart cousin of Weinstein's transition. Thomas Bulkowski's page
  on Weinstein's stages describes Stage 1 as "the horizontal trading range" where "The moving average flattens out",
  and Stage 2 as price breaking out "on impressive volume" while "The moving average turns up"
  ([thepatternsite.com/Stages.html](https://www.thepatternsite.com/Stages.html); read through a fetch tool, see the
  notice in section 11). Weinstein's own book was not read.
- Oliver Kell's Wedge Pop: the house card says "After the decline ends, price coils into a tightening wedge below the
  averages", then the pop reclaims them (`app/src/pages/modelbook/setupCatalog.js`). Same family, but defined by a wedge
  and the 10/20-day EMAs, not by a bundle near the 200.
- The flat base and the VCP. The owner cut TAN 2022-07-27 as "more of a VCP or flat base breakout" (line 87).
- The base breakout. The owner allows the overlap: "Some of these will crossover with BaseBreakouts btw and that is fine"
  (HON, line 99).

---

## 3. Every definition I could find, source by source

### 3.1 The owner (UCT, the primary source for how we trade it)

The bank lesson, written from his rulings of 2026-10-23/24 (`docs/study/bank/spot.setups.json`, every Launchpad item):
"after a real correction the 8, 21 and 50-day averages chunk up into a tight bundle at or near the 200-day while price
lives UNDER and through the bundle for weeks in a long flat base". It goes on: the price is "dangling and retesting it";
"the launch is the FIRST bar that closes above every average"; the averages stack into 8 > 21 > 50; and "It is the
convergence and the dangle, not a breakout".

His rulings, word for word as the verdict log records them (line numbers). The same words appear in
`docs/study/corrections/spot.fixtures.jsonl` with contractions ("it's", "I'd"), so one of the two logs normalised them;
the meaning is identical.
- Definition: "Yes, playbook version" (2026-10-23, asked whether AAPL 2022-11-23 is a Launchpad;
  `docs/study/corrections/spot.fixtures.jsonl`). The recorded action: Launchpad is the playbook definition (the
  `setupPlaybooks.js` intro, section 3.2: averages converge after a bear market or correction "and the stock can break
  either way", in the log's words) and the full 9 > 20 > 50 > 200 stack is not required. His later rulings (below) are
  all long examples, so whether "either way" still stands is open (question 6).
- Not a breakout bar: the pass-2 record (spot.fixtures.jsonl, 2026-10-24) notes on his "Perfect" WDAY that "the
  trigger bar is still inside the base, so the Launchpad is the convergence and the dangle, not a breakout bar", and
  that "the trigger day need not be a 20-day breakout". (The log's words, written from his rulings, not his own.)
- The picture: MSTR, quoted in section 1 (line 72). "Want you to revisit the MSTR example and try to find ones like
  that." (ADM, line 91). "Nah I think I want them to look more like MSTR than this" (GOOGL, line 84).
- The dangle: "Eh it is good, but I like when they dangle and retest the launchpad a bit if that makes sense" (ADBE,
  line 76). "That is good, again I like the dangle above a bit but this is still good" (GE, line 77). "Pass, I want the
  dangle above the launchpad for a bit" (CAT, line 85).
- Not a breakout: "Eh, it is more of a VCP or flat base breakout so I would say no to launchpad" (TAN, line 87); "Pass,
  more of a breakout vs a launchpad" (MARA, line 88); "Eh this one is more of a breakout, it is not bad but I think we
  can find better" (SONO, line 94); "Eh more of a sudden breakout imo" (JD, line 97); "No it is more of a breakout"
  (MGNI, line 105).
- Above everything: "Nah, I want it above" (WSM, line 106); "I want it above the MAs" (ADSK, line 107). The log's note:
  WSM cleared the bundle but not the 200-day; ADSK closed inside the bundle. On ALLE (kept, good) he pushed back on the
  reviewer's wording: "Good, why do you keep saying 200 overhead" (line 113); the log records no rule from it.
- Universe: "Eh it is good but I would not trade it probably, it is a lame regional bank" (FITB, line 98).
- Quality: "No just ugly chart" (TTC, line 90); "Pass just do not like the look idk" (Z, line 100); "Good enough but I
  would say B-" (F, line 86); "Eh C-" (MGM, line 111).
- Live use: "Hey great I traded this one in my channel that day" (BIDU 2025-08-29, line 80).

What he has not ruled in the review: the entry, the stop, the trims and the trail. His one entry ruling is for the
Kicker: "The entry is supposed to trigger OVER previous day high not at mkt close!" (2026-11-02, verdict log line 336).
But as TSDR he has written about launchpad entries and stops in public (section 3.5): risk against the day's low or the
200-day, a tight stop on an hourly pad, buying the higher low at the pad, and an entry on Monday over Friday's high with
the 20 EMA as the stop (TWLO, 2025-11-30).

### 3.2 UCT Model Book playbook (the firm's document, transcribed 2026-06-12)

`app/src/pages/modelbook/setupPlaybooks.js`, entry 'Launchpad'. The commit that added it (291af0c34c) says it was
"transcribed from the firm's doc" with "citation markers dropped", so the original was a cited write-up; I could not
find that original document.
- What it is: "The consolidation that follows a bear market or correction, when multiple moving averages converge into
  a tight bundle and the stock is coiled to break out in either direction."
- Criteria: "The 8-EMA, 21-EMA, 30-SMA and 50-SMA bunched closely together and stacked in order, with price
  consolidating across them."
- Entry: "Break of the consolidation in the direction of the trend resumption. On the daily, a high-of-base /
  high-of-consolidation break".
- Stop: "below the consolidation low / the MA stack (daily version)."
- Exit: "Trail the short-term moving averages as the new trend develops; scale into strength on reward-to-risk."
- Mistakes: "Forcing the trade before the moving averages have actually converged." and, on direction, "the setup is
  symmetrical and can break long or short; the environment dictates which side to trade."

### 3.3 UCT team playbook row in the brain (compiled, author unclear)

Brain KB 15867, "UCT team playbook: Launch pad (MAs converging under a tight base)", source `setup_knowledge:sk_launch_pad`
(in `docs/study/levels/brain_kb_2026-11-06.json`). It reads like a summary compiled from the traders' notes, not a
document a named person wrote, so I weight it below the traders' own words.
- "Price sits just above converging 8/21/50 moving averages in a tight base while the averages curl up."
- "Averages within about 1 ATR of each other, stacked 8 over 21 over 50 (over 200 for the best grade), the 50 curling
  up, a tight five-day range; daily and weekly launch pads together are strongest."
- "Trigger: Buy inside the pad or on the reclaim of the averages or a high-volume close; from below the 50, start on a
  slingshot and add on the 50 SMA reclaim."
- "Stop: Below the launch pad (the base low) or the low of day; wider below the 50/200 SMAs."
- "Management: Stocks move in 3-5 day bursts; enter at the start of one and trim into it."
- "Invalidation: A close below the 21 EMA/50 SMA cluster. A quick break and reclaim is a fake-out, not a failure."

### 3.4 Manrav (UCT trader; brain KB rows, his Discord posts as summarised there)

- "Daily? I won't call that a launch pad, the EMA's are not tight" (2024-06-28, KB 10985, his words).
- A launch pad is price very close to the 8, 21 and 50, even better with the 200 (2025-08-09, KB 11726; the KB's
  summary, not his words).
- He prefers launch pads close to the 200-day, with a rule of thumb of buying at the 50 SMA and stopping at the 65 EMA
  (2025-12-21, KB 12198, summary). The KB's chart note says the chart he posted for "launch pads close to 200 SMA, the
  one in Aug" was BIDU daily with a launch pad circled in mid/late August: the same BIDU move the owner kept as great
  (2025-08-29, "I traded this one in my channel that day").
- Stop on a break below the launch pad, for a 30-minute pad (2024-05-02, KB 10935, summary).
- Skipped textbook launch pads before earnings (AMGN, KB 10935; QUBT, KB 11344, summary).
- His process: buy launch pads and look for relative strength during corrections; for newer traders, flags first,
  because buying while a stock is basing is hard (2026-08-19, KB 12875, summary).
- Trail: "100% from launch pad, rides 8 and 21 EMAs" (an annotation on his RBLX chart, 2025-09-15, as transcribed in
  KB 13488).

### 3.5 The owner as TSDR, and the Sunday Scans (UCT)

TSDR is the owner (section 2). The Sunday Scans (byline "Uncharted Territory") use the word on daily, weekly and
hourly charts, for longs and for the bearish mirror. Every stock quote below sits in "TSDR’s Weekly Outlook &
Watchlist", so these are his own public words; the QQQ lines in section 6.2 sit in the unsigned ETF/index section.
The full quotes are in section 6. The definitions they imply:
- Averages "stacked tight", risk "against Friday’s low or the 200SMA" (TSLA, 2025-08-24).
- An hourly launchpad "with the 9/20/50 hourly MAs set to be stacked. That is where I will look for my entry and tight
  stop." (ZM, 2026-02-08).
- Buying the higher low at the pad: "Launchpad on the daily and ready to establish a higher low. That is where I want to
  be a buyer personally." (ARM, 2026-09-20).
- His TWLO trade, in his "Current Positions" note of 2025-11-30: "Followed contributors in the group into TWLO on Monday
  over Friday’s high. Stop is 20EMA." ([sunday-scans-422](https://unchartedterritoryy.substack.com/p/sunday-scans-422));
  the same post calls TWLO's weekly chart a "weekly launchpad" (section 6.2). The brain's KB 4827 summarises it with a
  wrong date (2025-11-23). Note the trigger: over the PRIOR session's high (Friday's, bought on Monday), the same shape
  as his Kicker ruling, not "the day after the launch, over the launch day's high". The post does not say which day was
  the launch.
- His sell signal: "I've been testing a 65 minute bearish launch pad 9/20/50 bearish launchpad confirmation on the 65
  min as my sell signal." (2024-10-21, KB 14348, his words).

### 3.6 TraderLion thread, 7 May 2022 (originator circle, primary)

[threadreaderapp.com/thread/1522961878850453505](https://threadreaderapp.com/thread/1522961878850453505.html), a copy of
TraderLion's X thread on the characteristics of a proper base.
- "The Launch Pad Setup occurs when price reclaims important KMAs to the upside on volume."
- The averages: "Price respects the 10DMA, 21EMA, 50DMA, 65EMA, and 200DMA".
- The four steps: "Price trades underneath the KMAs in a base"; "Price reclaims these KMAs to the upside"; "The KMAs
  start to curl underneath price, forming a Launch Pad for higher prices"; "Price retests the KMAs & bounces off of
  them".
- Examples named: COUP (2018), SQ (2020). No numbers for tightness, depth, entry or stop.

This is the closest outside match to the owner's picture: under the averages in a base, back above them, then a retest.

### 3.7 TraderLion indicator (2021), the early-entry post (2024) and The Trader's Handbook (2025)

- The KMA indicator plots "(8DEMA, 10DSMA, 21DSMA, 23DEMA, 50DSMA, 65DEMA, 200DSMA)" and labels "LaunchPad" criteria
  that are not public ([TradingView, 18 Jul 2021](https://www.tradingview.com/script/p2BuMHPo-TL-s-Key-Moving-Averages-KMAs/)).
- **Ameet Rai, "3 Early Entry Techniques To Improve Win Rate", TraderLion, 14 Jul 2024 (modified 10 Oct 2024)**
  ([traderlion.com](https://traderlion.com/trading-strategies/3-early-entry-techniques-to-improve-win-rate/); read
  through TraderLion's public WordPress API, see section 3.8 for why). Originator circle, primary. It teaches the setup
  as two steps:
  - Step 1, the **Power of 3**: "the Power of 3 Setup occurs when a stock goes from trading below its 10, 21, and 50-day
    Simple Moving Averages to trading above in a single session." Traits: "Moving averages should be horizontal as
    price breaks through. Downtrending MAs decrease the probability of success of the setup." and "Volume should be
    increasing as the stock moves through the MAs." Entry as the stock breaks above the consolidation highs; stop under
    the consolidation lows or after several closes under the averages.
  - Step 2, the **Launch Pad**: "Now that we’ve started our position on the Power of 3 Setup, we can look to add even
    more shares using the Launch Pad setup." The idea: "We’re looking for the same moving averages that were acting as
    resistance to now become ones acting as support." Entries: "Enter on multi-day support at a rising MA", "Enter using
    a break above a consolidation high", "Enter using a well-known short-term pattern (Inside Day, for example)". Stop:
    "Stop techniques usually all revolve around the stock breaking below recent lows (preferably within 3-5% of entry
    price) or multi-day closes below the moving averages of interest." And: "You don’t need to have a Power of 3 Setup
    trigger prior to this pattern for it to be valid."
  - Examples named: PUBM and OSCR (Power of 3); BMO, NMRK, UNM (Launch Pad). No statistics.
  - What it means for us: the owner's launch day (a close above every average after weeks under them) is TraderLion's
    Power of 3, and TraderLion's Launch Pad is the retest after it, which is the owner's "dangle and retest". The
    adding of shares is against A5 (no adds).
- FinancialWisdomTV's summary of the Handbook (24 Jul 2025; a secondary site, possibly machine-assisted): "The Launch
  Pad setup, which is one of the bread and butter setups of the TraderLion methodology, forms when all key moving
  averages converge and the stock shapes up within a consolidation." Also: "The moving averages used are typically the
  10-day SMA, 21-day EMA, 50-day SMA, 65-day EMA, and 200-day SMA." and "It’s best when a group as a whole is shaping up
  together and has the potential to lead."
  ([financialwisdomtv.com](https://www.financialwisdomtv.com/post/the-trader-s-handbook-systems-setups-self-mastery-part-1)).
  The book itself was not read; treat these as unconfirmed.

### 3.8 Ross Haber, "Launchpad Setup: How I Find Early Entries" (TraderLion, 21 Aug 2026; originator circle, primary)

[traderlion.com/profile/ross-haber/launchpad-setup](https://traderlion.com/profile/ross-haber/launchpad-setup/),
modified 1 Oct 2026. The web page answers non-browser clients with a bot challenge (HTTP 403), so the checker read the
post's published text through TraderLion's public WordPress API
(`traderlion.com/wp-json/wp/v2/posts?slug=launchpad-setup`, no login, plain client); the owner may prefer to re-read it
in a browser. Haber co-wrote the Handbook and is a Deepvue co-founder (section 2).
- Definition: "a stock's key moving averages converge to the upside in a tight bunch beneath price." Its roots, in his
  words: "it's really a marriage of Stan Weinstein's stage analysis and Bill O'Neil's CANSLIM® methodology."
- Averages: "I run six moving averages on my daily charts: four simples — the 10-day SMA, 21-day SMA, 50-day SMA, and
  200-day SMA — plus the 23 EMA and 65 EMA." He says the four simples are enough.
- His checklist (headings and first lines): "Tight relative to itself. The bunch should be visibly tighter than the
  averages were during the prior decline or base." Beneath price, turning up: "A pile of flat averages above price is a
  ceiling, not a launchpad." Early in the cycle: "A launchpad forming on an early-stage base at the start of a new
  uptrend carries far more weight than one forming after the stock has already doubled." The right personality
  (liquid, orderly names). "Group confirmation. Other high relative strength names in the same group doing the same
  thing."
- What fails: "Wide, loose stocks with huge average daily ranges can form something that looks like a launchpad, but
  it's often a trap". And: "The ones to be careful of form late in a stock's cycle after it's already run, sit beneath
  declining longer-term averages, come in wide and sloppy rather than tight, or show up on loose stocks in groups under
  pressure".
- Entry: the ideal is "the move through the high of the post-earnings consolidation pivot, sell stop at the low of that
  pivot." (GH, May 2026). He also allows buying early at the averages ("so you could start buying in anticipation of
  the move").
- Stop: "Write the stop before the entry: the low of the consolidation pivot, or a close below the average the stock
  respects. If the distance is more than 3%, the entry isn't there yet. Wait, or pass." Also: "If I can keep my risk
  between 2% and 3% against an average the stock demonstrably respects, that's exactly what I want." Exit: "a close
  below the converged averages that doesn't recover, or an undercut of the pivot low, and I'm out."
- Group rule: "Four or more in one group's top ten is the signal worth acting on." (top ten by relative strength in the
  two or three strongest groups).
- Examples: NTRA (end of May 2026), GH (May 2026), OSCR (spring 2026), MRVL (a late-stage pad to be careful of), QQQ
  and SPY. No statistics.

His "Consolidation Pivot: Buying Before the Breakout" (4 Sep 2026) and "21-Day Moving Average Sell Rule: When to Sell a
Stock" (28 Aug 2026) are listed in the same API; not read for this dossier. The earlier search-engine claim of a Haber
"3% rule" was half right: his 3% is the stop distance (pass if the stop is more than 3% away), not the averages' spread.

### 3.9 Deepvue (21 Sep 2024; the TraderLion circle's own platform, see section 2)

[deepvue.com, "The Launch Pad Setup: Your Guide to Early Stock Entry"](https://deepvue.com/indicators/launch-pad-the-early-entry-technique/)
- Definition: "The Launch Pad occurs when the price on a closing basis is within 1-3% of the 21-day simple, 50-day
  simple, and 65-day exponential moving averages."
- Order: "The moving averages should be rising and aligned, with the 21-day above the 50-day and both above the 65-day."
- Context: "In each bull market cycle, the strongest stocks will pause their advance, consolidate their recent gains,
  form a new base, and then break out to even higher levels." It also places it "after the stock has bottomed and
  begins working up the right side of a base."
- Buy: "The Buying Strategy involves waiting for the stock to form a tight trading range within 3% of the moving
  averages after the stock has found support, displayed positive price action, and is trending higher." Then: "Long
  above the range or short below the range."
- Stop: "A protective stop can then be placed at the opposite end of the range."
- Selling: "Entering a trade early allows traders to sell partial profits into strength when the price reaches previous
  highs."
- Examples: NVDA (Jan 2024), FSLR (Mar 2024), COIN (Oct 2023), AVGO (May and Oct 2023), APP (Jan 2024). No statistics.
- Self-contradiction: the FAQ on the same page says "within 1-3% of the 21-day EMA, 50-day SMA, and 65-day EMA" (EMA,
  not SMA). Deepvue's knowledge base gives only a loose definition: "Formed when short and long term moving averages are
  in close proximity of one another supporting price." ([deepvue.com/knowledge-base/technical](https://deepvue.com/knowledge-base/technical/), updated 19 Jun 2026).
  A search summary cited a Deepvue help page with a 2% band; that host (help.deepvue.com) did not resolve, so it is
  not used.

### 3.10 The StratLab (Nigel, 3 Feb 2026; secondary, credits TraderLion)

[thestratlab.substack.com, "Understanding the Key Moving Averages Widget"](https://thestratlab.substack.com/p/understanding-the-key-moving-averages)
- "The 10, 21 and 50 are all within 1-3% of each other. That’s the Launchpad setup."
- "When you see price close above all three moving averages while they’re locked together in that 1-3% range, when all
  three show ENTER status simultaneously with minimal ATR extensions, that’s your Launchpad trigger."
- "From contraction comes expansion."
The post mixes EMA and SMA for the 50-day. No stop or statistics.

### 3.11 BigGuavaTrading script (2 Nov 2025; forum-level, protected code)

[TradingView, "Launchpad & Slingshot"](https://www.tradingview.com/script/fXVC2e6a-Launchpad-Slingshot/)
- "The script uses up to four customizable MAs (default: 8/21/50/200 EMAs of close)".
- "Require a transition from non-stacked to stacked state." and "Price must cross above the highest MA (bull) or below
  the lowest (bear)."
- Mechanically close to the owner's launch bar (cross above the highest average as the stack forms), but it measures no
  tightness, base or correction. Low weight: an anonymous script page.

### 3.12 Read but not used as a source

- ProRealCode forum thread "The Launching Pad Setup" (29 May 2022): a member's screener request; the moderator's code
  aligns 21/50/200 SMAs and 23/65 EMAs with a volume spike. A forum, so not a source; noted because its averages match
  TraderLion's.
- "Launch Pad" by YakupSabri on TradingView (17 Aug 2025): an open-source script with one line of description; its
  code was not read. A search summary claimed it credits Richard Moglen; the page does not say so.
- Search-engine summaries of TraderLion pages: superseded by reading the pages themselves (3.7, 3.8).

### 3.13 Comparison table

| source | prior trend | shape and length | which averages | how tight | vs the 200-day | volume | trigger and entry | stop | sells |
|---|---|---|---|---|---|---|---|---|---|
| Owner (3.1) | "after a real correction" | long flat base, weeks; price under and through the bundle; dangle and retest | 8, 21, 50 (his MSTR words: 9 > 20 > 50) + the 200 | "chunk up", no number | bundle "at or near the 200"; launch closes above it | not stated | first close above every average | not ruled | not ruled |
| Model Book playbook (3.2) | after a bear market or correction | consolidation across the averages | 8 EMA, 21 EMA, 30 SMA, 50 SMA, stacked | "bunched closely", no number | not stated | not stated | break of the base or consolidation high | under the consolidation low or the MA stack | trail short MAs; scale into strength |
| Team playbook row (3.3) | not stated | tight base, tight 5-day range | 8, 21, 50 (200 for best grade) | about 1 ATR | best near the 200 | high-volume close is one trigger | inside the pad, reclaim, or high-volume close | base low or day's low; wider under 50/200 | trim into the 3-5 day burst |
| Manrav (3.4) | correction or base | tight EMAs | 8, 21, 50 (+200 better) | "tight" | prefers near the 200 | not stated | near the pad / 50-day | under the pad; 65 EMA | rides 8 and 21 EMAs |
| Owner as TSDR, Sunday Scans (3.5) | varied | base, higher low, tightness | 9/20/50 (hourly), "all MAs" | "stacked tight" | used both above and below | not stated | the higher low; over the prior day's high (TWLO) | day's low, 200-day, 20 EMA | not stated |
| TraderLion thread (3.6) | base | under the averages, reclaim, curl, retest | 10 DMA, 21 EMA, 50 DMA, 65 EMA, 200 DMA | not stated | the 200 is one of the averages | "on volume" | reclaim, then the retest | not stated | not stated |
| TraderLion 2024, Rai (3.7) | consolidation under flat averages | Power of 3 reclaim bar, then the Launch Pad retest | 10, 21, 50 SMA | not stated | not stated | rising on the reclaim | support at a rising MA, break of a consolidation high, inside day | recent lows, preferably 3-5%; or several closes under the MAs | not stated (adds shares) |
| Haber 2026 (3.8) | early-stage base, start of a new uptrend | averages tight beneath price, turning up | 10, 21, 50, 200 SMA (+23, 65 EMA) | "tight relative to itself", no number | flat averages above price = "a ceiling" | not a rule | through the consolidation-pivot high; or early at the averages | pivot low, or a close under the respected average; over 3%, wait or pass | not stated here |
| Deepvue (3.9) | bull-market leader pausing, or bottomed and on the right side | tight range, late in a base | 21 SMA, 50 SMA, 65 EMA (FAQ: 21 EMA) | close within 1-3% of them | not stated | not stated | long above the range | other end of the range | partial profits at prior highs |
| The StratLab (3.10) | sideways base | contraction | 10, 21, 50 | within 1-3% of each other | not stated | not stated | close above all three | not stated | not stated |
| BigGuava script (3.11) | any | none | 8, 21, 50, 200 EMA | none | the 200 is one of the four | none | cross above the highest as the stack forms | not stated | not stated |
| App scanners (section 5) | none | none (v1 labels a 6-day range) | 8 EMA, 21 EMA, 50 SMA (v1 also 9/20/50/200) | v1: 3.5% of price; v4: 0.6 ATR | v4: no falling 200 overhead | none (scores only) | the close, at most 1 ATR above the bundle | v1: 0.25 ATR under the lower of 21/50; v4: bundle floor | 2R and 3R |

### 3.14 Where the sources disagree

1. **Which averages.** Every source uses a different set: 8/21/50 (owner's lesson, scanners, Manrav), 9/20/50 (the
   owner's MSTR words, his Sunday Scans hourly pads, the Model Book glyph), 8/21/30/50 (Model Book playbook), 10/21/50
   (StratLab; TraderLion 2024 as SMAs), 21/50/65 (Deepvue), 10/21/50/65/200 (TraderLion thread), 10/21/50/200 SMAs plus
   the 23 and 65 EMAs (Haber). The 50-day is the only one all of them share.
2. **Stage.** The owner and Weinstein-style framings put it at a bottom, after a correction, near a flat 200-day. Haber
   wants an early-stage base "at the start of a new uptrend" and warns against pads "beneath declining longer-term
   averages"; TraderLion 2024 wants horizontal averages on the reclaim. Deepvue's main text puts it in a leader's later
   base, with "rising and aligned" averages. Section 4.3 shows his kept charts mostly had a flat or falling 50-day (only
   9 of 26 rose over the prior 20 sessions).
3. **Stacked before, or stacking at the launch.** Deepvue and the team row want the stack already in place; the
   owner's ruling says the full stack is not required and forms "as the MAs stack".
4. **Price under or above the bundle in the base.** TraderLion's thread and the owner's MSTR words: under, then above.
   TraderLion 2024 makes it two setups: the reclaim bar (Power of 3), then the Launch Pad retest with price above.
   Haber, Deepvue and the team row: the averages sit beneath price. The owner's own words go both ways ("Hanging
   underneath" for MSTR, "the dangle above" for GE and CAT); see question 4 in section 10.
5. **Entry.** Inside the pad (team row, Manrav), above the tight range (Deepvue), a close above all averages (owner's
   bank lesson, StratLab), over the prior day's high (the owner's TWLO trade), the higher low at the pad (the owner's
   ARM note), a break of the base or consolidation high (Model Book playbook, TraderLion 2024, Haber's "ideal"), support
   at a rising average or an inside day (TraderLion 2024).
6. **Stop.** The day's low (team row, the owner's TSLA note), the base low or "opposite end of the range" (Deepvue,
   playbook), the consolidation-pivot low or a close under the respected average, with 3% as the most (Haber), recent
   lows "preferably within 3-5%" (TraderLion 2024), under the averages (Model Book, scanners), the 65 EMA (Manrav), the
   20 EMA (the owner's TWLO trade), the 200-day (the owner's TSLA note).
7. **Volume.** TraderLion's thread says "on volume" and its 2024 post wants volume "increasing as the stock moves
   through the MAs"; the brain's template wants 2x; the owner, Haber and Deepvue set no volume rule.
8. **Direction.** The Model Book calls it symmetrical (and his 2026-10-23 "playbook version" ruling adopted that
   definition); the owner's later lesson is long only; UCT writers, the owner among them, use a "bearish launch pad" as
   a separate short or sell signal.

---

## 4. Measured evidence

### 4.1 Published statistics: none for this setup

I found no published test of a launchpad by any name: not from Deepvue (examples only), not in any TraderLion text I
could read (the 2022 thread, the 2024 post and Haber's 2026 article give examples only), and Bulkowski's site has no
such pattern. Nothing below comes from a published Launchpad study.

The nearest published numbers are Bulkowski's own trades labelled by Weinstein stage
([thepatternsite.com/Stages.html](https://www.thepatternsite.com/Stages.html)). Read through a fetch tool twice, same
wording both times (the site refused plain downloads): "I logged 440 buys and 444 sales from April 1987 until February
2010." "The winners are to buy in stage 1 and sell in stage 2 (25.9% average gain from 62 trades)". The table row for
buys in stage 1: 13.2% average, 127 trades, 69.3% profitable. Limits: one trader's own trades, his own stage labels,
weekly charts, no stop rule, not a launchpad test. The site carries a notice against using it to train AI (section 11).

### 4.2 UCT's own measurements (in the repo, not published)

| file | sample | entry / stop | n | median risk | stop hit (60 sessions) | reached 1R / 2R / 3R | median best R |
|---|---|---|---:|---:|---:|---|---:|
| `docs/study/levels/evidence.md` | the bank's 56 Yes charts (chosen to work) | launch close / launch low | 56 | 3.7% | 41% | 89% / 82% / 68% | 4.5 |
| same | same | launch close / under the bundle (engine) | 56 | 7.4% | 36% | 88% / 64% / 41% | 2.6 |
| `evidence_kept.md` | only the 28 he kept | launch close / launch low | 28 | 4.0% | 36% | 86% / 86% / 75% | 6.0 |
| same | same | next day over the launch high / launch low | 25 | 4.7% | 36% | 88% / 88% / 68% | 4.5 |
| `evidence_atlas.md` | 800 deep-scan instances since 1995, top 1,000 stocks, NOT filtered for working | launch close / launch low | 800 | 3.3% | 79% | 49% / 35% / 25% | 0.9 |
| same | same | launch close / under the bundle | 800 | 6.9% | 62% | 47% / 27% / 14% | 0.9 |
| same | same | next day over the launch high / launch low | 542 | 3.9% | 75% | 50% / 34% / 25% | 1.0 |

`docs/study/bank_v2/ATLAS.md` (same deep scan): 10,901 Launchpad instances, 5,875 with no other setup on the same bar;
the finder's own "worked" test passed 24% of the time; the median best move before a close under the launch candle,
within 60 sessions, was +5.4%; the launch low broke within 60 sessions in 70%. The worked rate barely changed with the
market: 24% with SPY in a downtrend (1,010 instances), 24% in an uptrend (6,403), 25% mixed (3,488).

How to read these. The bank rows were chosen to work (the pass-4 finder's `works` test, for example, kept a launch only
if no low within 20 sessions fell more than 1% under the launch-day low, the stock gained 8% or more, and it was up 10
and 20 sessions later; ATLAS.md uses the same test for "worked"), so they flatter any stop at the launch low. The atlas is the honest one: about half the trades reach 1R and
a quarter reach 3R before a stop at the launch low. Nothing in these files trails or trims, so they are not P&L.

### 4.3 New measurements for this dossier (local daily bars, read-only)

Scripts and outputs are in the session scratchpad (`setups/07-launchpad/tools/`); the bars are the workbench copy of the
app's bars database (`bars.db`; the writer recorded 3,897 daily tickers when the scans ran; the file was refreshed later the same day and
held 4,284 at the check, and the checker's re-run of the kept-chart numbers on it gave the same results; the scan
instances run from 1988 to Aug 2026, all but two from 1995 on). Same replay rules as `measure_rules.py`: the
stop is not checked on the fill day, and on the day the stop is hit that day's high is not counted. "Best R" is the
largest gain before the stop, in R, within 60 sessions. Stops sit 5 cents under the named low (F62).

**(a) What his kept charts look like** (26 of the 28 kept; ASND and LI lack enough local history). Kept vs the 15 cuts
with bars:

| measure (at the launch, or the day before for the bundle) | kept: median (range) | cut: median |
|---|---|---|
| fall before the base: lowest close of the last 60 sessions vs the high of sessions 60-120 back | -22% (-13% to -34%) | -21% |
| closes BELOW the bundle in the prior 40 sessions | 16.5 (2 to 26) | 5 |
| closes ABOVE the bundle in the prior 40 sessions | 11.5 (0 to 21) | 22 |
| bundle width, day before the launch (8 EMA, 21 EMA, 50 SMA; % of price) | 1.7% (0.3% to 2.9%) | 1.7% |
| the same width in ATRs | 0.6 (0.1 to 1.4) | 0.6 |
| 50-day change over 20 sessions | -0.7% (-9.1% to +8.5%) | +1.5% |
| 200-day vs the middle of the bundle | -1.2% (-9.3% to +14.4%) | +0.7% |
| launch-day gain | +5.2% (+2.4% to +9.9%) | +5.6% |
| launch-day volume vs 50-day average | 1.8x (0.8x to 3.0x) | 2.2x |
| where the close sits in the day's range (1 = the high) | 0.95 (0.65 to 1.0) | 0.91 |
| close vs the top of the bundle | +5.0% | +4.3% |
| stop distance, a few cents under the launch-day low (% of the close) | 4.0% (3.0% to 9.9%) | 4.2% |
| stop distance, under the lower of the launch and prior-day lows | 6.7% | 6.3% |
| stop distance, the scanner's stop (0.25 ATR under the lower of 21/50) | 8.0% | 8.5% |
| stop distance, the 20-day low (base low) | 13.3% | 11.6% |

Counts on the 26 kept: all 26 closed above the bundle; 23 closed above the 200-day (F, RYTM and IBKR closed under it
on these bars, all from passes 2 and 3, before his WSM ruling); 22 were stacked 8 > 21 > 50 on the launch day; only 14
had the 50-day above the 200-day; 21 had 10 or more closes under the bundle in the prior 40 sessions (cuts: 7 of 15);
only 4 had 20 or more closes above it (cuts: 9 of 15). Only 11 of 26 had volume of 2x or more; 18 had 1.5x or more.
In 18 of 26 the stock had closed above all four averages at least once in the 10 sessions before the marked launch day,
so "the FIRST bar that closes above every average" is not literally what he picked: he marked the decisive push, often
after a first poke above (the dangle).

Thresholds that would have cut his own kept charts (checker's re-run, same bars): a 15% minimum fall cuts PEP (-13%);
a 25-session base cuts WDAY (23 sessions, one of his "great" charts); volume of 1.2x or more cuts TEAM (0.76x, also
"great"); a close in the top third of the range cuts ALLE (0.65 of the range); the 200-day within 10% of the bundle
on the day before cuts RYTM (11%) and IBKR (16%); a close above the 200-day cuts F, RYTM and IBKR. Section 8.1 marks
these.

What the bundle does not do: its width is the same for kept and cut charts (median 1.7% both). Width defines the family
but does not separate his good charts from his cuts. What does separate them is where price lived during the base
(under vs above the bundle) and, weakly, a flat 50-day instead of a rising one.

**(b) The house rules on his kept charts.**
- A13 (stops usually within about 3%): a stop under the launch-day low was 3% or less on **0 of 26** kept charts
  (the tightest, BIDU, was 3.00%); 3.5% or less on 10; 5% or less on 16; over 6% on 7 (MSTR 8.5%, LYFT 9.9%, PWR
  7.5%, CELH 7.1%, EXE 6.4%, RYTM 6.3%, ODFL 6.3%; all as a share of the close).
- C29 (skip a long more than 10% over its 10-day average): MSTR, his model chart, closed 10.2% over its 10-day EMA,
  11.8% over the 10-day SMA counting the launch day, 13.1% over the prior 10 days' SMA. Four more kept charts were over
  10% on at least one of those three readings (NOW, DDOG, CELH, ODFL).
- C28 (no chasing more than 4% past the buy point): if the buy point is the top of the averages (the 200-day included),
  15 of 26 kept launches closed more than 4% above it.
- B23 (at least $10 and $20 million a day): all 26 passed (they were picked with that floor).
- The app's own scanners: `uct_launch_pad` fires on 3 of the 26 kept launch days (TEAM, HON, TOL);
  `uct_launch_pad_v4` on 1 (TEAM). The member tag's textbook check (`tag_textbook.launch_pad_r2`) passes 1 (TOL, where
  v4 does not fire), so the member "Launch Pad" tag, which needs both, shows on none of the 26. Section 5 explains why.

**(c) The finder's instances, not filtered for working** (every launch that passes the house finder's setup gates and
liquidity floor, the `facts` and `liquid` functions of `scripts/study/find_launchpad_examples.py`, without its `works`
filter, and with its own window check, which only looks at 2019 onward, replaced by a simple bad-data filter (no day
moving more than 40%); in the 3,235 tickers of `api/data/cap_universe.json` that have local bars, one per stock per 40
sessions, any year from 1995; the list includes a few ETFs). 14,057 instances, 8,987 of them
closing above the 200-day.

| entry / stop (launches closing above the 200-day) | n | median risk | risk 3% or less | stop hit | 1R | 2R | 3R | 5R | median best R |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| launch close / launch-day low | 8,987 | 3.7% | 32% | 75% | 53% | 36% | 27% | 15% | 1.13 |
| launch close / lower of launch and prior-day lows | 8,987 | 5.5% | 4% | 65% | 53% | 34% | 22% | 9% | 1.12 |
| next day over the launch high / launch-day low | 6,376 | 4.4% | 17% | 72% | 53% | 36% | 25% | 12% | 1.16 |

These agree with the atlas (800 instances: 49% / 35% / 25%), so the local data and the house scan tell the same story.
His kept launches were bigger days than the average finder launch, so their stops were wider: none of his 26 was
within 3%, against 32% of all finder launches.
Launches still under the 200-day (5,070) did slightly worse at the close: 1R 51%, 2R 34%, 3R 25%, median best R 1.03.

**(d) A baseline: is the launchpad context worth anything on its own?** The same replay on every strong up day that
merely LOOKS like a launch bar (closes above the 8/21/50 and the 200-day, up 2% or more, close in the top 35% of the
range, volume 1.2x or more, range at most 4 ATR, gap at most 6%, $10 and $20 million a day), with no correction, base or
convergence required: 44,045 days (42,992 in the house-plan row of (e), which needs 120 sessions after each day).
Launch close / launch-day low: median risk 3.4%, stop hit 77%, 1R 51%, 2R 35%, 3R
25%, 5R 14%, median best R 1.05.

That is almost the same as the launchpad rows above (1R 53%, 2R 36%, 3R 27%, best R 1.13). In plain words: on daily
bars, with a stop under the launch-day low, the base-and-bundle picture adds one or two percentage points over any
strong day above all the averages. Whatever edge the setup has must come from what this test cannot see: picking the
right stocks (the owner's taste, leadership, the group, the story), the market, and how the trade is managed. That is a
reason to teach the owner's selection cues (section 9) as the heart of the lesson, not the bundle alone.

**(e) The entry, played through a simple house plan.** Three entries:
- **A, the close**: market order at the launch-day close; stop under the launch-day low.
- **B, the intraday trigger**: market order the moment price trades over the higher of the prior day's high and the
  top of all four averages (the 200 included); stop under the PRIOR day's low (known before the open). Daily bars cannot
  show the order of moves inside a day, so a day that also traded under that stop counts as a full loss.
- **D, the next day**: over the launch-day high; stop under the launch-day low.

The house plan, as I coded it from the rulebook (simplified): stop to breakeven once 2R trades (B19, low end); a third
at 3R and a third at 5R, at the open if it gaps past (B19, E51, F63); after the first trim, the rest sold on a close
under the 21-day EMA (E52); still under +1R at the 10th close, sold (C33); at most 120 sessions; a gap open under the
stop exits at the open (B20's 30-minute rule cannot be replayed on daily bars).

| sample | entry | n | mean R a trade | median R | winners |
|---|---|---:|---:|---:|---:|
| his 26 kept charts (chosen to work) | A close | 26 | +2.27 | +1.99 | 18 |
| same | B intraday | 22 | +4.38 | +3.75 | 21 |
| same | D next day | 23 | +1.79 | +0.92 | 14 |
| fair test: every armed base whose day traded over the B trigger | B, sold at the close if the day did not close as a launch | 26,398 | -0.03 | -0.05 | 43% |
| the 3,071 of those days that DID close as finder launches | B, held | 3,071 | +0.43 | 0.00 | 48% |
| same 3,071 launches | A close | 3,071 | +0.05 | -0.48 | 37% |
| same | D next day | 2,129 | +0.04 | -0.28 | 39% |
| baseline: any strong day above all four averages (d) | A close | 42,992 | +0.04 | -1.00 | 35% |

"Armed" means the house finder's pre-launch gates held on the prior day (a fall of 15% or more, bundle within 5%, the
prior close within 15% of the 200-day, a 30-day close range within 22%, at least 6 of 30 closes at or under the bundle
top) and its score without the launch-day points was 9 or more; one trigger per stock per 40 sessions. "Closed as a
launch" means the finder's full test on that day (score 12 or more and every launch-day gate), which is stricter than
the simplified close check proposed in 8.2.

What it says:
1. On his own kept charts the intraday trigger is clearly best. It buys lower (the close sat a median 3.3% above it),
   its stop is tighter (median 3.4%; 7 of 22 within 3%; only CELH over 6%), and none was over 10% above its 10-day at
   the entry. But those charts were chosen because they worked.
2. In the fair test the same trigger fires on about 7.6 days that never become launches for every 1 that does (11.6%
   of triggers become launches), however strict the base score (11.6% to 13.1% at every minimum score from 9 to 16). Selling those at the close costs little each
   (median -0.06R, mean -0.09R) but adds up: the close entry made +167R in total on the 3,071 launches, while the
   intraday entry with the close check, which had to take all 26,398 triggers to catch those launches, lost 804R.
3. Played mechanically, every entry is close to breakeven (-0.03R to +0.05R a trade), and so is the baseline of any
   strong day (+0.04R). The measurable edge sits in the owner's selection, not in the rule. A hint that base quality
   matters: the top-scoring bases (finder score 16 or more without the launch-day points) made +0.31R a trade at the
   close, but only 115 trades.
4. By era, the close entry made +0.09R a trade in 2010-2026 (2,347 trades) and -0.05R in 1995-2009 (724).

**Limits of everything in 4.3.** Daily bars only; the order of moves inside a day is unknown. Survivors only (stocks
delisted since are missing), so older years lean toward winners. One trade per stock per 40 sessions. "Best R" is not
profit: nothing here trims or trails except the house-plan rows in (e). The finder's thresholds were tuned on the
owner's own picks. No commissions or slippage.

---

## 5. Our app

### 5.1 The two pattern-engine scanners

**`api/services/pattern_engine/detectors/uct/uct_launch_pad.py`** (pattern `uct_launch_pad`, admin-only). It fires on
the newest of the last 3 sessions that qualifies and has not traded through its stop since. Two variants:
- **strict**: the 8 EMA, 21 EMA and 50 SMA lie within 3.5% of price of each other; the close is above all three but no
  more than 1 ATR above the highest; and the 50-day is "curling": above its value 5 sessions ago, or rising faster than
  the 5 sessions before, and not down more than 1% over 10 sessions.
- **four_ma**: the 9 EMA, 20 EMA, 50 SMA and 200 SMA lie within 3.5% of price of each other, and the close is above all
  four by no more than 1 ATR.
- Labels only (never a reason to fire): `pinch_50_200` (price between the 50 and 200-day when they are within 6% of
  price of each other, with the 8 and 21 EMAs between them),
  `loose_on_cluster`, a stack grade (A = 8 > 21 > 50 > 200; B = 8 > 21 > 50; C otherwise), a 6-day range of 2 ATR or less,
  the 50-day within 5% of the 200-day.
- Entry: the close. Stop: the lower of the 21 EMA and 50 SMA, minus 0.25 ATR. Targets 2R and 3R
  (`uct_setups_common.make_levels`). Liquidity: only the shared floor ($2 a share and $10,000 a day over 20 sessions).
  Confidence must reach 50 (40% shape score, 25% volume score, 20% market context, 15% fixed).
- Not tested at all: a prior correction, a base, the length of time near the bundle, where price lived in the base,
  volume, a close above the 200-day (strict variant).

**`uct_launch_pad_v4.py`** (pattern `uct_launch_pad_v4`, a port of an offline lab rule). It fires when the 8 EMA, 21 EMA
and 50 SMA sit within 0.6 ATR of each other, the close is above all three by more than 0 and at most 1.0 ATR, and there
is no "falling 200 overhead" (close under the 200-day while the 200-day is lower than 20 sessions ago). No 50-day slope
gate, no tightness gate, no volume gate. Variant `stacked` if 8 > 21 > 50, else `converged`. Entry: the close. Stop: the
bottom of the bundle (no ATR buffer). Targets 2R and 3R. Its docstring reports the lab's test against the team's calls:
recall 23.5%, and 82.4% of decided fires judged real in two blind packets of 25 (95% interval 66.5% to 91.7%). That
lab measured the team's calls, not the owner's definition.

### 5.2 Other places the app defines a launch pad

- **The member tag** (`api/services/setup_tags.py`): "Launch Pad" = `uct_launch_pad_v4`, narrowed by
  `api/services/pattern_engine/tag_textbook.py` `launch_pad_r2`: bundle within 2% of price, close above the bundle and
  the 200-day, the 50-day rising over 10 sessions, the 200-day rising over 20 sessions, a close at or above the open, and the prior 10
  sessions' range within 10% of price. Its member definition: "A close just above a tight cluster of the 8-day EMA,
  21-day EMA and 50-day average, with no falling 200-day average overhead."
- **Chart IQ** (`api/services/chart_iq/engine/v2_setups.py`): 9 EMA, 21 EMA and 50 SMA within 1.5 ATR, price within
  2 ATR of each; grade gates for the 200, a non-falling 50 and 21, and a tight 5-day range; stop at the "Pad low" (lowest
  low of 5 sessions). And a "Launch pad" watch in `forward.py`: the 20 EMA within 2% of the 50 SMA, a 20-day range
  within 15%, price within 1 ATR of the 20 EMA; "a close over the base top" (the 20-day high) is the go, stop under the
  20-day low.
- **The Study bank finder** (`scripts/study/find_launchpad_examples.py`, used by `scripts/study/bank_v2/scan_history.py`).
  This is the only code built on the owner's picture. Hard gates: a fall of 15% or more; bundle width 5% or less of the
  prior close; the prior close within 15% of the 200-day; a 30-day close range of 22% or less; launch day up 2% or more,
  closing in its top 35%, volume 1.2x or more, range at most 4 ATR, gap at most 6%; at least 6 of the last 30 closes at
  or under the bundle top; the close above the 8/21/50. Then a score of 12 or more from base length, width, a flat
  50-day, the 200 near the bundle, time spent both above and below the bundle, a close approach, the fall's depth, and
  small bonuses (close above the 200, the 9 > 20 > 50 stack, 2x volume, a 4% day, touches, dangle days, a tight base).
  Liquidity: $10 and $20 million a day over 120 sessions (B23). It does NOT require a close above the 200-day: that
  is only one score point, though the owner ruled it (WSM).

### 5.3 The trade plan, the Model Book and the journal

- **TRADE_PLANS.md** and `api/services/study_trade.py` give the Launchpad plan from `uct_launch_pad.py`: entry "the
  close out of the tight cluster of averages", stop "under the 21-day and 50-day averages, a quarter of an ATR below the
  lower one", trims at 2R and 3R, trail "under the rising 21-day average, or under each higher low". `study_trade.py`
  words the buffer as "a quarter of a day's range", a plain-words version of the code's quarter of the 14-day ATR.
- **Model Book card** (`app/src/pages/modelbook/setupCatalog.js`): family "Bases & Breakouts", direction 'both', essence
  "After a correction the 8, 21 and 50-day chunk into a tight bundle near the 200 and price lives under it in a flat
  base; the launch is the first close above every average as they stack." The glyph draws the 9, 20, 50 and 200.
- **Model Book playbook**: section 3.2 (8/21/30/50, breakout entry, symmetrical).
- **Setup list** (`app/src/constants/setupGroups.js`, the Model Book's "Add Setup" dropdown, also read by Journal
  2.0's tag map): "Launchpad" in the Swing list. The same file's grade list (`GRADES`, used by the Model Book pages) is
  A+, A, B, C, F, while the rulebook grades setups A+, A, B, B- (D38, E49).
- **The brain's template** (`docs/study/levels/brain_kb_2026-11-06.json`): entry "Break above tight consolidation range
  on explosive volume", volume "2x+ average", stop "Below consolidation range low", max 8%, first target "10-30% from
  breakout in days", mistakes "Entering before volume confirmation" and "Mistaking a VCP for a launchpad".

### 5.4 Where the app disagrees with the sources or looks wrong

1. **The scanners miss his picks.** On the 26 kept charts, `uct_launch_pad` fires on 3 and v4 on 1 (4.3 b). Main
   causes: (a) both cap the close at 1 ATR above the bundle, but his launch days closed a median 5.0% above the bundle
   top, about 1.8 ATR at his median ATR of 2.8%; (b) the strict variant wants a rising 50-day, while 17 of 26 kept charts
   had a 50-day that was flat or falling over 20 sessions; (c) the member textbook check wants a rising 50 and a rising
   200 (only 14 and 12 of the 26 had them), so the member "Launch Pad" tag shows on none of his 26 kept launch days.
   The verdict log already noted that `uct_launch_pad` does not fire on MSTR (line 60).
2. **None of the scanners test the base.** No correction, no time under the bundle, no base length. These are what
   separate his kept charts from his cuts (4.3 a). Without them a scanner calls a pullback in an uptrend (his GOOGL cut)
   a launchpad.
3. **The trade plan's stop is about twice too wide for the house rules.** The scanner stop sat a median 8.0% under the
   launch close on his kept charts; A13 says stops usually sit within about 3%.
4. **The trade plan's trims** (2R, 3R) predate B19 and E51 (a third at 3R, a third at 5R). The rulebook's B19 says the
   setup review (TRADE_PLANS.md) follows it.
5. **v4 allows a close under the 200-day** as long as the 200 is not falling. B26 (hard rule) and his WSM ruling do
   not.
6. **The Model Book playbook** uses a 30-day SMA nobody else at UCT uses, a breakout entry he has ruled against ("not a
   breakout"), and calls the setup symmetrical; the card says direction 'both' while his bank lesson is long only.
7. **The brain's template** wants 2x volume (11 of his 26 kept launches had it), allows an 8% stop (conflicts with A13),
   and is labelled "Qullamaggie" without support (section 2).
8. **The team playbook row** says to "add on the 50 SMA reclaim"; A5 says no adding ("i buy full at one spot with one
   stop").
9. **Six definitions inside one app** (two scanners, the member tag's extra check, two Chart IQ rules, the bank finder) with different
   averages (8/21/50, 9/20/50/200, 9/21/50, 20/50), widths (3.5% of price, 0.6 ATR, 2%, 1.5 ATR) and stops. A member
   can see a "Launch Pad" tag on a chart the course would call a pullback breakout.

---

## 6. UCT's own words

All Substack posts below are public (audience "everyone"; one later post, 2026-10-18, is subscribers only and was not
read). I searched all 103 posts in the sitemap on 2026-11-09; 29 mention the setup. Sunday Scans carry the byline
"Uncharted Territory" and are built of named sections. Checked against each post: every stock quote in 6.2 sits in
"TSDR’s Weekly Outlook & Watchlist" ("Charts Covered"), and TSDR is the owner (section 2), so they are his own words;
the three QQQ lines sit in the "ETFs Covered" or "Index & ETFs" section, which names no writer; the Manrav line is from
the "Shoutout Section!", written in the first person by the newsletter's writer. "The Rest of the Week" posts are
signed by section; the signer is named below (checked against each post's section headings).

### 6.1 The owner's verdicts and rulings
See section 3.1 (all quoted there with line numbers). Bracco's "The Parabolic Short" post does not mention the setup.

### 6.2 Sunday Scans ("Charts Covered" and "ETFs Covered" sections)

| date | ticker | words | link |
|---|---|---|---|
| 2025-08-24 | TSLA | "Got my position on Friday at $324 but really like this launchpad here with all the moving averages stacked tight. Clear risk against Friday’s low or the 200SMA." | [sunday-scans-ffa](https://unchartedterritoryy.substack.com/p/sunday-scans-ffa) |
| 2025-09-01 | SERV | "SERV boosted 14% on Wednesday to remount all MAs. Trying to build above this trend line and launchpad." | [sunday-scans-4d1](https://unchartedterritoryy.substack.com/p/sunday-scans-4d1) |
| 2025-11-02 | (Manrav) | "If there is a Launchpad, Slingshot, HVC edge, or Oops Reversal he will be slapping it. These setups I have adopted and use consistently in my trading and the results have shown." | [sunday-scans-b99](https://unchartedterritoryy.substack.com/p/sunday-scans-b99) |
| 2025-11-23 | VIK | "Nice undercut and checkback on Friday at the Moving Average launchpad. Keeping my eyes on it. Friday around $60 was a good entry." | [sunday-scans-56d](https://unchartedterritoryy.substack.com/p/sunday-scans-56d) |
| 2025-11-30 | ASML | "Moving average launchpad sitting right at $1,000, any pullbacks and area to risk off is worthy of a slap." | [sunday-scans-422](https://unchartedterritoryy.substack.com/p/sunday-scans-422) |
| 2025-11-30 | TWLO (weekly) | "If this goes on to make a weekly higher high after holding the weekly launchpad and forming a higher low post ER then we have ourselves a special winner imo" | same |
| 2026-01-04 | QQQ (bearish) | "The 9ema, 20ema, and 50sma are all stacked right at $616.50-$617.50. We will need to get over that otherwise risk a bearish launch pad." | [sunday-scans-153](https://unchartedterritoryy.substack.com/p/sunday-scans-153) |
| 2026-01-25 | FLR (weekly) | "Also this base is reasonable around $45 with a weekly chart showing a possible launchpad as well." | [sunday-scans-7fb](https://unchartedterritoryy.substack.com/p/sunday-scans-7fb) |
| 2026-02-08 | ZM (hourly) | "A little bit of tightness and we have an hourly launchpad setting up with the 9/20/50 hourly MAs set to be stacked. That is where I will look for my entry and tight stop." | [sunday-scans-29e](https://unchartedterritoryy.substack.com/p/sunday-scans-29e) |
| 2026-02-16 | QQQ (bearish) | "Lower high and rejection at the bearish launchpad. Below all key moving averages aside form the 200SMA which seems like the magnet for now." | [sunday-scans-ccf](https://unchartedterritoryy.substack.com/p/sunday-scans-ccf) |
| 2026-02-22 | ENPH (hourly) | "Hourly forming a potential launchpad with the 9/20/50 all lined up there." | [sunday-scans-04c](https://unchartedterritoryy.substack.com/p/sunday-scans-04c) |
| 2026-05-10 | CRCL | "An ultimate launchpad here and something that could really accelerate on strength." | [sunday-scans-68a](https://unchartedterritoryy.substack.com/p/sunday-scans-68a) |
| 2026-06-28 | RBRK | "Solid earnings report with minimal reaction, 200SMA beginning to slope up with price being supported there. 50SMA about to come above 200SMA and we have a potential launchpad here for a move into $100" | [sunday-scans-ae1](https://unchartedterritoryy.substack.com/p/sunday-scans-ae1) |
| 2026-07-12 | SEDG | "I like the potential launchpad setting up here with all the MAs stacked. I want to see a push and higher low and tightness out of that higher low" | [sunday-scans-898](https://unchartedterritoryy.substack.com/p/sunday-scans-898) |
| 2026-07-12 | RDDT | "The 200SMA remount was attractive out of this mini base here but it is still curling lower." Then: "If we get a launchpad to form I will be increasingly more interested in it." | same |
| 2026-08-02 | QQQ (hourly) | "I would be encouraged to see early week weakness get bought up to form an hourly launchpad in this $680 area." | [sunday-scans-cd2](https://unchartedterritoryy.substack.com/p/sunday-scans-cd2) |
| 2026-08-30 | TENB | "Big bullish engulfing on earnings to hold all MAs, higher low and getting tight at the launchpad spot." | [sunday-scans-d40](https://unchartedterritoryy.substack.com/p/sunday-scans-d40) |
| 2026-09-20 | ARM | "Launchpad on the daily and ready to establish a higher low. That is where I want to be a buyer personally. $255 to $260." | [sunday-scans-bc2](https://unchartedterritoryy.substack.com/p/sunday-scans-bc2) |

What these show: the owner (as TSDR) uses "launchpad" for the bundle as a place (a support zone to buy a higher low at,
a level to "risk off" against), on three timeframes, and names the day's low or the 200-day as stops (his TWLO trade in
the same 2025-11-30 post adds the 20 EMA, section 3.5). RDDT shows the 200-day matters: the 200 "still curling lower"
made it a wait.

### 6.3 The Rest of the Week (team posts, signed by section)

| date | signer | ticker | words | link |
|---|---|---|---|---|
| 2025-10-01 | Tiny Trades | CELH | "Daily has had a three day push and regained all moving averages, setting up launch pad below. Swing trade opportunity with great area to risk off." | [the-rest-of-the-week](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week) |
| 2025-10-08 | Manrav | TDOC | "Massive base and now we have an undercut and reclaim of the 200 SMA + a launch pad in the making." Then: "Trade Idea: Long shares and/calls with LOD stop ($8.20)" | [the-rest-of-the-week-208](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-208) |
| 2025-10-15 | Manrav | TDOC | "This has a launch pad on Daily and weekly. Keep a watch for the 200 SMA to hold and this launch pad can make some powerful moves." | [the-rest-of-the-week-39d](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-39d) |
| 2025-10-22 | Manrav | IOT | "The forgotten IPO name with a launch pad on daily. The 200 SMA is still above but only a matter of time before the price reclaims it." | [the-rest-of-the-week-481](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-481) |
| 2025-10-22 | Manrav | UMC | "Trading inside the wick from the week of 10/10 with a launch pad on daily. Watch for the push above 7.66 or a pullback to 21 EMA to mange the risk." | same |
| 2025-10-22 | Alex Jones Industrial Average | PLTR | "Moving Averages Launchpad setting up here on the daily chart. Very tight consolidation in this." | same |
| 2025-11-12 | Alex Jones Industrial Average | MRK (weekly) | "Moving average launch pad set up on the weekly. This tight consolidation of these MA’s can indicate a big move is coming." | [the-rest-of-the-week-045](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-045) |
| 2025-11-19 | Manrav | OPEN | "Ideally would like to see it reclaim the launch pad (8,21 and 50 SMA) to initiate a long for managing the risk or watch for the bullish gap from 11/10 to hold." | [the-rest-of-the-week-72c](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-72c) |
| 2025-11-26 | TSDR Trading (the owner) | TWLO (hourly) | "The hourly have a perfect launchpad yesterday." | [the-rest-of-the-week-22a](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-22a) |
| 2025-11-26 | Manrav | SMTC | "Gapped down on earnings but the dip was bought up quick and now we have a launch pad on daily." Then: "Trade Idea: Long with 50 SMA stop." | same |
| 2025-12-03 | Manrav | NN | "Back above the launch pad and now a cross back on daily with a close above 50 and 200 SMA’s. Nice R/R with 50 or 200 SMA stop or $13 for a wider stop." | [the-rest-of-the-week-bad](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-bad) |
| 2025-12-10 | Manrav | ON | "A launch pad and a cross back and has the cup and handle look on daily. Long above the tight inside day or the trendline." | [the-rest-of-the-week-b3f](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b3f) |
| 2025-12-10 | Manrav | TSLA | "Launch pad on daily and this is waiting for some catalyst + Weekly is coiled for a big move soon. Must have." | same |
| 2025-12-17 | Manrav | SSRM | "Triple Inside weeks (for now) and double inside days reclaiming the launch pad. Like the flow for Jan 26, 24c. with 21.3 as your stop." | [the-rest-of-the-week-4fe](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-4fe) |
| 2026-01-07 | Manrav | INOD | "Launch pad on daily and weekly in the making, If you are not already long, watch for any signs for consolidation or a flag at the bearish gap which will get the 50 SMA curling up to get long." | [the-rest-of-the-week-3f0](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-3f0) |
| 2026-01-14 | Manrav | RUN | "Got long toward the end of the day based on potential hold of the daily launch pad. (8ema, 21ema, 50sma all stacked tight)." Then: "Need this to get above $19 and the MAs to curl up some more in this launchpad. Monthly is a slap, Oops is a slap, Launchpad is a slap." | [the-rest-of-the-week-305](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305) |
| 2026-04-14 | Viotti | NVTS | "I think any pullbacks into the launchpad area that show buyers present is worthy of trying. I will be targeting these 3 areas for trimming initially" | [the-rest-of-the-week-c4d](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-c4d) |
| 2026-04-14 | Tiny Trades | CIFR | "Love the length of the base its been forming, undercut 200 day and base then reclaim all MA's on strong push. Launch pad setting up below for entry." | same |

Notes against the new rulebook (for the lesson, not as criticism): TDOC's stop of $8.20 and UMC's 7.66 trigger are
under the $10 floor (B23); IOT's pad sat under the 200-day (B26); Manrav's stops at the 50 or 200-day are often wider
than 3% (A13); several ideas use options (B25 allows them occasionally).

### 6.4 UCT traders in the brain (Discord, as stored in the repo's KB files)

Section 3.4 (Manrav) and 3.5 (the owner as TSDR). Also: Bracco loves early launchpads, the first one in a base (2025-11-24, KB
12021, summary); Bracco saw a bearish launchpad forming on BE as a possible short (2026-07-07, KB 12769, summary);
the owner, as TSDR, uses a 9/20/50 hourly "launchpad" for entries (KB 2816, 4044, from his ZM note) and a daily
9/20 EMA or a 65-minute 9/20/50 "bearish launchpad" as a trailing stop (KB 14268, 14348); the KB's VIK note "Moving
Average Launchpad Undercut and Checkback" (KB 4912) matches his Sunday Scans quote above.

---

## 7. How it fits the account rulebook (`docs/study/sizing_rule.md` section 9)

| rule | what it says | fit with the Launchpad |
|---|---|---|
| B26 (hard) | no longs below the 200-day SMA | Fits his WSM ruling: the launch bar must close above the 200. Excludes the in-house ideas with the pad under the 200 (IOT) and the scanners' pinch label. A pad that sits just under the 200 is a watch, not a buy, until the launch closes above it. |
| B23 | $10+, $20M+ a day | Fits; the finder uses the same floor. Excludes the TDOC and UMC ideas. |
| C31 | leaders, RS 80+ (except parabolic and mean reversion) | **Possible conflict.** A stock just out of a 20-35% correction often has a middling RS rating. Manrav's QUBT launchpad showed RS 31 (KB 11344). Not measured here (the app's RS ratings go back one year). Question 7. |
| A3, F62 | stop a few cents under the day's low or the prior day's low | Natural fit: the launch-day low. |
| A13 | stops usually within about 3% | **Conflict.** Under the launch-day low: 0 of 26 kept charts within 3%, median 4.0%. Under the lower of the launch and prior-day lows: median 6.7%. The intraday entry (8.2 option) brings it to a median 3.4%. The originator Haber sets the same 3% as a pass line (3.8). Question 2. |
| A5, A7 | size from the stop; full size at one price; no adds; max 40% | A 4% stop at 1% risk = a 25% position; an 8.4% stop (MSTR at the close) = 12%. Fine. Rules out the team row's adds. |
| E57 | market orders | A close entry = a market order in the last minutes; an intraday trigger = a market order when the level trades. |
| C28 | no chasing more than 4% past the buy point | Depends on what the buy point is. If it is the top of the averages, 15 of 26 kept launches closed more than 4% above it, so C28 would cut most of his picks. If it is the launch close (8.2), C28 only stops late buyers. Question 13. |
| C29 | skip a long more than 10% above its 10-day | **Conflict on the model chart.** MSTR closed 10.2% to 13.1% over its 10-day (by the reading used). Question 8. |
| B19, E51, E52 | a third at 3R, a third at 5R, trail the rest under the 10-day (fast) or 21-day (steadier); breakeven at 2R to 5R | Fits. Manrav's "rides 8 and 21 EMAs" fits the 21-day trail. |
| B20 | gap through the stop: first 30-minute low is the new stop; out past 2R | Applies as written. |
| B22 | no new buys in the 3 days before earnings | Fits UCT practice: Manrav skipped launchpads with earnings due (AMGN, QUBT). |
| C33 | under 1R after 10 trading days: sell | Fits; a pad that does not expand is a quiet failure (`uct_launch_pad.py` narrative says the same). |
| D47, D48 | shorts are the long setups reversed; skip hard-to-borrow | The bearish launch pad (section 8.6). |
| B18, F65, D46 | market filter; Red = mostly cash and shorts under the 200 | Launchpads cluster at the end of corrections, when the reading may still be Yellow or Orange. In Orange only A+ setups (F65). |
| E50 | grading is his judgment; no fixed checklist | Section 9 gives observable cues, not a checklist. |

---

## 8. Proposed rules for our course

Every line is measurable from daily bars unless it says otherwise. The bundle = the 8 EMA, 21 EMA and 50 SMA (see
question 5 for the 9/20/50 option; the numbers barely change). Thresholds marked *his kept charts* come from section
4.3 (a); they describe his picks and are offered as defaults, not as tested edges.

### 8.1 What it is (checked on the day before the launch, unless marked)

| # | rule | basis |
|---|---|---|
| 1 | Liquidity: close of $10 or more and average daily dollar volume of $20 million or more (over 50 days; B23 sets no window, the finder uses 120 sessions). Never own more than 1% of the average daily volume. | [house rule] B23, D42; the 50-day window is [my proposal] |
| 2 | A real correction first: the lowest close of the last 60 sessions is at least 15% under the highest high of the 60 sessions before that. His kept charts: median -22%, from -13% to -34%; this rule would have cut PEP (-13%). | [UCT] "after a real correction"; the 15% is the house finder's calibration, not his words, so treat it as [my proposal] |
| 3 | A long base: at least 25 sessions (5 weeks) of closes within 10% of the bundle's middle, and the last 30 closes span no more than 20% of price. His kept charts: 25 of 26 had 25+ sessions (14 had 80+; WDAY, a "great", had 23); the 30-day span had a median of 11%, at most 17%. | [UCT] measured; the 25 and the 20% are [my proposal] (the finder allows 22%) |
| 4 | Price lived under and through the bundle: at least 10 of the prior 40 closes UNDER the bundle, and fewer than 20 of the 40 ABOVE it. His kept charts: 21 of 26 and 22 of 26; his cuts: 7 of 15 and 6 of 15. | [UCT] his MSTR, ADM, TAN, MARA, SONO, JD rulings; measured; the 10 and 20 are [my proposal] |
| 5 | The bundle is tight: the 8 EMA, 21 EMA and 50 SMA lie within 3% of price of each other on the day before the launch. His kept charts: all at or under 2.9%, median 1.7% (about 0.6 ATR). | [UCT] measured; the 3% is [my proposal]. Outside sources use a similar 1-3% band but measure other things (Deepvue: the close within 1-3% of the 21/50/65; StratLab, crediting TraderLion: the 10/21/50 within 1-3% of each other), and both trace to the TraderLion circle, so this is not [source consensus]. Haber sets no number ("tight relative to itself"). Option: within 1 ATR (team row; his widest was 1.4 ATR) |
| 6 | The 200-day is close: within 10% of the bundle's middle (24 of 26 kept on the day before the launch; RYTM 11% and IBKR 16% were further). Better: at or just under the bundle. | [UCT] "at or near the 200-day"; Manrav KB 12198; measured; the 10% is [my proposal] |
| 7 | The launch bar (the trigger day) closes above all four averages: the 8, 21, 50 and the 200. Closing inside the bundle or under the 200 is not the launch. (Three kept charts, F, RYTM and IBKR, closed under the 200 on our bars; question 3.) | [UCT] WSM and ADSK rulings; [house rule] B26 |
| 8 | The launch bar is a real push: up 2% or more, the close in the top 35% of the day's range (0.65 or higher), volume above its 50-day average (1.2x or more). His kept charts: median +5.2%, close at 0.95 of the range, volume 1.8x. Two kept charts fail a part of it: TEAM (a "great") had 0.76x volume, ALLE closed at 0.65 of its range. | [UCT] measured; the numbers are the house finder's gates, so treat them as [my proposal]. TraderLion 2024 also wants volume "increasing as the stock moves through the MAs" [originator]. 2x volume is a grade cue, not a rule (11 of 26 kept had it) |
| 9 | Not a gap or news bar: the launch opens no more than 6% above the prior close, and is not a one-off macro or news day. A bigger gap is a different setup (Kicker, earnings gap). | [UCT] the log's notes on his ARKK cut (an election-day gap) and INTC cut (a news bar); the 6% is the house finder's gate, so [my proposal]. No kept chart gapped more than 3.1% |
| 10 | The stack forms as it launches: 8 > 21 > 50 on the launch day or within the next 3 sessions. Not required beforehand. | [UCT] the recorded action of his 2026-10-23 ruling: the full stack is not required; 22 of 26 kept were stacked on the day; the 3 sessions is [my proposal] |
| 11 | No earnings report in the next 3 days (B22 says "the 3 days before an earnings report" without saying trading or calendar days). | [house rule] B22; [UCT] Manrav skipped AMGN and QUBT for earnings |
| 12 | A stock he would trade: a leader or a stock in a strong group, not a slow bank; growing sales and earnings preferred (D40). RS 80+ if C31 applies (question 7). Haber's group test, for comparison: four or more of a group's top ten RS names forming pads. | [house rule] C31, D40; [UCT] FITB ruling; [originator] Haber's "Group confirmation" |

### 8.2 The buy

**Recommended default: the launch-day close.** A market order in the last minutes of the session (E57), once the day
already meets 8.1 rules 7 to 9 (above all four averages, up 2% or more, in the top 35% of its range, volume above
average). [my proposal]
- Why: it matches the bank lesson written from his rulings ("the launch is the FIRST bar that closes above every
  average") [UCT]; in the fair test it beat the intraday trigger, which fires on many days that never become launches
  (4.3 e); it needs no guess about where the day will close; and the house replay on the bank's 56 Yes charts also
  favoured the close over the next-day break (`docs/study/levels/evidence.md`).
- What it costs: a wider stop (median 4.0% on his kept charts, none within 3%; A13), and strong launch bars can close
  stretched (MSTR closed 10% to 13% over its 10-day; C29). See questions 1, 2 and 8.

**Option for the owner (one entry style for every setup): the intraday trigger with a close check.** A market order the
moment price trades over the higher of the prior day's high and the top of all four averages; stop a few cents under the
prior day's low; and if the day does not close as a launch (back inside the bundle, under the 200, or up less than 2%),
sell at the close. [my proposal], built on his Kicker ruling "OVER previous day high not at mkt close!" and on his own
TWLO trade as TSDR ("into TWLO on Monday over Friday’s high", section 3.5) [UCT]
- For it: on his kept charts it was the best of the three (+4.4R a trade in the simple house plan), its stop fits A13
  better (median 3.4%), and it avoids the C28 and C29 problems at the close.
- Against it: in the fair test it fired about 7.6 times for every real launch, and the small losses on the false starts
  outweighed its better result on the real launches. It suits a trader who only arms his best bases.

**What the originators do, for comparison (not measured here).** TraderLion's own entries come AFTER the reclaim bar:
the Launch Pad is the retest, bought "on multi-day support at a rising MA", on "a break above a consolidation high", or
on an inside day (Rai, 2024); Haber's ideal is "the move through the high of the post-earnings consolidation pivot, sell
stop at the low of that pivot" (2026). That is the owner's "dangle and retest" turned into an entry. [originator]. It
would need its own test before the course teaches it (question 15).

**Not recommended:**
- The next day over the launch-day high: lowest of the three on his kept charts and no better in the fair test. [UCT
  measured] (This is not the owner's TWLO trade, which bought over the prior day's high; that is the intraday trigger
  above.)
- Buying inside the pad before the launch (Manrav, the team row): it is the anticipation buy, not testable as one rule,
  and the brain's summary of Manrav says he steers newer traders to flags because buying while a stock is basing is
  hard (KB 12875). Keep it for a later, advanced lesson. [my proposal] (Deepvue's "Long above the range" is a break of
  the tight range, not a buy inside it.)
- No chase: a late buyer does not pay more than 4% over the launch close (C28), and a launch that closes more than 10%
  over its 10-day average is skipped (C29; question 8 on which 10-day). [house rule]

### 8.3 The stop

| entry | stop | his kept charts | basis |
|---|---|---|---|
| intraday trigger (8.2) | a few cents under the PRIOR day's low (known before the open; set the moment the order fills) | median 3.4%; 7 of 22 within 3% | [house rule] A3 ("a few cents under the day's low or the prior day's low"), F62 |
| the launch close | a few cents under the LAUNCH day's low | median 4.0%; none within 3% (the tightest, BIDU, was 3.00%) | [house rule] A3, F62; [UCT] team row "the low of day"; the owner's TSLA note ("Clear risk against Friday’s low or the 200SMA") |

- Size from the stop (A5), full size at one price, no adds. A wider honest stop means a smaller position, not a
  tighter stop (A3, A4). [house rule]
- **A cap for this setup** [my proposal]: skip the trade if the honest stop is more than 6% under the entry. On his kept
  charts that skips 7 of 26 at the close (including MSTR at 8.5%) but only 1 of 22 with the intraday entry. The owner
  decides whether A13's "about 3%" is a cap, a target, or a description (question 2).
- The originators are stricter than this proposal. Haber: "If the distance is more than 3%, the entry isn't there yet.
  Wait, or pass." TraderLion 2024: stops below recent lows, "preferably within 3-5% of entry price". [originator]
  Haber's 3% is the same number as A13; TraderLion's 3-5% is close to it. My reading (not their words): their tight
  stops come from buying the retest or the consolidation pivot after the reclaim (8.2, "What the originators do"), not
  the close of a big launch bar.
- Not recommended: the scanner's stop under the bundle (median 8.0% on his kept charts) or the base low (median 13%).
  Both are far outside A13, and the house replay found they reach 2R and 3R less often (`evidence.md`).
- A gap through the stop: B20 (the first 30-minute low is the new stop; out if that is past 2R). [house rule]

### 8.4 Trims and trail (house defaults; nothing in the setup asks for its own)

- Breakeven: move the stop to the entry once 2R has traded (B19 says 2R to 5R; 2R is the low end). [house rule]
- First trim: a third at 3R (B19). If it opens above 3R, take it at the open (F63). [house rule]
- Second trim: a third at 5R (E51). [house rule]
- Trail the last third: sell on a close under the 21-day EMA (E52, the "steadier" trail). Launchpads come out of long
  bases and tend to trend along the 21-day: Manrav's RBLX note "rides 8 and 21 EMAs"; the app's trade plan also trails
  the 21-day. Use the 10-day only if the stock is a fast mover (E52). [house rule] + [UCT]
- Time stop: under 1R after 10 trading days, sell (C33). A pad that does not expand is a quiet failure. [house rule]
- A climax run: sell a big part into it (C34). [house rule]

### 8.5 What invalidates it

Before the entry (the setup is off the list):
- The bundle spreads wider than 3% again, or price closes back under the 200-day after a pop. [UCT] WSM ruling; [my proposal] for the number
- Price rallies up INTO the bundle in a V from far below and breaks out (a breakout, not a launchpad). [UCT] TAN, MARA, SONO, JD, MGNI
- Price is riding on top of the bundle in an uptrend (a pullback breakout). [UCT] GOOGL
- An earnings report is 3 days or less away. [house rule] B22

After the entry:
- The stop is hit (the exit; it only moves up, A4). [house rule]
- The intraday entry's day closes back inside the bundle or under the 200-day: sell at the close (8.2). [my proposal]
- A close back under the bundle that is not reclaimed the next day. The team row: "A close below the 21 EMA/50 SMA
  cluster. A quick break and reclaim is a fake-out, not a failure." With the stop under the launch or prior-day low,
  this usually coincides with the stop. [UCT]
- Under 1R after 10 trading days (C33). [house rule]

### 8.6 The short mirror: the bearish launch pad

UCT already uses it: QQQ "risk a bearish launch pad" (Sunday Scans 2026-01-04), "rejection at the bearish launchpad"
(2026-02-16), Manrav's RKLB "bearish LP" (KB 11726), Bracco's BE (KB 12769), the owner's (TSDR's) 65-minute bearish
launchpad as a sell signal (KB 14348). BigGuava's script (3.11) also has a bear version (price crossing under the
lowest average as a bearish stack forms). D47 makes shorts our long setups reversed. Proposed mirror [house rule] D47 + [UCT] usage +
[my proposal] for the numbers:
- After a real rally, price lives above and through a tight bundle for weeks near a flat or falling 200-day.
- The trigger day closes BELOW all four averages, the 200-day included (B26: shorts only below the 200), down 2% or
  more, closing in the bottom third of its range, volume above average.
- Short by market order (E57) when price trades under the lower of the prior day's low and the bottom of the averages;
  stop a few cents over the prior day's high (or the trigger day's high for a close entry).
- RS 20 or less, weakest groups (C31 mirror); skip hard-to-borrow names (D48); a Red market is mostly cash and shorts
  below the 200-day (D46, F65); whether Orange also favours the short is [my proposal], not a rule.
- Not measured in this dossier. Teach it only after the owner rules (question 6).

### 8.7 Best market conditions

- The market reading Green, or turning Green after a correction, when leaders are basing (F65, F68; the brain's summary
  of Manrav: he buys launch pads and looks for relative strength during corrections, KB 12875). [house rule] + [UCT]
- In Orange, only A+ launchpads (F65). In Red, the long version is off; the bearish mirror is the trade (D46). [house rule]
- Honest note: in the house atlas the finder's "worked" rate was the same with SPY in an uptrend, a downtrend or mixed
  (24%, 24%, 25%). The market filter is a house rule, not something this setup's numbers prove.

### 8.8 Common mistakes

1. Calling a pullback in an uptrend a launchpad (price rode on top of the bundle the whole time). [UCT] GOOGL
2. Calling a V-rally up into the bundle a launchpad; that is a breakout. [UCT] TAN, MARA, SONO, JD, MGNI
3. Buying a pop that closes inside the bundle or still under the 200-day. [UCT] ADSK, WSM; [house rule] B26
4. Averages that are not actually tight ("I won't call that a launch pad, the EMA's are not tight", Manrav KB 10985;
   "Forcing the trade before the moving averages have actually converged", Model Book). [UCT]
5. A wide, sloppy base or a news bar as the trigger. [UCT] INTC, ARKK
6. Buying into earnings. [house rule] B22
7. Chasing: buying more than 4% past the launch close (a late buy), or a launch more than 10% over the 10-day.
   [house rule] C28, C29
8. Putting the stop under the whole base or under the averages, then sizing as if it were tight. [house rule] A3, A13
9. Adding on the way up (the team row's "add on the 50 SMA reclaim"). [house rule] A5 (no adds)
10. Believing the bundle alone is the edge. On daily bars it adds almost nothing over any strong day above the averages
    (4.3 d). The stock, the base and the market are the edge. [my proposal], from the measurement

---

## 9. Grading: what makes an A+ versus a B-

E50: grading "is discretionary and hard to define", so these are observable cues for the lesson, not a scoring
checklist. They come from his graded charts (4.3 a, by his own grade) and the UCT writers.

His grades on the 26 kept charts with bars: great 6 (MSTR, TEAM, WDAY, BIDU, IBKR, EXE), good 12, okay 8 (including F,
"B-", and MGM, "C-").

| cue | A+ end | B- end | basis |
|---|---|---|---|
| The fall before the base | deep: great charts median -25% (all -20% or deeper) | shallow: okay median -21% (to -15%) | his grades, measured |
| Where price lived | under and through the bundle for weeks, then a dangle and retest | above the bundle most of the time (F: 19 of 40 sessions above, 2 below; he called it B-) | his words (MSTR, GE, CAT), measured |
| A stock that can move | higher normal range: great median ATR 3.5% of price, good 2.6%, okay 2.7%; MSTR: "a stock that can move really nicely" | slow, heavy names | his words (MSTR), measured. Haber warns the other way about the extreme: "Wide, loose stocks with huge average daily ranges" are "often a trap" [originator] |
| The launch bar | strong close near the high, volume clearly above average (great median 2.1x) | weaker volume (okay median 1.6x) | measured; volume is a cue, not a rule (TEAM, a great, launched on 0.76x) |
| Near the 200 | the 200 at or just under the bundle; the launch clears all four | 200 well away, or the launch still under it (cut) | Manrav prefers pads close to the 200 (KB 12198, summary); his WSM ruling |
| Timeframes | daily and weekly launchpads together | daily only | team row KB 15867; Manrav TDOC post |
| First pad in the base | the first launchpad after the bottom | a late, repeated one | Bracco KB 12021; Haber: a pad on an early-stage base "carries far more weight than one forming after the stock has already doubled" [originator] |
| Confluence | another UCT setup on the same day (TEAM: an Oops on the launch day) | none | his words: "Beautiful. Also an oops when it triggers that day" (TEAM, line 73) |
| The stock and group | a name he would trade, a leading group, growing sales and earnings (D40); other leaders in the group forming pads too | "lame regional bank", "ugly chart" | his words (FITB, TTC); D40; Haber's "Group confirmation" [originator] |
| Market | Green, leaders basing as the market turns | Orange or Red | F65; Manrav KB 12875 |

What does NOT separate A+ from B-: the bundle's width (great median 2.0%, okay 1.5%; cut charts the same as kept).

---

## 10. Questions for the owner

1. **The entry.** (A) Market order in the last minutes of the launch day, at the close (the bank lesson makes the close
   the event; best in the fair test, 4.3 e). (B) Market order during the launch day, the moment price trades over the
   higher of the prior day's high and the top of all four averages, sold at the close if the day fails (matches his
   Kicker ruling "OVER previous day high not at mkt close!" and his own TWLO trade over Friday's high; best on his own
   kept charts, tighter stops, but many false starts in the fair test). (C) Next day, over the launch-day high. (D)
   Before the launch, inside the pad (Manrav, the team row). (E) After the launch, on the retest of the averages or a
   break of the next small consolidation (TraderLion's Launch Pad, Haber's consolidation pivot; not measured here).
   Recommendation in section 8.2.
2. **The stop and the 3% guideline (A13).** On his kept charts a stop under the launch-day low was never under 3%
   (median 4.0%; the tightest was 3.00%). The originators hold to 3%: Haber, "If the distance is more than 3%, the
   entry isn't there yet. Wait, or pass." Options: (A) accept 3.5% to 6% for this setup and let the size shrink (A5);
   (B) skip any launch whose honest stop is over a cap (6%, or the originators' 3%); (C) prefer entry B, whose stop
   under the prior-day low is tighter when the trigger fills early in the day; (D) prefer entry E, which is how the
   originators reach 3%.
3. **The 200-day on the launch bar.** WSM made it a rule. Three kept charts (F, RYTM, IBKR, from passes 2 and 3)
   closed under the 200 on our bars. Keep them as exceptions, or recut them for the course?
4. **The base: under, or dangling above?** "Hanging underneath the MAs" (MSTR) and "I want the dangle above the
   launchpad for a bit" (CAT). The data says his kept charts usually did both: most of the base under the bundle, then
   a first poke above it in the last 10 sessions (18 of 26). Is *under the bundle for weeks, then a first poke above,
   then the launch* the order he wants taught?
5. **Which averages.** (A) 8 EMA, 21 EMA, 50 SMA + 200 SMA (bank lesson, scanners, Manrav). (B) 9 EMA, 20 EMA, 50 SMA +
   200 SMA (his MSTR words, the Model Book glyph, his own hourly pads in the Sunday Scans). (C) The Model Book playbook's
   8/21/30/50. (D) The originators' simples: 10, 21, 50 and 200 SMA (Haber; TraderLion 2024 uses the 10/21/50 SMAs).
   The numbers barely change between A and B; one set should be taught.
6. **Long only, or both?** The card says 'both', and his 2026-10-23 "playbook version" ruling adopted a definition in
   which the stock "can break either way"; his later lesson is long only; he and his writers use a bearish launch pad.
   Add the bearish launch pad as a short lesson under B26 (below the 200 only) and D47?
7. **RS 80+ (C31).** Does the leader filter apply to a stock just out of a correction, or is the Launchpad treated like
   the exceptions (parabolic, mean reversion)?
8. **Stretch (C29).** MSTR, the model, closed more than 10% above its 10-day on every reading. Does C29 apply to the
   launch-day close, and which 10-day (simple or exponential, with or without the launch day)?
9. **Weekly and hourly launchpads.** UCT uses all three timeframes. Is the course daily only, with the weekly as a grade
   cue?
10. **Volume.** Should the launch bar need above-average volume (his kept median 1.8x; 8 of 26 were under 1.5x)?
11. **The scanner.** Rebuild the app's Launchpad scanner (and the member tag) on his definition, starting from the bank
    finder (`scripts/study/find_launchpad_examples.py`), before any course item uses scanner output? Today the scanners
    fire on 3 and 1 of his 26 kept launches, and the member "Launch Pad" tag on none.
12. **The Model Book playbook text** (8/21/30/50, breakout entry, symmetrical): rewrite to match his rulings?
13. **The buy point for C28.** If the buy point is the top of the averages, C28 (no more than 4% past it) would cut 15 of
    his 26 kept launches at the close. Is the buy point the launch close (or, for entry B, the trigger level)?
14. **A close back under the 200-day after the entry.** B26 governs new longs. Should a close back under the 200 also be
    an exit for an open Launchpad trade, or is the stop the only exit (A4, and "my stop is my stop most of the time")?
15. **The name for which bar.** TraderLion, where the name comes from, calls the reclaim bar (a close from under the
    10/21/50 to above them in one session) the "Power of 3", and the retest that follows the "Launch Pad" (section 3.7).
    The bank lesson calls the reclaim bar itself the launch. Keep his naming (the launch bar is the Launchpad trigger)
    and mention TraderLion's split, or teach the two as TraderLion does? This decides whether entry E (question 1) is
    the main entry or an add-on lesson.

---

## 11. Sources

All read on 2026-11-09 unless marked. Reliability: **originator** = the person or firm that named or teaches the setup;
**educator** = an established educator or data provider; **secondary** = a summary of someone else; **forum** = forum or
anonymous script page; **house** = UCT's own material.

**UCT (house)**
- Owner verdict log, `docs/study/audits/2026-10-24/owner_verdicts.jsonl`, lines 38, 45-46, 60, 72-117 (Launchpad
  passes 2-4) and the 2026-11-09 rulebook lines. House, primary.
- Owner rulings, `docs/study/corrections/spot.fixtures.jsonl` (2026-10-23 and 2026-10-24 Launchpad rows). House, primary.
- Account rulebook, `docs/study/sizing_rule.md` section 9. House, primary.
- `docs/study/TRADE_PLANS.md`; `docs/study/levels/dossiers/launchpad.md`; `docs/study/levels/external_research.md`;
  `docs/study/levels/evidence.md`, `evidence_kept.md`, `evidence_atlas.md`; `docs/study/bank_v2/ATLAS.md`;
  `docs/study/analysis/2026-10-25-setup-differentiation.md`. House.
- Code: `api/services/pattern_engine/detectors/uct/uct_launch_pad.py`, `uct_launch_pad_v4.py`, `uct_setups_common.py`;
  `api/services/pattern_engine/primitives/liquidity.py`; `api/services/setup_tags.py`;
  `api/services/pattern_engine/tag_textbook.py`; `api/services/chart_iq/engine/v2_setups.py`, `forward.py`,
  `v44_read.py`; `api/services/study_trade.py`; `api/services/study_hard.py`;
  `scripts/study/find_launchpad_examples.py`; `scripts/study/bank_v2/scan_history.py`. House.
- Model Book: `app/src/pages/modelbook/setupCatalog.js`, `setupPlaybooks.js` (commit 291af0c34c, 2026-06-12);
  setup list and grades `app/src/constants/setupGroups.js`. House.
- Brain KB files in the repo: `docs/study/levels/brain_kb_2026-11-06.json`, `brain_kb_rules_2026-11-06.json` (rows
  2816, 3405, 4044, 4827, 4912, 5187, 10935, 15459, 10985, 10988, 11169, 11344, 11726, 12021, 12198, 12769, 12875, 13488, 14268,
  14348, 15494, 15867). House; mostly summaries of Discord posts, with the trader's own words where marked.
- UCT Substack, https://unchartedterritoryy.substack.com, all 103 posts in the sitemap read through the public post API
  (102 public; 2026-10-18 subscribers only, not read). The posts quoted in section 6 are linked there; the checker
  re-fetched all 28 quoted posts and matched every quote and its section heading. TSDR = the owner ("Bracco and I,
  Patrick (TSDR Trading)", 2025-11-23). House, primary.
- Bracco, "The Parabolic Short", https://unchartedterritoryy.substack.com/p/the-parabolic-short. House; no Launchpad
  content.

**Outside**
- TraderLion (account), X thread of 7 May 2022 via Thread Reader,
  https://threadreaderapp.com/thread/1522961878850453505.html. Originator circle; a copy of the thread (high).
- TraderLion, "TL's Key Moving Averages (KMAs)", TradingView, 18 Jul 2021 (updated 16 Aug 2021),
  https://www.tradingview.com/script/p2BuMHPo-TL-s-Key-Moving-Averages-KMAs/. Originator circle; criteria hidden.
- Ameet Rai, "3 Early Entry Techniques To Improve Win Rate", TraderLion, 14 Jul 2024 (modified 10 Oct 2024),
  https://traderlion.com/trading-strategies/3-early-entry-techniques-to-improve-win-rate/. Originator, primary. Read
  through TraderLion's public WordPress API (the page itself challenges non-browser clients).
- Ross Haber, "Launchpad Setup: How I Find Early Entries", TraderLion, 21 Aug 2026 (modified 1 Oct 2026),
  https://traderlion.com/profile/ross-haber/launchpad-setup/. Originator, primary. Read the same way. His "Consolidation
  Pivot: Buying Before the Breakout" (4 Sep 2026) and "21-Day Moving Average Sell Rule: When to Sell a Stock" (28 Aug
  2026) were not read.
- Ameet Rai, "ZIM MarkUp – 2021 Winners", TraderLion, dated 8 Dec 2021 (modified 10 Oct 2024),
  https://traderlion.com/profile/ameet-rai/zim-markup-2021-winners/. Originator; one passing use of "launch pad".
- TraderLion, "The Trader’s Handbook Key Lessons and Review", 21 May 2025,
  https://traderlion.com/trading-books/the-traders-handbook/. Originator (the authors' own firm); confirms the book
  covers launch pads; no definition.
- Deepvue, "The Launch Pad Setup: Your Guide to Early Stock Entry", 21 Sep 2024,
  https://deepvue.com/indicators/launch-pad-the-early-entry-technique/. Originator circle: Deepvue's About page
  (https://deepvue.com/?p=1923, read 2026-11-09) lists Ameet Rai, Richard Moglen and Ross Haber as co-founders, so it is
  not independent of TraderLion. Self-contradicts on the 21-day type.
- Deepvue knowledge base, "Technicals", updated 19 Jun 2026, https://deepvue.com/knowledge-base/technical/. Originator
  circle.
- Nigel, The StratLab, "Understanding the Key Moving Averages Widget", 3 Feb 2026,
  https://thestratlab.substack.com/p/understanding-the-key-moving-averages. Secondary (credits TraderLion).
- BigGuavaTrading, "Launchpad & Slingshot", TradingView, 2 Nov 2025,
  https://www.tradingview.com/script/fXVC2e6a-Launchpad-Slingshot/. Forum level.
- FinancialWisdomTV (written by "Gareth, MBA"), "The Trader’s Handbook: Systems, Setups & Self-Mastery (Part 1)", 24
  Jul 2025, https://www.financialwisdomtv.com/post/the-trader-s-handbook-systems-setups-self-mastery-part-1. Secondary
  summary of Moglen, Schmidt, Haber and Rai, *The Trader's Handbook: Winning Habits and Routines of Successful Traders*
  (Harriman House, 2025, ISBN 9781804090183; book not read).
- StockCharts ChartSchool: "Moving Average Ribbon",
  https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-overlays/moving-average-ribbon;
  "Guppy Multiple Moving Average: An MA Ribbon Designed to Tip the Market’s Hand",
  https://chartschool.stockcharts.com/table-of-contents/trading-strategies-and-models/trading-strategies/moving-average-trading-strategies/guppy-multiple-moving-average-an-ma-ribbon-designed-to-tip-the-markets-hand;
  "TTM Squeeze", https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/ttm-squeeze;
  "The Wyckoff Method: A Tutorial" (Roman Bogomazov and Michael Lipsett),
  https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial.
  Educator (high); used for the psychology only.
- Thomas Bulkowski, "Stages" page, https://www.thepatternsite.com/Stages.html (no update date shown; © 2005-2026).
  Read through a fetch tool (twice by the writer, once more by the checker, same wording) because the site refused plain
  downloads (HTTP 406), so the wording was not checked against the raw page. **The site states a notice against AI use:** "This website, in whole or in part, shall not be
  used to train artificial intelligence (AI) systems, technologies," (as returned by the fetch tool). Cited with a link
  and short quotes only. Study-level numbers, one trader's own trades.
- Kristjan Kullamägi, "3 TIMELESS setups that have made me TENS OF MILLIONS!",
  https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/. Originator; read only to check the
  "Qullamaggie" label (no launchpad there).
- Read, not used: ProRealCode forum, "The Launching Pad Setup" (29 May 2022),
  https://prorealcode.com/topic/the-launching-pad-setup (forum); YakupSabri, "Launch Pad", TradingView, 17 Aug 2025,
  https://www.tradingview.com/script/Qix6nrva/ (forum, open-source code not read); web-search summaries of TraderLion
  and Deepvue pages (one invented a Moglen credit; one turned Haber's 3% stop rule into a 3% spread rule).
- Checker's local copies, quote-match script and re-run scripts (kept outside the repo, in the session scratchpad):
  `setups/07-launchpad/check/` (web copies, Substack copies, `tools/qc.py`, `tools/recheck*.py`).

---

## Removed in checking

Cold check, 2026-11-09. Every item below was in the writer's draft and was removed or corrected because a source or a
re-run did not support it.

1. **TSDR treated as a separate trader.** TSDR is the owner ("Bracco and I, Patrick (TSDR Trading)", Sunday Scans
   2025-11-23), and every Sunday Scans stock quote sits in his section. Sections 2, 3.1, 3.5, 6, 8 and 10 now say so.
2. **Ross Haber's article "not read", nothing used.** It was read through TraderLion's public API (3.8). The draft's
   conclusion that a search engine had invented a Haber "3%" rule was wrong: his 3% is real, but it is the stop
   distance, not the averages' spread.
3. **"The publisher's listing 29 July 2025" for the Handbook.** Not confirmed; listings disagree on the date. Removed;
   the full title and ISBN are kept (confirmed by several retail listings; the subtitle also by the secondary summary).
4. **Deepvue as an independent "reputable educator and data source".** Its About page names three TraderLion people
   as co-founders. Reclassified as the originator circle.
5. **The [source consensus] tag on rule 5 (bundle within 3%).** Deepvue and StratLab measure different things and both
   trace to TraderLion. Retagged [UCT] measured + [my proposal].
6. **The TWLO entry as "next day over the launch-day high (TSDR's weekly TWLO entry)" and the KB's date for it.** The
   owner's own post (2025-11-30) says he bought "on Monday over Friday’s high", i.e. over the prior day's high; KB 4827
   carries a wrong date (2025-11-23). Re-mapped to the intraday trigger.
7. **Deepvue's "Long above the range" listed as a buy inside the pad.** It is a break of the range. Removed from that
   list.
8. **Per-ticker stop distances** MSTR 8.4%, LYFT 9.8%, EXE 6.5%, RYTM 6.4% and the range top 9.8%. Re-run as a share of
   the close: MSTR 8.5%, LYFT 9.9%, EXE 6.4%, RYTM 6.3%, top 9.9%. Also: fall range -13% to -34% (not -35%), close in
   range 0.95 / 0.91 (not 0.9 / 0.9), base-low stop for cuts 11.6% (not 11.7%), good-grade ATR 2.6% (not 2.5%).
9. **"Bank rows ... required no close under the launch low within 20 sessions."** The finder's `works` test is: no low
   more than 1% under the launch-day low within 20 sessions, an 8% gain, and up at +10 and +20 sessions. Corrected.
10. **"Every launch the house finder accepts" (4.3 c).** The re-run used the finder's gates and liquidity but replaced
    its 2019-onward window check with a 40%-move data filter and dropped `works`. Now described as such.
11. **"About 7 ... (12%) ... 12% to 13% at every score level" (4.3 e).** Exact: 7.6 to 1 (11.6%), and 11.6% to 13.1% at
    every minimum score from 9 to 16.
12. **"The journal's grade list is A+, A, B, C, F."** That list (`GRADES` in `setupGroups.js`) is used by the Model Book
    pages, not the journal.
13. **"TRADE_PLANS.md already says the setup review follows B19."** It is the rulebook's B19 that says so.
14. **The textbook check's "an up day".** The code tests a close at or above the open.
15. **"pinch" as a search alias.** The alias is "pinched"; "pinch" is the scanner's label.
16. **A3/F62 attribution.** The words "or the prior day's low" are A3's, not F62's.
17. **"Best in Orange or Red markets (D46)" for the short.** D46 covers Red only; Orange is now marked [my proposal].
18. **Rule 6's "25 of 26 kept".** 25 is the launch-day count; on the day before (the table's stated check day) it is 24.
19. **Rule 10's "within a few days".** Not measurable; now "within the next 3 sessions" [my proposal].
20. **"His definition" / "his 56 bank charts" (8.2).** The close-as-launch wording is the bank lesson written from his
    rulings; the 56 are the bank's Yes charts, not all his reviews.
21. **"study_trade.py ... looser than the code".** It is a plain-words version of the same quarter-ATR buffer.

Confirmed unchanged (spot list): every owner verdict quote (lines 72-117) and grade; the bank lesson and playbook
quotes; every KB quote (KB 4827's date aside, item 6); all 40 Substack quotes in the draft, with their dates and
signers; every outside quote (TraderLion thread,
KMA script, Deepvue, StratLab, BigGuava, FinancialWisdomTV, ChartSchool x4, Bulkowski, Qullamaggie); the scanner,
member-tag, Chart IQ and finder code summaries; the 4.2 tables (evidence, evidence_kept, evidence_atlas, ATLAS.md);
the 4.3 (a) kept-vs-cut medians and counts, the A13, C28 and C29 counts, the 4.3 (c), (d) and (e) tables, all re-run
or recomputed from the scan outputs by the checker.

---

## 12. Examples (from our data)

**The scan's rule (one paragraph).** Daily bars from the local sandbox, the 2,630 names that ever met the house
liquidity rule (close $10 or more, 50-day average dollar volume $20 million or more; B23). Checked on the day before
the launch: the lowest close of the last 60 sessions at least 15% under the highest high of the 60 sessions before
that (rule 2); at least 25 of the last 40 closes within 10% of the bundle's middle and the last 30 closes spanning no
more than 20% of price (rule 3); at least 10 of the prior 40 closes under the lowest of the 8 EMA / 21 EMA / 50 SMA and
fewer than 20 above the highest (rule 4); the three averages within 3% of price of each other (rule 5); the 200-day
within 10% of the bundle's middle (rule 6). The launch bar: the first close above all four averages after a close that
was not (rule 7; B26), up 2% or more, close in the top 35% of its range, volume 1.2x or more its 50-day average (rule
8), opening no more than 6% above the prior close (rule 9). The stack (8 > 21 > 50) is recorded, not required (rule
10). Earnings (rule 11; B22): any hit with an earnings reaction day on the launch day or the next 3 sessions was
dropped after the scan (447 of 2,864), using the sandbox's Yahoo + SEC 8-K dates, which are complete from about 2005.
The trade is the house trade from 8.2 and 8.3: a market order at the launch-day close (E57), the stop 5 cents under the
launch-day low (A3), skipped if that stop is more than 6% away (the 8.3 cap) or the close is more than 10% over its
10-day SMA (C29); the C28 chase limit is recorded as the close's distance over the top of the averages. Any name with a
close-to-close move over 40% inside the base or the forward window was skipped as broken data (unadjusted splits,
reused tickers). Code: `scratchpad/setups/07-launchpad/lp_rule.py` and `pick_lp.py` (not in the repo).

**Base rate.** 2,630 of 2,630 liquid names scanned (the scan finished inside its budget). Hits run from 1996 to 2026
(the first year a name clears the liquidity rule with 260 bars of history). After the earnings filter: **2,417 hits;
26.6% reached 3R and 14.6% reached 5R** before the stop, within a 60-session window (before the filter: 2,864 hits,
26.3% and 14.3%). This is a fixed stop under the launch-day low with no trims, no breakeven move, no trail and no
time stop, so it is a floor for the setup, not the house plan's result. The 967 hits that were already stacked
(8 > 21 > 50) on the launch day reached 3R 23.9% of the time, so the stack on the day adds nothing here (consistent
with 4.3 d). Hits are dense in 2021-2026 (1,090 of 2,417) because the liquid universe is larger then.

**The 10 examples** (charts and the three phone sheets in `scratchpad/setups/07-launchpad/final/`; one per ticker,
ten different years; buy = the launch-day close; stop = 5 cents under the launch-day low; best R = the highest high
within 60 sessions, in R, before the stop was touched; the structure numbers are the day before the launch).

| # | ticker | launch day | correction | 8/21/50 width | 200-day from bundle | closes under / above bundle (of 40) | launch day: change, close in range, volume | buy | stop (%) | best R | why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | KBH | 2004-09-01 | -24.8% | 2.91% | 2.6% | 15 / 13 | +2.5%, 0.94, 1.27x | 35.26 | 34.26 (2.9%) | 11.2 (3R in 7 sessions) | a 4-month correction, two months of closes around a flat 200-day, the averages pinch to within 3% and the launch closes above all four; stacked on the day |
| 2 | CME | 2005-05-16 | -26.2% | 1.82% | 3.9% | 22 / 9 | +3.6%, 1.00, 1.19x | 39.60 | 38.61 (2.5%) | 23.6 (3R in 5) | after a 26% correction the stock sat under a tight bundle on top of a rising 200-day; the launch closes at its high; volume is a hair under 1.2x (1.19x rounds up in the scan), the one soft spot |
| 3 | RMD | 2006-10-24 | -21.1% | 0.95% | 5.1% | 23 / 2 | +4.3%, 0.84, 1.87x | 21.41 | 20.91 (2.3%) | 11.3 (3R in 12) | two months of closes UNDER a converging bundle, a flat 200-day just above, then one wide bar through all four on 1.9x volume; not stacked on the day, stacked within 3 |
| 4 | AIZ | 2013-01-14 | -15.4% | 0.87% | 2.3% | 20 / 4 | +2.0%, 1.00, 1.24x | 36.92 | 36.15 (2.1%) | 14.2 (3R in 13) | the smallest launch bar of the ten (+2.0%, the floor of rule 8) out of a very tight pad; the 200-day flat and 2% away; a slow, steady trend along the 8 and 21 EMAs afterwards |
| 5 | CMC | 2016-11-04 | -19.6% | 0.72% | 2.4% | 18 / 15 | +4.1%, 0.79, 1.85x | 16.69 | 16.01 (4.1%) | 11.7 (3R in 3) | a long, shallow base with the 200-day right under the bundle; the launch bar is wide on 1.85x volume; 3R in three sessions (earnings were 6 sessions earlier, not on the launch) |
| 6 | MSCI | 2017-01-04 | -15.0% | 1.32% | 0.8% | 18 / 3 | +2.5%, 0.81, 1.46x | 80.71 | 79.03 (2.1%) | 17.0 (3R in 20) | the 200-day is inside the bundle (0.8% away): all four averages in a 2% band for weeks, then a quiet +2.5% launch; the slow kind of pad, 3R took 20 sessions |
| 7 | ILMN | 2020-12-01 | -33.6% | 0.68% | 4.9% | 20 / 5 | +3.8%, 0.84, 1.36x | 325.23 | 313.76 (3.5%) | 18.8 (3R in 15) | the deepest correction of the ten (-34%), then two months of closes under a 0.7%-wide bundle near a flat 200-day; the launch close is 8.6% over the 10-day, inside the C29 limit but a learner should see it is stretched |
| 8 | RL | 2023-11-14 | -19.3% | 0.53% | 2.5% | 23 / 11 | +4.4%, 0.82, 1.30x | 120.44 | 117.02 (2.8%) | 16.9 (3R in 11) | the tightest bundle of the ten (0.53%) sitting on the 200-day; the earnings reaction was 4 sessions earlier (2023-11-08) and did NOT clear the averages; the launch is the follow-through bar that did |
| 9 | DDOG | 2024-10-04 | -22.1% | 1.66% | 5.8% | 11 / 7 | +4.4%, 0.97, 1.63x | 122.69 | 118.32 (3.6%) | 10.8 (3R in 33) | a growth leader; the launch closes near its high, then the stock dangles along the 21 EMA for four weeks (the retest the originators buy) before the run; 3R took 33 sessions, yet it was over 1R inside 10 days so the C33 time stop would not have fired |
| 10 | BABA | 2025-01-24 | -31.6% | 1.86% | 1.0% | 26 / 0 | +3.5%, 0.98, 1.33x | 89.14 | 86.43 (3.0%) | 21.9 (3R in 3) | 26 of 40 closes under the bundle and none above it, the 200-day 1% from the bundle, the launch closes at its high; not stacked on the day (the 50 was still on top), stacked within 3 sessions |

All ten reached 5R before the stop. None has an earnings reaction day on the launch day or in the next 3 sessions
(each name has 30 to 100 report dates in the sandbox, so the check is real, not a blank). KBH (2004) is the one chart
before the earnings file is complete; its nearest known reports are 2004-06-17 and 2004-09-22, both outside the window.

**Notable failures (in words).** The scan's failures look exactly like its winners on the launch day; what differs
is what came next.
- **BA, 2021-11-15.** A 20% correction, a 0.7%-wide bundle, a +5.5% launch on 2.55x volume closing above all four
  averages: every box ticked. It traded through the stop (2.7% under the close) the NEXT session and kept falling. A
  launch out of a pad in a stock that was not a leader (BA had spent two years in a downtrend) is still a launch by
  the rules; rule 12 (a stock he would trade) is the only line that would have kept a learner out.
- **CMCSA, 2017-12-04.** A 16% correction, a 0.8% bundle, +4.9% on 2.17x volume. Stopped two sessions later. A
  big-volume launch in a slow large cap, the kind of name the FITB ruling warns about.
- **NEE, 2025-03-10.** A 22% correction, a 0.7% bundle, +4.6% on 2.36x volume, the stop 4.9% away (near the 6% cap).
  Stopped two sessions later. The wide stop meant a small position, which is the point of A5: the rule's job was to
  keep the loss at 1R, and it did.
- **TEAM, 2021-04-30** (a different date from the owner's kept TEAM chart): +4.1% on 2.13x volume, stopped the next
  session.

Reading these: a launch bar with 2x or more volume was not a protection (11 of the owner's 26 kept charts had 2x, and
so did these four failures). The base, the leadership of the stock and the market reading carry the edge, as 8.8
point 10 says; the launch bar is the timing.

## 13. Failures and near-misses (from our data)

The same scan and the same trade as section 12 (buy at the launch-day close, stop 5 cents under the launch-day low,
60 sessions forward, fixed stop). Four valid launchpads that stopped before 3R, one per ticker, four different years,
and four bars that look like a launchpad but fail exactly one gate criterion of the card
(`criteria/07-launchpad.json`). Charts: `scratchpad/setups/07-launchpad/final/fail_1-4.png`, `near_1-4.png`, and the
confusable pair against the Flat Base in `pair_01-flat-base.png`. Code: `near_scan.py` (the scan with each gate
relaxed to a band just outside the rule, keeping the hits that fail one gate only) and `fail_near.py`.

**Failures: valid by every gate, stopped by the rules.**

| ticker | launch day | buy | stop (%) | where it stopped | what happened | criterion |
|---|---|---|---|---|---|---|
| BA | 2021-11-15 | 233.09 | 226.87 (2.7%) | day 1, 2021-11-16, low 225.51 | a 20% correction, a 0.72% bundle, +5.5% on 2.55x volume above all four averages. The next session traded through the launch low and closed at 225.80; the low within 10 sessions was 193.85. BA had been in a downtrend for two years. | lp.tradeable_name |
| CMCSA | 2017-12-04 | 37.79 | 36.89 (2.4%) | day 2, 2017-12-06, low 36.13 | a 16% correction, a 0.83% bundle, +4.9% on 2.17x volume. One flat day (high 37.85, 0.07R), then two red days back into the bundle. A big-volume launch in a slow large cap. | lp.tradeable_name |
| NEE | 2025-03-10 | 76.16 | 72.43 (4.9%) | day 2, 2025-03-12, low 71.78 | a 22% correction, a 0.68% bundle, +4.6% on 2.36x volume closing at 0.97 of its range. The stop was 4.9% away, near the 6% cap, so the position was small; the loss stayed at 1R. The low within 10 sessions was 68.42. | lp.stop_cap |
| FDX | 2010-07-26 | 67.20 | 66.03 (1.7%) | day 1, 2010-07-27, low 65.92 | a 28% correction, a 2.95% bundle (at the 3% line), +5.6% on 1.83x volume. The launch opened 4.2% up (inside the 6% line) and its whole range was 66.08 to 67.40, so the honest stop was 1.7% and sat inside the noise; the next session traded through it. The stock reached 71.28 on 2010-09-30 without us. | lp.not_gap |

**Near-misses: one gate fails, everything else passes.**

| ticker | bar | the one criterion that fails | the number | what it really is |
|---|---|---|---|---|
| MSFT | 2023-10-06 | lp.correction | the lowest close of the last 60 sessions is 11.2% under the prior 60-session high; the rule needs 15% or more | a shallow pullback in an uptrend over a rising 200-day (7.5% away); a moving-average pullback (setups 11 and 12), not a pad. It went to 5.2R, which is the pullback's edge, not the launchpad's |
| AAPL | 2013-08-13 | lp.bundle_tight | the 8, 21 and 50-day span 5.77% of price the day before (16.66 to 15.49 against a 16.80 close); the rule is 3% or less | the averages had not converged; a +4.8% breakout on 2.78x volume through a loose bundle under a falling 200-day. A rally bar, not a launch |
| JPM | 2016-05-18 | lp.under_bundle | 3 of the last 40 closes under the bundle and 18 above; the rule needs 10 or more under | price rode on top of the averages after the February low; a pullback breakout (the lp.inv_pullback_breakout shape), not a pad |
| AAPL | 2022-11-30 | lp.launch_above_all | the bar closes at 148.03, above the 8/21/50 (top 146.83) but under the 200-day (154.21); the launch must clear all four | a bundle reclaim under a falling 200-day after a 23% correction; +4.9% on 1.25x volume. Stopped on the way to the December low |

**What the failures have in common.** All four stopped within two sessions. On the launch bar nothing separated them
from the ten winners: +4.6% to +5.6% on 1.8x to 2.6x volume, closes in the top third of the range, above all four
averages, three of the four already stacked 8 over 21 over 50. What differed is the stock and the bar's anatomy: BA,
CMCSA, NEE and FDX are slow large caps, three of them out of a long downtrend, and FDX's launch was mostly a gap with a
stop inside the day's noise. The rules that would have kept a learner out are the ones that are not on the launch bar:
a stock he would trade (lp.tradeable_name), the stop cap and the size it forces (lp.stop_cap), and the gap line
(lp.not_gap). The stop did its job every time: four losses of 1R each, none worse.

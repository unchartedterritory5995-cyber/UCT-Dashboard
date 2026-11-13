# Setup 39: Parabolic Short (short)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
file or post named next to it and kept to 40 words or fewer. The quotes were checked word for word by a script against
the saved page text (section 11 lists what was saved). Nothing here is a ruling. Where I could not read a source, I say so
and give no wording from it. Numbers marked [my proposal] are mine, for the owner to accept or change. Numbers marked
[measured] come from my own test in section 4.2.

Tags used in section 8: **[originator]** the named setup's author in his own words; **[source consensus]** several
outside sources agree; **[UCT]** UCT's own writers (Bracco, the owner); **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation; **[measured]** my own test. A single outside
trader other than the originator is tagged by name (Stamatoudis, Stockbee); **[secondhand]** marks Breitstein, known here
only through a summary.

**Flags before reading.**
- The owner ruled that Bracco's post defines "parabolic" for the 200-day rule (B26; `owner_verdicts.jsonl`, 2026-11-09:
  "read bracco's substack post to determine a parabolic short and long"). So Bracco is the house definition here, and
  Kullamägi is the outside originator.
- Thomas Bulkowski's site (thepatternsite.com) states that it "shall not be used to train artificial intelligence (AI)
  systems". I read and cite it for research only, with a link and short quotes. His server refuses plain requests, so his
  quotes came through a fetch tool and are as that tool returned them.
- TraderLion blocks plain requests and the fetch tool. I read its two articles from the Internet Archive copies (links in
  section 11). IBD's column was read through a fetch tool on its Yahoo Finance syndication.
- Lance Breitstein: I read only a third-party summary of his chapter in Schwager and Coyle's *Market Wizards: The Next
  Generation* (2026). I did not read the book. Treat his rules here as secondhand.
- The session's web-search budget ran out part way through. After that I only read pages whose address I already had.
  Section 3.13 lists what I could not look for.
- The repo's brain-KB files (`docs/study/levels/brain_kb_*.json`) hold machine summaries of Bracco's Discord posts. I
  quote them only as summaries, never as his words.
- Same question as dossier 27: this public repo now quotes short Sunday Scans passages. Question 14 asks if that is fine.
- **Cold check (2026-11-09, second pass by a different session).** Every quote below was re-matched by script against
  freshly downloaded copies of the pages (the Substack posts, qullamaggie.com, StockCharts, kelltrading.com, Stockbee,
  the archive.org TraderLion copies, the NBER abstracts, the CTE sheet) and against the repo files; Bulkowski's and IBD's
  pages were re-read through a fetch tool; both of Bracco's extension-table images were downloaded from the posts and
  re-read; the publish dates of every cited post were read from the page metadata; the scanner summary in section 5 was
  checked line by line against the code; the proxy facts in 4.2 were recomputed from the saved event file. What was
  changed or removed is listed in section 12.

**The short version.**
- A parabolic short sells a stock that has gone nearly vertical, on the day the run exhausts itself and turns, and covers
  on the snap back to the short moving averages. Kullamägi named it one of his three setups (2021). Bracco wrote UCT's
  definition (2025-06-13) and calls it his "bread and butter".
- Bracco's rule set is specific: a 3 to 5 day "parabolic burst" (straight up days, gap ups, growing daily gains, growing
  volume), then a climax day that **must** open with a gap up; short only after the stock breaks under VWAP intraday;
  stop at the day's high; target the daily 9-day EMA. He day-trades most of it.
- Our app's scanner (`parabolic_short.py`) does not test Bracco's rule. It fired on only 3 of his 6 five-star examples,
  48 times in liquid stocks from 2000 to 2026, and its levels put the stop a median 43% away from the entry. Its narrative text
  invents quotes and statistics and attributes them to Kullamägi (section 5.5). It should be rewritten.
- My test on 30 years of daily bars: the broad version (stretched, 3 of 4 burst boxes, gap up, red close) gained a mean
  of +0.54R covering at the 9 EMA, with a range that includes zero. The strictest cuts (Bracco's table averages, a climax
  gap of 5% or more, all four boxes, year-high volume) were better, on small samples. Shorting before the crack (a green
  climax day) won only 23% of the time. On hourly bars (late 2023 to 2026) my rough VWAP entry showed no edge.
- The setup collides with the rulebook in known places: it lives far above the 200-day (B26 allows it), its honest stop
  is usually wider than 3% (A13), it has its own target (the 9 EMA, which D47 already names) instead of the 3R/5R trims,
  and it happens in hot Green markets, not Red ones.

---

## 1. What it is, and the psychology

**In two sentences.** A stock that has already made a large move goes vertical for a final 3 to 5 days, on rising
volume and gap ups, and then opens one more time with a gap up and reverses during that day. The trader shorts the
reversal (not the rise), with a stop above that day's high, and covers when the price snaps back to the short moving
averages, usually the 9-day EMA.

**Why it works, when it works.**
- **The rubber band.** Kullamägi: "Think of stocks as rubber bands, if they get really stretched short term, they can have
  powerful snapbacks." ([qullamaggie.com, 2021-01-08](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/)).
  Bracco uses the same picture: "Picture a rubber band: the more you stretch it, the harder it snaps back."
  ([UCT, 2025-06-13](https://unchartedterritoryy.substack.com/p/the-parabolic-short)).
- **Reflexivity.** Bracco explains the run with George Soros's reflexivity: rising prices feed belief, belief feeds buying.
  When the story meets a test, the loop runs backwards: "When the optimistic perception falters, participants begin to
  panic sell, triggering a sell off." The test can be "a disappointing earnings report, short report, negative
  news/catalyst, or heavy selling pressure."
- **Who is trapped.** The climax day's gap up is bought by the last, most emotional buyers. Bracco's U-Turn describes it:
  the open "lures in chasers, creating the illusion of another explosive up day." When the stock falls back under the
  day's average price (VWAP), every share bought that morning is under water. On his day-2 variant he writes: "The gap
  down the following day is key, as longs from the previous close are underwater and short sellers take advantage."
- **Who has already lost.** The early shorts. Kullamägi: "Let the amateur shorts get run over, that’s where your edge
  comes in." Their forced buying is part of the fuel. Bracco (2025-12-28): "Early and stubborn short sellers capitulating
  only adds fuel to the fire."
- **Who sells into it.** Holders taking profits, and in options-driven runs, dealers unwinding hedges. Bracco on the
  unwind: "Call buying slows, options expire, or hype fades, reducing gamma and prompting market makers to sell shares."
  The Wyckoff school calls the top a buying climax: "The force of buying reaches a climax, with heavy or urgent buying by
  the public being filled by professional interests at prices near a top."
  ([StockCharts ChartSchool, Wyckoff tutorial](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial)).
- **Why the target is a short average.** After a vertical run, the 9 and 10-day averages sit far below price but rise
  quickly toward it. A sharp fall meets them within days. My test found the 9 EMA was reached within 10 sessions in about
  9 of 10 proxy events (section 4.2), but that is partly mechanical: the average climbs toward the price.

**Why it is dangerous.** Bracco: "Parabolic Shorts are never the consensus." And: "Being too early to a Parabolic Short
is a recipe for disaster." Bulkowski measured that a vertical run keeps climbing right away 21% of the time and makes a new
high within three months 78% of the time (section 4.1). A short has no ceiling on its loss, and squeezes cluster in exactly
these stocks.

---

## 2. Origin and naming

- **The old idea: the climax top.** The blow-off top is far older than the name. The Wyckoff school's "buying climax"
  (BC) marks the end of an uptrend (section 3.7). IBD's selling column calls a 25% to 50% run in three weeks or less after
  a long advance "the hallmark of a climax top" (section 3.8). The classic "exhaustion gap" appears at the end of a trend
  ([StockCharts ChartSchool, Gaps and Gap Analysis](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/gaps-and-gap-analysis)).
  These are sell signals for owners, not short entries.
- **The named short setup: Kristjan Kullamägi (Qullamaggie).** His post "3 TIMELESS setups that have made me TENS OF
  MILLIONS!" (qullamaggie.com, published 2021-01-08, updated 2021-04-28) lists "The Parabolic short (or long)" as the third
  of his three setups. His FAQ (2021-04-27) repeats: "I trade 3 setups only (and a few varations of those setups)." This is
  the earliest named, written definition I found.
- **UCT's version: Bracco.** "The Parabolic Short", UCT Substack, 2025-06-13, signed "- Bracco" (page description: "Bracco
  (@braczyy on X) - June 13th , 2025"). He coined the terms he uses: "This is a term I created to help identify and time a
  Parabolic Short correctly" (the parabolic burst); the "U-Turn"; the "Long-Drawn-Out Range Breakdown"; and later the name
  "day 2 gap down" (Sunday Scans 2025-12-28) for the gap-down top formation his 2025 post already describes. He grades
  setups on a five-star scale. He credits Lance Breitstein for the "Right Side of the V" entry idea and the
  previous-bar-high trail and Steven Place for the 20-delta call gauge (both in the 2025 post), and Jeff Sun for the
  ATR-multiple indicator (Sunday Scans 2025-09-21 and 2026-05-10; the 2025 post does not name him).
- **Other names.** Blow-off top short; climax top short; exhaustion gap short (Breitstein, per the summary in 3.4); the
  "Exhaustion Extension" (Oliver Kell, step 5 of his cycle, used as a sell signal, 3.6); vertical run up (Bulkowski,
  3.9). In our app: "Parabolic Short" (`parabolic_short.py`), "Parabolic Extension" (screener), "Climax / exhaustion" (Chart
  IQ), "Parabolic short (failed parabolic)" (voice knowledge base).
- **Not the same thing:** Welles Wilder's Parabolic SAR indicator. The word is shared; the idea is not.

---

## 3. Every definition I could find, source by source

### 3.1 Bracco (UCT), "The Parabolic Short", 2025-06-13 (the house definition; read in full)

[unchartedterritoryy.substack.com/p/the-parabolic-short](https://unchartedterritoryy.substack.com/p/the-parabolic-short)

- **Who it is for.** "While this setup is more common in small caps, I prefer mid-to-large cap stocks." And: "The best
  Parabolic Shorts present themselves on very rare occasions. You’re lucky to get a couple 5-star candidates a year."
- **Step 1, the curve.** Parabolic, not linear. "A parabolic curve is defined by an exponential, rapidly accelerating price
  surge that forms a steep, upward arc, while a linear curve exhibits steady, consistent price movement over time". He
  looks at the bases and the pullbacks: "Ideally, consolidation periods shorten as the price surges higher, with minimal
  pullbacks, signaling accelerating momentum." His linear counter-example (AAPL, late 2023): "This steady, controlled
  ascent, which you should avoid for Parabolic Short setups, reflects sustained strength and can persist for an extended
  period." And the range: "Another defining characteristic of a parabolic curve is the significant expansion in both price
  and Average True Range (ATR) as the trend accelerates."
- **Step 2, the parabolic burst.** "This parabolic burst is a 3-5 day move that marks the final leg of a parabolic move."
  His five boxes:
  1. "Three straight days of gains. The more consecutive up days, the better the setup."
  2. "Two consecutive overnight gap ups. This can include the exhaustion gap on the climax day. Unfilled gaps left behind is
     a bonus."
  3. "Two out of three days of range expansion, where the percentage gain is larger than the previous day. Ideally
     consecutive range expansion days."
  4. "Two days of volume expansion, with each day’s volume higher than the last."
  5. "A gap-up on the climax day. You never know exactly when the climax day will hit, but I won’t short without that
     gap-up." And: "(The climax gap up typically takes place on day 3 to 5 of the move.)"
  - How strictly: "While not every criteria needs to be fully satisfied, the more boxes checked, the stronger the setup."
    An exception he allows: "a stock might only have two consecutive up days before the climax, but if the two day move
    shows significant short-term price and ATR expansion, it remains a viable candidate".
  - Note his box 3 defines "range expansion" as a larger percentage gain, not a wider high-to-low range.
- **His five-star examples** (climax dates as he gives them): SMCI 2/16/2024, NVDA 3/8/2024, MSTR 11/21/2024, TIGR
  10/7/2024, MRNA 12/1/2020, PLUG 3/11/2014. All checked on our bars in 6.6.
- **Step 3, the climax day.** "the first requirement is a significant overnight gap-up, typically occurring on day 3 to 5
  of the Parabolic Burst". Then one of three intraday patterns:
  - **Quick Opening Range Breakdown** (least liked): it "occurs at market open when the day's high is set on the first
    5-minute candle, with an entry triggered by a breakdown below the 2- or 5-minute opening range." He warns "it often
    appears on day 1 or 2 of the Parabolic Burst".
  - **The U-Turn** (his favorite): "My preferred intraday setup, which I dubbed the “U-Turn,” is the most prevalent intraday
    short setup on the climax day". The gap up runs higher at the open, then "typically 10 to 60 minutes after the market
    opens, sellers emerge, and the stock starts to reverse. The first entry is triggered by a breakdown below VWAP,
    followed by a second short opportunity when the stock breaches the day’s lows."
  - **The Long-Drawn-Out Range Breakdown**: it "occurs when a stock forms a tight trading range during the first one to two
    hours of the session." He sees it "more frequently in 3- or 4-star Parabolic Short setups that don’t fully meet all
    criteria."
- **Entry discipline.** "For a parabolic short, I am always waiting until the intraday trend flips to the downside. I will
  never take an entry until the stock at least breaks below the intraday VWAP". And: "Shorting at the day’s highs can be a
  dangerous trap". The idea is Breitstein's "Right Side of the V": "This strategy refers to entering a trade after a
  stock's price reverses from a sharp incline or decline (forming a V-shape)".
- **Size of the move.** On the climax day itself: "think 5-15% for large caps and 20-30% for mid- or small-caps". His aim:
  "I’m just focused on capturing the easiest part of the move with conviction and size."
- **Pyramiding (adding as it goes against you).** "I haven’t explored pyramiding myself but may study it further in the
  future, as waiting for the intraday trend is more suitable for my style."
- **Target.** "My target for a Parabolic Short is consistently the 9-day exponential moving average (9EMA), which my
  studies show acts as a magnet for mean reversion". "Every parabolic short I’ve analyzed reaches the daily 9EMA before any
  counter-trend rally emerges, though holding until it hits isn’t mandatory". "Once the 9EMA is tested on the backside of
  the move, I consider the Parabolic Short complete".
- **Stop.** First entry under VWAP, "setting my initial stop at the day’s high, as my thesis assumes the trend has reversed
  and the top is in." "If the price reclaims the day’s high, I deem my thesis or timing incorrect and exit the trade." On
  the distance: "While this can be challenging when the day’s high and VWAP are far apart, they’re typically close enough
  to manage."
- **Trail.** "Once fully positioned, I adjust my stop from the day’s high, trailing it at the previous 5-minute bar highs
  and either the 5-minute 20EMA or VWAP". Detail: "After getting full sized on the short position at the day’s lows, I
  trail most of my position at the previous 5-minute bar high" (Breitstein's "Previous Bar High" method).
- **Volume at the open.** "Leading up to a Parabolic Short, opening volume typically rises consecutively over several
  days, with the climax day almost invariably showing the highest opening volume of the entire run."
- **Helpers (conviction, not triggers).** Bollinger Bands: "A price breach above the upper Bollinger Band or below the
  lower band is typically short-lived, often foreshadowing a counter-trend snap back move". Options: "These moves often
  peak or unwind on Thursdays or Fridays, especially right before or on monthly option expirations". Steven Place's gauge:
  "He suggests tracking the distance between the 20-delta call strike and the underlying stock’s price." A widening
  distance means the squeeze is alive (do not short); a narrowing one means it is fading.
- **Vehicles.** He used 0DTE puts (SMCI, NVDA), puts plus the inverse leveraged ETF MSTZ (MSTR). For learners: "for
  beginners, shorting equity is the simplest way to learn the Parabolic Short setup".
- **Extension metrics.** A table of seven large caps, "detailing their extension metrics from the close before the climax
  day", with averages: 8.81 ATRs above the 50-day, 21% above the 9 EMA, 37% above the 20 EMA, 77% above the 50-day, 172.5%
  above the 200-day (the table is an image; I read it directly). He adds: "While no single extension metric is universally
  reliable, the table below serves as a valuable guide". The warning: "a frequent mistake I notice among traders is
  relying solely on a stock’s percentage gain, overlooking its chart structure and formation." What matters is "the
  steepness and intensity of that final parabolic leg".
- **The other top (day-2 gap down).** "Sellers lack the strength to push it lower, and it closes near the middle or high of
  the day’s range. Then the stock gaps down the next day, and that is usually the nail in the coffin." "Usually any opening
  range breakdown and failure to fill the gap begins the backside of the move and can be traded back to the daily 9EMA."
  "I do not typically engage in this setup for reasons stated above". His examples: DJT 10/29/2024, FUTU 10/7/2024, TASR
  (now AXON) 4/19/2004, TSLA 2/4/2020, CGC 2/10/2021, UVXY 8/5/2024.
- **His Kullamägi quote.** He writes that Kullamägi says: "Unlike long setups where you can score a 20-30x risk-reward,
  parabolic shorts typically offer a 5-10x risk-reward." I could not find those words on Kullamägi's site. His post says
  "30-50x+" for breakouts and EPs and "5-10x" for this setup (3.3). The point is the same; the wording and the first number
  differ.

### 3.2 Bracco (UCT), later posts (refinements; read in full)

- **The checklist, five points** ([Sunday Scans 2025-09-21](https://unchartedterritoryy.substack.com/p/sunday-scans-88a)):
  "The key things I look at when a parabolic short is setting up are:" "1. Parabolic vs linear price progression" "2. A
  parabolic burst" "3. Relative volume" "4. % extensions from moving averages" "5. ATR multiples from 50ma". On OKLO:
  "On Friday OKLO triggered a 10x ATR multiple reading above the 50ma, represented by the red dot." On the climax volume:
  "When you see that signifigant of a volume spike after a massive move up, it likely signals exhaustion or climax
  behavior." On a stock just out of a base (RGTI): "This trade would be very short lived if it set up, not something I am
  looking to hold for days or weeks."
- **Range and volume first** ([2025-12-28](https://unchartedterritoryy.substack.com/p/sunday-scans-249), silver): "The first
  two big things you want to focus on when it comes to identifying a parabolic advance are range and volume expansion,
  specifically occurring after an already large move higher." "In my studies I have found most parabolic bursts to last
  anywhere from 3-5 days." "The more parabolic the chart becomes, the more linear the outcome, either continuation or sharp
  reversal."
- **Execution** (same post): "I personally like to day trade a very concentrated position as swinging too much exposure
  overnight without enough cushion is a dangerous game". The climax day "typically begins with a large gap up that trades
  a ton of volume in the first 5-15 minutes." On variants: "for a full sized trade I am really only interested in a gap up,
  climax short setup. Any other variation may be taken with smaller size." Target: "My target on the parabolic short is
  always the 9 or 10 day exponential moving average." Exits: "I will look to scale out into weakness and potentially swing
  some exposure overnight if the risk is paid for".
- **Weekly range expansion** ([2026-05-10](https://unchartedterritoryy.substack.com/p/sunday-scans-68a)): "One
  characteristic that is extremely important when identifying a parabolic advance is consecutive weeks of range
  expansion." "The cherry on top is a signifigant range expansion week on the 3rd or 4th week of the burst, which is
  typically the final week of the move."
- **The extension formula** (same post): "I studied their ATR multiples from 50MA the day before the peak as well as the %
  extension above specific moving averages." "ATR multiples above the 50MA from Jeff Sun beat simple percent gains because
  they adjust for the stock’s unique volatility." His 2026 table (an image I read) has averages of 17.01 ATR multiples,
  22.88% above the 9 EMA, 40.62% above the 20 EMA, 85.25% above the 50-day and 191.88% above the 200-day. **His 2025 and
  2026 tables give different ATR multiples for the same stocks** (NVDA 7.98 then 12.6; SMCI 9.88 then 25.67). I found why
  (4.2, the two formulas): they are two different formulas.
- **Round numbers, log scale, adding** ([2026-01-25](https://unchartedterritoryy.substack.com/p/sunday-scans-7fb)): "most of
  these climax points occur around very obvious, round numbers." "Silver is even appearing parabolic on a logarithmic
  scale". On adding: "parabolic advances often go further than anyone thinks. For that reason, I never add when I am down
  and always pyramid into weakness as the price validates my conviction." (This is adding to a winner as it falls; the
  2025 post's "pyramiding" meant adding against the trend. They do not conflict.)
- **What a top looks like at market level** ([2025-09-28](https://unchartedterritoryy.substack.com/p/sunday-scans-9a2)):
  "This climax usually consists of huge reversal bars at the high on major volume, signaling buyers capitulating."
- **Long versus short** ([2025-09-21](https://unchartedterritoryy.substack.com/p/sunday-scans-88a)): "it will always be more
  worth it to be long into a parabolic move, than to catch the short side of it."
- **What it is and is not** ([2026-05-10](https://unchartedterritoryy.substack.com/p/sunday-scans-68a)): "the parabolic short
  is an extraordinarily high-probability mean reversion opportunity, that can sometimes lead to secular tops, but not
  always."

### 3.3 Kristjan Kullamägi (Qullamaggie), the originator (read in full)

"3 TIMELESS setups that have made me TENS OF MILLIONS!", [qullamaggie.com](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/),
2021-01-08 (updated 2021-04-28).

- **Prior move.** "A stock up 50-100%+ in a few days or weeks (if larger cap) or 300-1000%+ (if smaller cap)."
- **Run of days.** "The stock should be up 3-5+ days in a row." And: "Many times you have examples where a stock trends
  higher for weeks or months and then starts speeding up, some just explode from nowhere."
- **Entry (intraday, on the day).** "When you think you have identified a candidate you can short on the opening range lows
  (1-minute, 5-minute candles). You can wait for the first red 5-minute candle in case the stock goes straight up from the
  open." Or: "You can wait for the stock to have the first crack, bounce back into VWAP (the only intraday indicator I really
  use) and if it fails at VWAP you can enter (or add)."
- **Stop.** "The stop is highs of the day or if VWAP fail, a reclaim of the VWAP. The key is to get relatively tight and
  defined stops."
- **Target.** "The target area is the 10- and 20-day moving averages, that’s where these stocks usually bounce."
- **Patience.** "Don’t be too early. WAIT for the right setup. Let the amateur shorts get run over, that’s where your edge
  comes in."
- **Payoff.** "This setup is more like 5-10x risk reward, but if you wait for the perfect setups your win rate is probably
  going to be higher." (The breakout and the EP, by contrast, "you can sometimes get a 30-50x+ risk reward".)
- **Risk.** "This is by far the riskiest setup if done wrong or if you have issues with not obeying your stops."
- **Sizing context** (same post): "I don’t believe you should ever have more than 30% of your account over night in any
  stock or ETF."
- **His examples:** "$LAZR in 2020", "$AIG in 2009", "$AMTD in 1999" (charts only; no dates in the text). The long mirror:
  "any time a successful parabolic short goes down 50-60%+ in a few days, that’s the premise for the long setup."
- **Other pages.** His [FAQ](https://qullamaggie.com/faq/) (2021-04-27): "I usually have my biggest losses when I short
  things." On borrow: "I have access to very good (and sometimes very expensive) locates through my brokers where most
  other retail brokers do not." His loss post ([2020-04-08](https://qullamaggie.com/lessons-from-a-140k-loss/)) on a short in
  $W "up 240% in 2 weeks": "The lesson from this is that sometimes you just choose the wrong trading vehicle and that’s
  that."
- **What he does not give:** no climax-day gap requirement, no red-close rule, no volume multiple, no ATR or percent
  extension threshold, no numeric cap boundary.

### 3.4 Lance Breitstein (secondhand: a summary of his chapter in *Market Wizards: The Next Generation*)

Source: *CTE Research Sheet: Lance Breitstein*, [completetradersedge.com](https://completetradersedge.com/wp-content/uploads/2026/09/CTE-Research-Sheet-Lance-Breitstein-market-wizards-next-generation.pdf),
a companion to Jack Schwager and George Coyle, *Market Wizards: The Next Generation* (Harriman House, 2026), chapter 2.
I did not read the book. The sheet says it is "a companion to the chapter, not a substitute for it."
- **Exhaustion gap pattern:** "Day A, B and C each produce a large up-move on high volume. Day D opens with a wide gap up on
  even higher volume." Trigger: "Look for a major reversal on day D." Caution: "shorts are the dangerous side because upside
  is unbounded."
- **His log** includes "MicroStrategy, short" on "21 Nov 2024", pattern "Exhaustion gap". That is Bracco's MSTR five-star
  date. Also "Avis, short", "2 Nov 2021", "Upside capitulation": "Over $2 million lost in under an hour." The sheet's cause:
  "Anchored on the target, he put it on far larger than his method called for."
- **Stops:** "Below the low of the previous two-minute bar intraday; below the previous day's low for multi-day positions."
  (Written for longs; mirrored for a short.)
- Bracco credits Breitstein for "Right Side of the V" and the "Previous Bar High" trail (3.1).

### 3.5 Marios Stamatoudis, TraderLion, 2025-01-24 (read from the archived copy)

"Unlock Massive Profits with Parabolic Shorts: 6 Essential Nuances",
[archived copy](https://web.archive.org/web/20250513105402/https://traderlion.com/profile/marios-stamatoudis/parabolic-shorts/).
TraderLion's author note: "top performer in the 2023 US Investing Championship, with a 291% return." Bracco quotes him in
his post.
- Rarity: "The criteria for this setup should be strict enough for these occurrences to be somewhat “rare.” For me, I
  might encounter a great setup once a month."
- The window: "When my setup criteria are fulfilled, I allow a 1 to 2-day window for attempts. If it doesn’t work out, I
  skip the setup altogether."
- Targets: "Large cap stocks tend to have lower expectancy on big exhaustion days (e.g., 10-15%), while smaller names have
  significantly higher expectancy."
- Management: "If the stock reaches my expectancy target on day one, I usually cover everything." And: "There is always a
  chance of a major percentage gap up, so a large position overnight is a no-go for me."
- The open: "I prefer to miss a move rather than get chopped up to the upside by many rapid FOMO attempts."
- Scaling: "I usually scale into these trades, looking for signs of intraday exhaustion for my first entry and pullbacks
  later in the move for adding." Reason: "Halts occur more frequently in these types of setups".
- No numeric entry criteria are given.

### 3.6 Oliver Kell, the Exhaustion Extension (read)

- His own site, [kelltrading.com](https://kelltrading.com/) (read 2026-11-09), lists six steps; step 05 is "Exhaustion
  Extension" ("The climactic top. Identifying when a trend has gone too far, too fast"), then 06 "Wedge Drop" ("The downtrend
  signal.").
- TraderLion's page on it (by Ameet Rai, "With Investing Champion Oliver Kell", 2024-09-11,
  [archived copy](https://web.archive.org/web/20240915143622/https://traderlion.com/technical-analysis/chart-patterns/exhaustion-extension-sell-into-strength/)):
  "The Exhaustion Extension is a euphoric blowoff price movement well above the 10-day moving average, a sign that the stock
  may need time to form a new base." It is a place to sell, not to short: "Lock in (at least partial) profits when you see
  an Exhaustion Extension." On size: "The extension level will be unique to the character of the stock".
- So in Kell's method the short comes later, at the Wedge Drop (setup 16), not at the climax.

### 3.7 The Wyckoff school (StockCharts ChartSchool and Wyckoff Analytics; read)

[ChartSchool tutorial](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial)
by Roman Bogomazov and Michael Lipsett (same text on [wyckoffanalytics.com](https://www.wyckoffanalytics.com/wyckoff-method/)).
- On the buying climax (BC): "during which there are often marked increases in volume and price spread." "A BC often coincides with
  a great earnings report or other good news".
- Their short entry is later and more conservative: "Aggressive traders may wish to initiate short positions after a UT or
  UTAD." But "it is often safer to wait until Phase D and an LPSY."
- Not a parabolic short; useful for the psychology (public buying filled by professionals).

### 3.8 Investor's Business Daily, the climax top (a sell rule; read through a fetch tool)

"Investor's Corner: When To Sell On The Way Up", IBD, 2014-04-04, on
[Yahoo Finance](https://finance.yahoo.com/news/investors-corner-sell-way-183200275.html).
- The framing sentence: "There is one case when a stock on the way up is flashing a sure-fire sell signal: when a climax
  top forms." Then: "After a prolonged advance, shares soar 25% to 50% or more in three weeks or less." "That's the
  hallmark of a climax top."
- The same column: "any stock that surges that fast in three weeks or less should be held at least eight weeks." (That is
  IBD's rule for a 20% gain inside three weeks; our screener file notes the overlap.)
- It is a sell rule for owners. I could not read O'Neil's book list of climax signs (largest daily gain, exhaustion gap,
  heaviest volume) from a primary source this session, so I quote none of it.

### 3.9 Thomas Bulkowski, Vertical Run Up (measured; read through a fetch tool; AI notice applies)

[thepatternsite.com/VerticalRunUp.html](https://thepatternsite.com/VerticalRunUp.html).
- Shape: "Price moves up in a steep run for at least four sessions." "That's when price goes vertical, climbing day after
  day with little or no overlap between price bars."
- Signal: "If price closes down, then sell an existing holding or anticipate a retrace by shorting the stock." The trigger
  in his words: "Use a close above the top or below the bottom of the last price bar in the vertical run as the trading
  signal."
- His statistics are in 4.1.

### 3.10 Pradeep Bonde (Stockbee), one line (read)

[stockbee.blogspot.com, 2022-10-23](https://stockbee.blogspot.com/2022/10/if-you-are-member-check-out-new-guide.html):
"During a bullish market, parabolic short and weak structure short setups can work very well." Only a members' guide
teaser; no criteria. I found no Stockbee post defining the setup.

### 3.11 StockCharts ChartSchool, exhaustion gaps (read)

[Gaps and Gap Analysis](https://chartschool.stockcharts.com/table-of-contents/chart-analysis/gaps-and-gap-analysis):
"Exhaustion gaps happen near the end of a good up or downtrend. The gaps are often the first signal of the end of that
move." "They're identified by high volume and a large price difference between the previous day's close and the new
opening price."

### 3.12 Read and not used as sources

- Niv Goren, "Systemizing Kullamägi’s Parabolic Short Setup", stonkscapital.substack.com, 2025-02-10. He backtested
  "Short the open, cover by EOD" and reports a final system's results, but he does not disclose its rules ("I’m also
  available for any question regarding the set up if it doesn’t include me revealing the exact rules I used") and the post
  promotes a data tool. Not usable as evidence.
- Concretum Research, "Identifying Stocks to Fade" (2026-05-23): paywalled; only the opening is public.
- Search-result pages from TradeZella, TradingView scripts, Tim Sykes-style "first red day" pages and AI-written
  summaries: not sources under the brief.

### 3.13 What I could not read or look for

The web-search budget ran out midway. I did not find or read: Linda Raschke, Toby Crabel, Larry Williams, Victor
Sperandeo, John Carter, Stan Weinstein or Mark Minervini on climax shorts; O'Neil's book text on climax tops;
Kullamägi's streams or tweets (the source of the line Bracco quotes in 6.2); Investors Underground or Tim Sykes on the
small-cap "first red day". None is quoted here. Weinstein's Stage 3 and 4 (setup 10), Sperandeo's 2B (setup 28) and Kell's
Wedge Drop (setup 16) have their own dossiers.

### 3.14 Our app's rules (for the table; details in section 5)

`api/services/pattern_engine/detectors/uct/parabolic_short.py`: up 100%+ over 30 bars; the climax bar's range 3x or more
the 20-bar average range; close in the bottom 30% of the range; volume 3x the 20-bar average; a gap up of 3%+ that closes
under its open. Entry 0.1% under the climax low; stop 1% over the climax high; target the lowest low of the prior 50 bars.

### 3.15 Comparison table

| | Bracco (UCT, house) | Kullamägi (originator) | Breitstein (secondhand) | Stamatoudis | Kell | IBD / Wyckoff / Bulkowski | Our scanner |
|---|---|---|---|---|---|---|---|
| Prior trend | a "large, powerful move up"; parabolic, not linear; extension table (2025 averages: 21% over 9 EMA, 77% over 50-day, 8.81 ATR) | large caps +50-100%+ in days or weeks; small caps +300-1000%+ | days A, B, C large up-moves on high volume | not stated | far above the 10-day; after Base n' Breaks | IBD: +25% to 50% in 3 weeks after a long advance; Bulkowski: a steep run of 4+ sessions | +100% in 30 bars |
| Shape / length | 3-5 day burst; shrinking bases; ATR expansion; weekly range expansion | up 3-5+ days in a row | 3 up days then a gap day | not stated | "euphoric blowoff" | vertical, little bar overlap | none beyond the run |
| Volume | rising 2 days; highest opening volume on the climax day | not stated | high, then "even higher" on day D | not stated | not stated | Wyckoff BC: volume and spread rise | climax bar 3x the 20-bar average |
| Gap | 2 straight gap ups; climax gap up required | not required | "wide gap up" on day D | not stated | not stated | exhaustion gap (ChartSchool) | gap up 3%+ required |
| Trigger | intraday: VWAP break after the U-Turn; second entry at the day's low | intraday: opening range low, first red 5-min candle, or VWAP fail | "a major reversal on day D" | intraday exhaustion signs | none (sell, not short) | Bulkowski: close below the last bar's low; Wyckoff: after a UT/UTAD or LPSY | next day: break of the climax low |
| Stop | the day's high | the day's high, or a VWAP reclaim | prior two-minute bar (mirrored) | not stated | n/a | not stated | 1% over the climax high |
| Target | daily 9 EMA (later "9 or 10 day" EMA) | 10- and 20-day MAs | not stated | 10-15% for large caps on the day | n/a | Bulkowski: median retrace 52% of the run | lowest low of 50 bars |
| Holding | mostly a day trade; some overnight "if the risk is paid for" | not stated | intraday chart drives decisions | cover on day 1 if target hit; 1-2 more days, smaller | n/a | n/a | not stated |
| Size | "conviction and size" on 5-star; variants smaller | max 30% of account overnight per stock | Avis loss blamed on oversizing | scale in; small overnight | n/a | n/a | n/a |

### 3.16 Where the sources disagree

1. **The climax-day gap.** Bracco requires it; Kullamägi, Stamatoudis and IBD do not. Breitstein's pattern has it. Our
   scanner requires 3%+.
2. **The target.** Bracco: 9 EMA (later 9 or 10). Kullamägi: 10- and 20-day MAs. Stamatoudis: a percent target by cap
   size. Our scanner: a 50-bar low, far below all of them. Our voice knowledge base: 21 EMA then 50-day.
3. **The prior move.** Kullamägi's percent bands by cap size; Bracco's extension table and his warning not to judge by
   percent alone; our scanner's flat +100% in 30 bars; IBD's +25% to 50% in 3 weeks.
4. **Entry timing.** Bracco and Kullamägi short on the climax day itself, intraday. Our scanner's narrative says "NEVER
   short the climax bar itself" and enters on a later break of the climax low. Kell and Wyckoff do not short the climax.
5. **The ATR multiple.** Bracco's two tables use two formulas (4.2). Jeff Sun's indicator is the newer one.
6. **Adding.** Stamatoudis scales in; Bracco enters in two steps (VWAP, then the day's low) and adds only as it works; the
   house rule A5 buys the full size at one price.
7. **Size.** Bracco trades five-star setups with "conviction and size"; our notebook template says "Size small" and the
   course plan calls it the "smallest size in the catalog"; the rulebook sizes by grade (D38, E49).

---

## 4. Measured evidence

### 4.1 Published statistics

- **Bulkowski, vertical runs** (fetch tool; AI notice applies): "a study of 3,024 vertical runs in 247 stocks in the three
  bull markets from July 1995 to January 2014." After the run, "price continues to climb 21% of the time"; "The remainder
  of the time (79%), price first closes below the last price bar in the pattern". "The median (midway) retrace is 52%." "A full 22% will retrace the complete AB move."
  "Just 21% of vertical runs suffer a trend change (a drop of at least 20%)." "Seventy-eight percent of vertical runs take
  less than three months to make a new high." Limits: bull markets only; a run is any steep 4+ session rise, not a climax
  burst; no trade with stop and target is tested.
- **Greenwood, Shleifer and You, "Bubbles for Fama"** ([NBER w23191](https://www.nber.org/papers/w23191), 2017; industry
  portfolios, US 1926-2014): "a sharp price increase of an industry portfolio does not, on average, predict unusually low
  returns going forward" but such increases "predict a substantially heightened probability of a crash". And "attributes of
  the price run-up, including volatility, turnover, issuance, and the price path of the run-up can all help forecast an
  eventual crash". Lesson for us: a big run alone is not a short; the character of the run matters. Limits: industries,
  not single stocks; months, not days.
- **Bali, Cakici and Whitelaw, "Maxing Out"** ([NBER w14804](https://www.nber.org/papers/w14804), 2009): "a negative and
  significant relation between the maximum daily return over the past one month (MAX) and expected stock returns." The gap
  between the lowest and highest MAX deciles is over 1% a month. Limits: monthly portfolios, not a timing rule.
- **Lehmann, "Fads, Martingales, and Market Efficiency"** ([NBER w2533](https://www.nber.org/papers/w2533), 1988): winners
  and losers "in one week to experience sizeable return reversals over the subsequent week". Limits: weekly, cross-section,
  old data.
- **Jones and Lamont, "Short Sale Constraints and Stock Returns"** ([NBER w8494](https://www.nber.org/papers/w8494), 2001;
  1926-1933): "stocks that are expensive to short or which enter the borrowing market have high valuations and low
  subsequent returns". Also: "despite high costs it is profitable to short them." Relevant to borrow (rule D48). Limits:
  1920s-30s data.
- **Our own screener's lift ledger** (`docs/base_lift_ledger.json`, measured 2026-09-01): the "Parabolic Extension" state
  (up 50%+ within 20 bars with 3+ up days in a row) fell 10% before rising 8% within 20 sessions 55.5% of the time, against a
  24.3% baseline; n=2,077 over 3,461 tickers; lift +31.2 points (95% range +29.1 to +33.6). Limits: it enters at the close
  of the day the state appears, with no crack and no gap; a gap through the 8% stop is booked at exactly 8%; it says "A
  published SHORT lift is not a trade."
- **Bracco's own tables** are samples of tops he picked, not statistics. A brain-KB summary of his Discord post of
  2024-11-20 (t10902, a machine summary, not his words) lists climax-day gaps of "+2.6% to +12.2%", intraday fades "SMCI
  -25.5%, NVDA -11.2% and -8.1%, TIGR -22.2%", and "2-3 days to reach the 9 EMA". That is his reading of his examples.
- **No published win rate exists for the setup as Bracco or Kullamägi define it.** Kullamägi's only statement is "your win
  rate is probably going to be higher". Any number in our app claiming his win rate is invented (5.5).

### 4.2 My own test (2026-11-09; read-only; scripts and outputs in my scratch folder, not the repo)

**Data.** The workbench copy of the app's daily bars (`bars.db`, 4,284 tickers, split-adjusted, to 2026-11-09), opened
read-only, and the shared hourly bars (the 1,000 most-traded names, 2023-12-12 to 2026-11-06, regular hours). Liquidity
as B23 on the day before: price $10+ and 50-day average dollar volume $20M+. Survivorship: only stocks still in the store,
so companies that collapsed and were delisted are missing; that biases results against the short.

**The two formulas behind Bracco's ATR multiples.** I recomputed his table rows:
- His June 2025 table matches **(close minus 50-day SMA) divided by the 20-day average true range (simple average)**: SMCI
  9.89 (his 9.88), NVDA 7.98 (7.98), MSTR 7.36 (7.36), MRNA 9.64 (9.64), TSLA 10.29 (10.3), all at the close before the
  climax. Two rows differ (TASR 7.38 vs 7.63, QCOM 8.42 vs 7.72), likely old-data differences.
- His 2025-09 to 2026-05 numbers match **Jeff Sun's percent form: (percent above the 50-day SMA) divided by (14-day Wilder
  ATR as a percent of price)**: OKLO 12.83 (his 12.83), RGTI 12.21 (12.2), SMCI 25.67 (25.67), MSTR 15.52 (15.52), SLV
  13.32 (13.32), INTC 18.74, SNDK 14.57, MU 12.61 and QQQ 9.91 (all exact). NVDA is close (12.16 vs his 12.6). His 2026
  rows for MRNA, TSLA, TASR and QCOM do not match my data.
- The second scale runs about 1.5 to 3.8 times the first on these stocks (NVDA 1.5, SMCI 2.6, CAR 3.8): the bigger the run,
  the bigger the gap between them. **A threshold means nothing without its formula.** Our Chart IQ engine uses a third
  variant (14-day simple ATR, points form).

**Event definitions (daily).** A candidate climax day d needs the prior close stretched. Then:
- **PB (stretched, in ATR and percent):** at the prior close, at least 7 ATRs above the 50-day (2025 form, about his lowest
  table row), at least 10% above the 9 EMA and at least 40% above the 50-day (his table's lowest values, rounded).
- **Burst boxes** (Bracco 1 to 4): 3+ straight up closes before d; 2+ straight gap ups ending on d; in 2 of the 3 days before
  d the percent gain beat the day before; 2+ straight days of rising volume before d.
- **Gap:** d opens above the prior close. **Red:** d closes under its open (the daily trace of "opens higher, and closes
  lower").
- **T1 trade (a late, conservative proxy):** short d's close; stop 0.1% over d's high; cover at a resting order at the prior
  day's 9 EMA; stop checked first; a gap over the stop fills at the open; 20 sessions maximum. Bracco's real entry (the VWAP
  break) is earlier and higher, so T1 fills worse and risks more.
- **House:** the rulebook mirrored for a short (breakeven at 2R; a third at 3R and 5R; the rest on a close over the 10-day
  EMA once it has closed under it; 10-day time stop under 1R; gap over the stop exits at the open).
- **T2, the day-2 gap down:** day d+1 opens 2%+ under d's close; short that open; stop 0.1% over d's close (the gap fill);
  cover at the 9 EMA.

**Results, daily bars, 1996 to 2026** (mean R; 95% range from a bootstrap that resamples whole dates):

| Group | n | 9 EMA within 3 / 10 days | 9 EMA before a new high | Median stop (close to high) | T1 mean R (range) | T1 win | House mean R (range) |
|---|---:|---|---:|---:|---|---:|---|
| PB, any day (no trigger) | 3,208 | 29% / 81% | 34% | 3% | +0.09 (-0.33 to +0.58) | 33% | -0.12 (-0.43 to +0.24) |
| **Bracco proxy: PB + 3-4 boxes + gap + red** | **325** | 37% / 91% | 51% | 6% | **+0.54 (-0.04 to +1.54)** | 48% | +0.20 (-0.14 to +0.60) |
| ... + his 2025 averages (A+) | 30 | 53% / 87% | 70% | 14% | +0.62 (+0.05 to +1.32) | 67% | +0.42 (-0.15 to +1.05) |
| ... + year-high volume | 38 | 39% / 97% | 68% | 13% | +0.55 (+0.01 to +1.20) | 58% | +0.55 (0.00 to +1.22) |
| ... climax gap 5%+ | 66 | 44% / 97% | 67% | 13% | +0.62 (+0.16 to +1.14) | 62% | +0.52 (+0.06 to +1.03) |
| ... all 4 boxes | 105 | 38% / 91% | 52% | 7% | +1.53 (-0.02 to +4.40) | 49% | +0.80 (+0.04 to +1.96) |
| ... exactly 3 boxes | 220 | 36% / 90% | 50% | 6% | +0.06 (-0.25 to +0.31) | 47% | -0.09 (-0.36 to +0.16) |
| PB + 0-2 boxes + gap + red | 524 | 32% / 83% | 45% | 5% | +0.07 (-0.17 to +0.29) | 45% | 0.00 (-0.25 to +0.25) |
| PB + 3-4 boxes + gap, **green** close (no crack) | 219 | 16% / 83% | 23% | 2% | +1.59 (-0.67 to +4.89) | 23% | +1.12 (-0.62 to +3.43) |
| PB + 3-4 boxes, **no gap**, red | 124 | 49% / 88% | 58% | 6% | +0.42 (-0.15 to +1.11) | 52% | +0.34 (-0.20 to +0.93) |
| Proxy, SPY under its 200-day | 25 | 52% / 92% | 76% | 10% | +0.62 (+0.06 to +1.19) | 72% | +0.55 (-0.02 to +1.21) |
| Proxy, without 1999-2000, 2008-09, 2020-21 | 196 | 37% / 91% | 52% | 5% | +0.86 (-0.07 to +2.44) | 50% | +0.38 (-0.11 to +1.02) |

The green-close row's mean R is pulled up by a few trades whose climax closed at its high, so the stop was tiny and one
fall to the 9 EMA counted as many R. Its win rate (23%) is the honest number.

T2, the day-2 gap down, on the proxy: n=96, median stop about 5%, +0.37R (-0.13 to +1.16), win 41%; with all 4 boxes: n=30,
+1.55R (+0.15 to +3.48), house +1.82R (+0.39 to +3.97).

**Facts about the proxy events (325).** 98% closed above the 200-day; SPY was above its 200-day 92% of the time. Median
climax gap 2%; median open to close -4%; median open to low -7%. The stop from the close to the climax high was over 3% in
81% of cases and over 10% in 26%. The 9 EMA sat a median 11% under the climax close, about 2R. Median sessions to the 9
EMA inside the T1 trade (a stop-out counted as never reaching it): 5 (3 for the A+ cut); the plain first touch of the
9 EMA, stop or no stop, came in a median 2 sessions. By year: 50 in 2020, 42 in 2021, 119 in 2024 to 2026, every other
year 15 or fewer. (All of these were recomputed from the saved event file in checking and agree.)

**Hourly bars, 2023-12 to 2026-11 (T3, the closest I can get to Bracco's entry).** On a PB gap-up day, short the close of
the first hourly bar that closes under the session VWAP; stop 0.1% over the high so far.

| Group | Fills | Median stop | Stop within 3% | Day trade (cover at the close) | Hold to the 9 EMA (10 days max) | House |
|---|---:|---:|---:|---|---|---|
| PB + 3-4 boxes | 97 (70 tickers) | 4% | 31% | -0.10R (-0.22 to +0.03), win 46% | -0.09R (-0.47 to +0.28), win 31% | -0.10R (-0.49 to +0.34) |
| ... + A+ | 13 | 9% | 8% | -0.24R (-0.53 to +0.04) | +0.28R (-0.52 to +1.07), win 46% | +0.23R |
| PB + 0-2 boxes | 194 | 4% | 40% | -0.05R (-0.17 to +0.08) | -0.09R (-0.35 to +0.21) | -0.18R |

**Our scanner's rule (all history, liquid).** 48 events (about 1.8 a year), 40 filled. Median stop 43% from the entry
(1% over the climax high, entry under the climax low). Of the 40: 2 reached its 50-bar-low target, 15 were stopped (3 by a
gap), 23 ran out of time (60 bars). Mean +0.16R. It fired on 3 of Bracco's 6 five-star examples (MSTR, TIGR, PLUG) and on
CAR 2026-04-22; it missed SMCI (volume under 3x its 20-day average), NVDA (run, volume, gap under 3%) and MRNA (30-day run
under 100%), and every later UCT example in 6.6.

**Bracco's claim, "Every parabolic short I’ve analyzed reaches the daily 9EMA before any counter-trend rally emerges".**
True on his six five-star examples (6.6). On the broad proxy it held 51% of the time; 70% on the A+ cut; 67% with a 5%+
gap.

**What the test says.**
- The broad, mechanical version is not a proven edge: positive on average at the 9 EMA, but the range includes zero, and
  the house management adds nothing.
- The crack matters. Shorting a green climax day (before the turn) won 23% of the time and the 9 EMA came before a new
  high only 23% of the time. This backs "never short strength".
- The burst count matters, but only at the top: all four boxes stood out (+1.53R, wide range; +0.80R with house
  management). Exactly three (+0.06R) and fewer than three (+0.07R) did about nothing.
- Bigger is better: Bracco's average extensions, a climax gap of 5% or more, and year-high volume all lifted the results,
  on samples of 30 to 66.
- The gap-up requirement was not clearly supported: red climax days without a gap did about as well (n=124). The gap
  helped most when it was large.
- On hourly bars my crude VWAP entry lost a little. Bracco's entry uses 1 to 5-minute bars and judgment about the U-Turn,
  which hourly bars cannot see.
- The honest stop is usually wider than the house's 3% guideline: median 4% (hourly VWAP entry) to 6% (daily close).

**Limits.**
- Daily bars cannot see the VWAP break, the opening volume or the premarket spike (CIFR's 2025-09-25 spike was premarket
  and is invisible here). The hourly VWAP is a rough stand-in. My extension gates are my reading of Bracco's table.
- About 30 group-and-trade cells were tested. At 95%, one or two can look positive by chance. The A+, gap and four-box cuts
  need an out-of-sample check before anyone relies on them.
- No borrow fees, no hard-to-borrow skips, no slippage, no halts. Survivorship bias against shorts. Results cluster in
  2020-21 and 2024-26.
- R is in units of the stop. With wide stops (14% on the A+ cut), +0.6R is several percent of price but still a modest
  edge per unit of risk.

---

## 5. Our app: what exists, and what looks wrong

### 5.1 The scanner the brief names: `api/services/pattern_engine/detectors/uct/parabolic_short.py`

Registered as `parabolic_short` ("Parabolic Short", category `uct`, direction `bearish`), imported by
`api/routers/patterns.py`. It looks only at the last bar.
- **Gates, all required.** (1) Close at least 100% above the close 30 bars earlier (`_MIN_PRIOR_RUN_PCT = 1.00`,
  `_PRIOR_RUN_BARS = 30`). (2) The climax bar's high-to-low range at least 3x the average high-to-low range of 20 bars
  (`bars[-22:-2]`; the helper is named `_atr` but its docstring says it uses the high-low range, not true range). (3)
  Close in the bottom 30% of the bar (DCR at most 0.3). (4) Volume at least 3x the same 20-bar average. (5) Open at least
  3% above the prior close, and close under the open.
- **Levels.** Entry `climax low * 0.999` ("break of climax low"); stop `climax high * 1.01`; target the lowest low of the
  50 bars before the climax; no second target.
- **Score.** 40% geometry (range, DCR, gap, run), 25% volume, 20% context, 15% a fixed 50 for history; detections under
  50 are dropped. The context score adds points for "distribution", a falling RS trend, and trend stage 3 or 4. A parabolic
  short happens in a strong stage-2 leader with rising RS, so these points mostly never apply.
- **Measured (4.2):** about 1.8 events a year; median stop 43% from entry; 2 of 40 reached its target.

### 5.2 Other code that touches this setup

- **Screener structure "Parabolic Extension"** (`api/services/screener/base_catalog.py`, `PARABOLIC_EXTENSION`): up 50%+
  from the lowest low of the last 3 to 20 bars with 3+ straight up closes. Its Kullamägi quotes match his page exactly. It
  says honestly: "What ships is the STATE -- the stock is parabolically extended -- not his trade." It is the one measured
  in the lift ledger (4.1). The neighbouring "Climax Top" structure quotes IBD (3.8) and adds its own prior-advance rule of
  +50% in 120 bars, marked as ours.
- **Chart IQ** (`api/services/chart_iq/engine/v2_setups.py`): labels a bar "Climax / exhaustion" (`parabolic_short`) when
  the close is 5+ ATRs over the 50-day ((close minus SMA50) / 14-day simple ATR), 12%+ over the 9 EMA, up 25%+ in 20 days,
  after 2+ up closes; grade A at 7+ ATRs; it draws the 9 EMA as "mean-reversion target". `markup.py` then sets the long trade
  to "pass". This is close to Bracco's extension idea, with no burst, gap or crack.
- **Kell cycle detector** (`detectors/uct/kell_cycle.py`): `_PARABOLIC_PCT = 0.25` with the comment "(Kell exhaustion
  def.)". The Kell material I read gives no number ("The extension level will be unique to the character of the stock").
- **Voice knowledge base** (`api/data/voice_kb/trading_principles.json`, `sd-006`): "Stock has run 100-500% in 1-3 months
  with accelerating slope." "Short the lower-high after the first crack, with stop above the recent pivot high." "Targets:
  21 EMA, then 50 SMA." No source is named; the targets differ from both Bracco and Kullamägi.
- **Patterns API description** (`api/routers/patterns.py`): "Kullamägi's blow-off detector: parabolic 100%+ run + climactic
  bar with gap-up failure + 3x volume + DCR <0.3." Kullamägi published none of those numbers.
- Also listed by name in the agent coach's setup list (`api/services/uct_agent/coach/setups.py`) and the archive's setup
  matcher (`api/services/wisdom/archive/ask_setup.py`).

### 5.3 The Model Book card, journal tags and plan template

- **Model Book card** (`app/src/pages/modelbook/setupCatalog.js`): family "Reversals & Reclaims", direction short. Essence: a
  3 to 5 day blow-off "stretched miles above the averages", "shorted as it cracks, targeting the snap back to the 9 EMA."
  That matches Bracco. The glyph's climax candle is `[-3, 4, 1]`: no gap slot, so it draws **no gap up** on the climax day,
  and the trigger line (`pivot: { idx: 7, side: 'l' }`) sits at the climax candle's low, a next-day break. Bracco's main
  entry is intraday on the climax day, after a gap up. No detailed write-up exists in `setupPlaybooks.js` (the card shows
  the placeholder); the EMA Crossback write-up there mentions "one of the four climax-day entries listed for the Parabolic
  Short", but no such list is in the repo or the public posts. The file says its content comes from the owner's playbook
  docs, so the list may live there (dossier 14 reached the same point).
- **Journal tags** (`app/src/constants/setupGroups.js`): "Parabolic Short" and "Parabolic Long" in the Swing list.
  `setupTagMap.js` maps "Parabolic Short" to the `parabolic-short-plan` template; the long has none.
- **Plan template** (`app/src/pages/journal-2-0/lib/notebookTemplates.js`, `parabolic-short-plan`): checklist "Several up
  days in a row, far above the 10-day average", "Signs of exhaustion: a gap up that fades, or climax volume", "The first
  crack has happened: a red day, or a failed push higher", borrow, and a named support. Rule: "Never short strength. Wait
  for the first crack, size small, and respect the high of the day." Management: "Cover a first piece at the first support,
  such as the 10-day average" and "Do not re-short the same run after you are stopped out". The fingerprint checklist maps
  items 1 and 5 to the distance over the 10 and 20-day averages.
- **Course plan** (`docs/curriculum/uct_method_course.json`, lesson "Parabolic Short: Shorting the Crack of a 3-5 Day
  Blow-Off"; `docs/study/UNITS-method.md` SET.31): "shorted only as it cracks", the 9 EMA target, "smallest size in the
  catalog".

### 5.4 The owner's rulings that touch this setup (2026-11-09)

- B26: no shorts above the 200-day "unless parabolic short"; "read bracco's substack post to determine a parabolic short
  and long"; "200SMA is hardened rule yes".
- D47: "47, yes but that is parabolics. Shorts are the same just reversed for almost all our setupstuff." (The rule text:
  stop above the day's high, target the 9-day average.)
- C31: leaders with RS 80+ "unless parabolic or mean reversion".
- C34: selling a big part into a parabolic burst on your own long: "34, yes but depends."
- The parabolic long is the mirror: "1, yes."

### 5.5 What disagrees with the sources, or looks wrong

1. **The scanner does not test Bracco's definition** (the owner's ruling). It has no burst count (up days, gap streak,
   growing gains, growing volume), no extension measure, and it adds gates no source gives (100% in 30 bars, 3x range, 3x
   volume, DCR 0.3, 3% gap). It missed SMCI, NVDA and MRNA among his six five-star examples.
2. **The code claims Kullamägi as its source, wrongly.** The comment above the thresholds says "Thresholds - sourced from
   Kullamägi's published short-side framework". His page gives +50-100%+ (large caps) or +300-1000%+ (small caps) and 3-5+
   up days, and nothing about range, DCR, volume multiples or a gap. The narrative calls 100% "his 100% minimum"; his
   large-cap band starts at 50%.
3. **An invented quote.** The narrative says Kullamägi "has published this framework explicitly on Twitter and in his
   Stockbee.tv educational content" and quotes him. The quote is not on his site, and Stockbee is Pradeep Bonde's brand,
   not Kullamägi's. I could not search his posts on X (search budget), so I cannot prove it was never said; but the
   attribution as written is wrong, and with no source it should be removed.
4. **An invented statistic.** "Kullamägi's published track record on parabolic shorts shows a 55-65% win rate with average
   winners producing 30-60% declines over 1-4 weeks and average losers controlled to 8-15%". No such record is published
   (4.1). The scanner's own stop sits a median 43% from its entry (4.2), so even the loss claim is false on its own levels.
5. **Execution rules that contradict the originator.** The narrative's "NEVER short the climax bar itself" and "short at
   the OPEN of the day the climax low breaks" are presented as Kullamägi's rules. His entries are on the climax day itself
   (opening range lows, first red 5-minute candle, VWAP fail), and so are Bracco's.
6. **Kell's cycle is wrong in the narrative.** It says the Exhaustion Extension is "Stage 3 of his 5-stage cycle" and the
   Wedge Drop "Stage 4". Kell's site lists six steps: the Exhaustion Extension is 05 and the Wedge Drop 06.
7. **The target is from no source.** The lowest low of 50 bars is usually the start of the whole run. Bracco targets the
   9 EMA, Kullamägi the 10- and 20-day MAs. Only 2 of 40 scanner trades reached it.
8. **The stop is unusable under the rulebook.** 1% over the climax high, entered under the climax low: a median 43% of
   price (A13 is about 3%).
9. **The context score points the wrong way** (5.1).
10. **The Model Book glyph shows no climax gap**, and its trigger line is the next-day break, not Bracco's intraday entry.
11. **The plan template and course plan say "size small" / "smallest size in the catalog"**, which the rulebook does not
    (D38, E49) and Bracco does not ("conviction and size" on five-star setups). The template's "Do not re-short the same run
    after you are stopped out" conflicts with B21 and E56 and with Bracco's own three attempts on AGQ (6.2). Its 10-day
    first target is Kullamägi's, not the house 9-day (D47).
12. **The voice knowledge base entry** gives 100-500% in 1-3 months, a lower-high entry and 21 EMA / 50-day targets with no
    source.
13. **The patterns API description** repeats the false attribution (5.2).
14. **The EMA Crossback write-up** refers to "the four climax-day entries listed for the Parabolic Short". No such list is in
    the repo or the public posts; Bracco's post lists three climax-day patterns plus the day-2 backside entry (four in
    all, if counted that way). Question 15 asks the owner for the list if it is in his playbook.

---

## 6. UCT's own words

All from the [UCT Substack](https://unchartedterritoryy.substack.com) (all 103 posts in its sitemap read on 2026-11-09;
one subscriber-only post had no public text). Sections are signed in the posts by their headings ("Bracco’s Breakdown &
Top Ideas", "TSDR’s Weekly Outlook & Watchlist", "Bracco - " plus the ticker in The Rest of the Week). I treat TSDR as the owner, as
the earlier dossiers do.

### 6.1 Bracco, "The Parabolic Short" (2025-06-13): the remaining key lines

- On temperament: "Timing is everything, especially if you’re trading directionally like I do." "If a stock is setting up
  for a Parabolic Short, that means its made a large, powerful move up and one of the hottest stocks in the market." "At the
  end of the day, it’s all about positioning, price, and volume."
- On selectivity: "That’s why it’s critical to wait for the absolute best setups to tilt the odds in your favor and keep
  your win rate high". "This is the reason why I’m highly selective and hold out for that final exhaustion gap-up on the
  climax day." His favorite shape: "A parabolic burst into a final gap up on climax day, where it opens higher, and closes
  lower."
- He quotes Marios Stamatoudis: "When it comes down to setups, always remind yourself that Structure and Behavioral reasons
  are equally important to specific parameters and numeric inputs." (Not checked at its source.)
- Everything else is in 3.1.

### 6.2 Bracco, later posts (dated)

- [2025-07-20](https://unchartedterritoryy.substack.com/p/sunday-scans-c82): "While a handful of names are on my radar as
  potential setups for parabolic shorts, they are not quite ready yet."
- [2025-09-21](https://unchartedterritoryy.substack.com/p/sunday-scans-88a): "For anyone that is interested, this is a good
  time to go back and read my study on the parabolic short that I posted on here in June." He quotes Kullamägi (one line of
  the quote): "Timing is everything. Getting timing wrong is the same thing as being wrong." (From Bracco's post; I did not
  find the original.) And "it is very important to keep opinions and bias out of the picture."
- [2025-09-28](https://unchartedterritoryy.substack.com/p/sunday-scans-9a2): "I mentioned a couple potential parabolic short
  opportunities in last weekend’s Sunday Scans, but most never triggered or met my criteria." On leaders: "each cycle almost
  always ends with biggest and best leaders going parabolic and blowing off top."
- [2025-10-05](https://unchartedterritoryy.substack.com/p/sunday-scans-6ef) (RGTI): "If this gets a couple more days straight
  up I will be looking for an exhaustion gap and potential mean reversion/parabolic short."
- [2025-10-08](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-208) ("Bracco - IREN (Short)"): "This
  variation consists of a very extended run, a short term parabolic burst, and then a “hanging man” candle at the high on
  increased volume." "What you typically see following this candle, if going to follow through to the downside, is a gap
  down and failure to follow through back higher on any bounces."
- [2025-10-15](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-39d) ("Bracco - UAMY (Short)"): "Massive high
  volume indecision candle at the highs and felt like exhaustion today." "Think this has room to sub $15 easily and the the
  daily 9ema as final target."
- [2025-10-19](https://unchartedterritoryy.substack.com/p/sunday-scans-6cc): "Following that idea UAMY fell nearly -50% in 4
  days". And the turn: "In some cases, stocks that set up for a parabolic short and blow off at the highs can actually turn
  into parabolic/mean reversion longs in just a couple of days."
- [2025-10-22](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-481): "My style favors special, outlier moves,
  such as mean reversions, parabolics, 5-star breakouts, breaking news, etc."
- [2025-12-28](https://unchartedterritoryy.substack.com/p/sunday-scans-249) (silver): "It is setting up a classic parabolic
  short, which is my bread and butter." "The parabolic short is a very difficult trade and should not be attempted by most
  traders, especially if it is not within your playbook."
- [2026-01-04](https://unchartedterritoryy.substack.com/p/sunday-scans-153): "It unfolded a bit faster than I anticipated, so
  I wasn’t positioned for it and didn’t participate."
- [2026-01-18](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1) (a loss, told plainly): "I shorted AGQ shares as
  my vehicle which resulted in 3 failed attempts over 2 sessions." "I did not revenge trade or average down on this at any
  point". "I just looked for areas with low risk and clear invalidation spots, while staying loyal to my stops."
- [2026-01-25](https://unchartedterritoryy.substack.com/p/sunday-scans-7fb): "I am not sure I have ever seen so many traders
  experience significant drawdowns and even blow-ups trying to short one move." (Plus the lines in 3.2.)
- [2026-02-22](https://unchartedterritoryy.substack.com/p/sunday-scans-04c): "KORU looks like day 1 of a parabolic burst, but
  not perfect yet." [2026-02-25](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b24): "KORU still interesting
  for a parabolic short at some point in future but not in play at the moment."
- [2026-03-01](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8): "The window of opportunity opened on Thursday and
  we had a great trade to the short side on KORU."
- [2026-04-14](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-c4d) ("Bracco - YSS CAR"): "it never really got
  extended enough from the short term moving averages for me to get excited". "A huge range and volume expansion day up into
  $500 tomorrow and I would be interested." (CAR's climax came on 2026-04-22; 6.6.)
- [2026-05-10](https://unchartedterritoryy.substack.com/p/sunday-scans-68a): "I also love to help someone riding a big
  unrealized long position take advantage and trim a bit into a parabolic extension." (That is house rule C34's long side.)
- [2026-10-11](https://unchartedterritoryy.substack.com/p/sunday-scans-31b): "It is now over 200% above the 200sma which is
  where many of the previous runs have come to an end". "Not going to front run something like this".

### 6.3 TSDR (the owner)

- [2025-06-22](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2): "BTW, Bracco and I plan to do further setup and
  strategy writeups similar to the PARABOLIC SHORT detailed writeup from last week."
- [2026-02-22](https://unchartedterritoryy.substack.com/p/sunday-scans-04c): "Watching the potential EWY/KORU setup for a
  parabolic like Bracco mentioned."
- [2026-03-29](https://unchartedterritoryy.substack.com/p/sunday-scans-352): "there is an edge in significant asymmetric mean
  reversions. Bracco is skilled at them. Everyone wants to ask about parabolic shorts."
- The owner wrote no rules of his own for this setup in the public posts. His rulings are in 5.4.

### 6.4 Unsigned sections

- [2025-06-22](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2), closing comments: "Lastly, Watch CRCL for a
  potential Parabolic Short. This will be fun if we get one more day up."
- [2025-12-14](https://unchartedterritoryy.substack.com/p/sunday-scans-f2f), Index & ETF, SLV: "Nasty reversal on a gap up
  and trend lower. Behaved like a parabolic short."
- [2025-12-21](https://unchartedterritoryy.substack.com/p/sunday-scans-34b), Index & ETF, SLV: "Honestly, a few breakaway
  gaps next week and could set up a parabolic short" and "If long, just trail the moving averages."
- Note: the brain-KB files label some of these SLV lines "Bracco" and date them 2026-02-21. In the posts they sit in the
  unsigned Index & ETF section, dated 2025-12-14 and 2025-12-21.

### 6.5 Discord notes in the repo (machine summaries, not his words)

From `docs/study/levels/brain_kb_2026-11-06.json` and `brain_kb_rules_2026-11-06.json`:
- t10262 (2025-02-19), "Parabolic short framework": the summary lists "3-5+ up days, 100%+ above the 200sma, through the upper
  Bollinger band, stacked open gaps a 5-star bonus" and "short an opening-range-low break, or a topping pattern through VWAP,
  add at ORL/LOD; target the daily 9ema."
- t10261 (2025-02-18), GRAL: "4 up days in a row; speculative theme; clear parabolic action" and "highest opening 65min volume
  ever by 2x".
- t10902 (2024-11-20): statistics quoted in 4.1.
- t10712 (2024-05-08), SLV/GLD: "Low-volume wedging higher after a blow-off is a trap to the long side".

### 6.6 UCT-named examples, checked on our bars

Metrics at the climax day. Boxes = Bracco's boxes 1 to 4 (box 5, the gap, shown separately). Extension at the prior close.
ATR multiples: 2025 form / Jeff Sun form (4.2). "9 EMA" = sessions until a low reached the prior day's 9 EMA. "New high" =
a trade above the climax high within 40 sessions. Scanner = our `parabolic_short.py`.

| Ticker, climax day | Named by | Gap | Open to close | Up days / gap streak / boxes | Over 9 EMA / 50-day / 200-day | ATR multiples | Volume | 9 EMA | New high | 10-day drop | Scanner |
|---|---|---:|---:|---|---|---|---|---:|---|---:|---|
| SMCI 2024-02-16 | Bracco 5-star | +4.1% | -23.2% | 9 / 3 / 4 | 28% / 136% / 238% | 9.89 / 25.67 | year high | 1 | day 10 | 14% | no |
| NVDA 2024-03-08 | Bracco 5-star | +2.7% | -8.0% | 6 / 7 / 4 | 10% / 42% / 87% | 7.98 / 12.16 | 3rd of year | 1 | none | 4% | no |
| MSTR 2024-11-21 | Bracco 5-star; Breitstein | +13.0% | -25.8% | 4 / 7 / 3 | 28% / 113% / 199% | 7.36 / 15.52 | year high | 2 | none | 15% | yes |
| TIGR 2024-10-07 | Bracco 5-star | +12.1% | -17.5% | 5 / 2 / 3 | 67% / 192% / 204% | 11.27 / 27.95 | year high | 2 | none | 41% | yes |
| MRNA 2020-12-01 | Bracco 5-star | +16.3% | -20.6% | 3 / 4 / 4 | 36% / 93% / 152% | 9.64 / 17.24 | year high | 10 | day 40 | 9% | no |
| PLUG 2014-03-11 | Bracco 5-star | +11.0% | -47.3% | 2 / 3 / 2 | 50% / 173% / 622% | 9.55 / 22.47 | year high | 1 | none | 12% | yes |
| QCOM 2000-01-03 | Bracco tables (row 12/31/99) | +13.1% | -10.0% | 1 / 6 / 2 | 23% / 89% / 263% | 8.42 / 14.29 | not a high | 2 | none | 26% | no |
| UAMY 2025-10-14 | Bracco (Rest of the Week) | +16.7% | -10.4% | 7 / 10 / 4 | 56% / 191% / 418% | 8.76 / 24.61 | year high | 2 | none | 49% | no |
| KORU 2026-02-26 | Bracco (6.2) | +8.7% | -5.5% | 2 / 3 / 1 | 22% / 102% / 299% | 7.40 / 16.43 | year high | 2 | none | 51% | no |
| SLV 2026-01-29 | Bracco 2026 table | +3.7% | -3.6% | 5 / 2 / 2 | 14% / 62% / 144% | 7.78 / 13.32 | 2nd of year | 1 | none | 38% | no |
| CAR 2026-04-22 | Bracco watched it (2026-04-14) | +8.5% | -42.7% | 4 / 2 / 3 | 50% / 296% / 357% | 9.50 / 35.98 | 2nd of year | 1 | none | 65% | yes |

Counter-examples (what not to short):

| Ticker, day | Why it matters | What happened |
|---|---|---|
| AGQ 2026-01-14 | gap +12.2% but closed above its open, near the high (no crack); Bracco's "3 failed attempts" came that week | a new high 3 sessions later, before the 9 EMA (11 sessions) |
| MSTR 2024-03-08 | gap +2.2%, closed +7.3% over its open, only 1 box | shorting that close lost 4.5R on the next day's gap up |
| RGTI 2025-09-24 | gap +3.9% and red, but 1 up day before it and 2 boxes; fresh out of a base (Bracco: "very short lived") | a new high 6 sessions later; the 9 EMA only on day 16 |
| SLV 2025-12-26 | gap +4.0% but closed green near the high; the crack came overnight in futures | gapped down -7.7% the next session (the day-2 shape) |

CIFR (2025-09-25), which Bracco called "The only standout setup", spiked in the premarket; on regular-hours bars the day
opened 3.9% lower, so daily bars cannot show it. Not usable as a daily-chart example.

---

## 7. How it fits the account rulebook (section 9)

| Rule | How it applies | Conflict? |
|---|---|---|
| B26, 200-day | Every five-star example sat 87% to 622% above the 200-day; 98% of my proxy events closed above it. The rule's own exception covers this setup, defined by Bracco's post. | No, by the exception. The exception should name the test (question 4). |
| D47, short stop and target | "stop sits above the day's high and its target is the 9-day average (Bracco's post)". | No. Kullamägi's 10/20-day target is the outside alternative. |
| A3 / F62, stop a few cents past the day's extreme | Mirrored: a few cents over the climax day's high. Bracco and Kullamägi agree. | No. |
| A13, stops usually within about 3% | The honest stop is wider: median 4% from an hourly VWAP entry (31% within 3%), 6% from the climax close, 13-14% on the biggest climaxes. | **Yes.** The size shrinks under A5 (fewer shares), which keeps the risk right; question 5. |
| A5, full size at one price, one stop | Bracco enters in two steps (VWAP break, then the day's low); Stamatoudis scales in. | **Yes**; question 7. |
| E57, market orders | Fits an intraday break. | No. |
| C28, no chasing past 4% | Mirrored: no short more than 4% under the trigger (the VWAP break). | No (my proposal for the reference point). |
| C29, too stretched to buy | Does not apply to shorts. The parabolic short is the opposite case: it needs a stock far above its 10-day. | n/a |
| C31, RS 80+ (shorts RS 20 or less) | Parabolic shorts are the strongest stocks. The owner's exception ("unless parabolic") covers it. | No, by the exception; the short-side mirror (RS 20 or less) must not apply here. |
| B19 / E51 / E52, breakeven 2R, trims at 3R and 5R, trail the 10/21-day | The setup has its own exit: the 9 EMA, usually about 2R from a close entry. 3R and 5R often never come before the target. The mirrored trail cannot start until price is back under the 10-day. My house-management test did no better than covering at the 9 EMA. | **Yes**; question 6. |
| B20, gap through the stop | Mirrored: a gap up over the stop; the first 30-minute high is the new stop; out past 2R. | No. |
| C33, time stop (under 1R after 10 days) | Too slow here. The 9 EMA came in a median 3 sessions on the A+ cut, 5 on the broad proxy; Bracco's examples took 1 to 2 (MRNA 10). | **Yes**; a 3-session limit is proposed (8.5). |
| C35, swing trading | Bracco day-trades most of it and holds overnight only "if the risk is paid for". | **Partly**; question 2. |
| A6 / B25 / E54, shares; options occasionally; leveraged ETFs preferred | Bracco uses puts and inverse leveraged ETFs (MSTZ, ZSL) as well as shares, and says beginners should short shares. | No conflict for shares; question 9 for other vehicles. |
| D48, skip hard-to-borrow shorts | Squeeze names are often hard to borrow (Kullamägi uses special locates). | No; an inverse ETF can stand in where one exists (question 9). |
| B22, earnings | Mirrored: no new short in the 3 days before a report. | No. |
| B23 / D42, liquidity | Bracco prefers mid-to-large caps; my proxy's median 50-day dollar volume was $84M. | No. |
| D46 / F65, Red market: mostly cash and shorts | Parabolic shorts happen in hot markets: SPY was above its 200-day for 92% of proxy events; Stockbee: they work "During a bullish market". | **Yes**: the market filter must allow this short in Green; question 10. |
| D38 / E49, size by grade | Fits. The notebook template's "size small" and the course plan's "smallest size in the catalog" do not. | **Yes, with the app text**; question 5. |
| B21 / E56, re-entry; at most 3 tries a week | Bracco's AGQ: 3 attempts in 2 sessions, then stopped. Fits. | Conflicts with the template's "Do not re-short" (5.5). |
| C34, sell into a parabolic burst on your own long | The long-side twin of this setup; Bracco writes his shorts partly to help longs trim. | No. |
| B16 / A8, loss limits and the drawdown ladder | Apply as usual. A squeeze gap can exceed 1R (my worst T1 cases lost 4R to 5R on a gap). | No, but teach the gap risk. |

---

## 8. Proposed rules for our course

### 8.0 Which versions

- **Version P1, the climax-day short** (Bracco's main setup, Kullamägi's entry). Full size by grade. [UCT; originator]
- **Version P2, the day-2 gap down** (Bracco's variant). Smaller size. [UCT]
- **Not taught as an entry:** shorting into strength before a crack; the scanner's next-day break of the climax low with a
  stop over the climax high. [UCT; originator; measured]

### 8.1 What it is

- A short taken on the day a 3 to 5 day vertical burst exhausts itself, after the intraday trend turns down, covered at the
  daily 9 EMA. [UCT]

### 8.2 The setup (every line measurable)

1. **Prior move.** Already a large advance: large caps +50% or more, small caps +300% or more, in days or weeks.
   [originator] And at the prior close, all three: 10%+ above the 9-day EMA, 40%+ above the 50-day SMA, and 10+ on Jeff
   Sun's ATR multiple. [UCT: his table's lowest rows and his "10x" reading; my proposal for the exact cut]
   - Recommend one formula: Jeff Sun's (percent over the 50-day SMA divided by the 14-day Wilder ATR as a percent of
     price), because Bracco has used it since 2025-09 and the app can compute it. [my proposal]
2. **Structure: parabolic, not linear.** Each base or pause shorter than the one before, pullbacks shrinking, ATR rising.
   [UCT] Measurable form: the last 2 to 3 weekly ranges each larger than the one before. [UCT 2026-05-10; my proposal for
   the count]
3. **The burst (3 to 5 days).** Count Bracco's boxes: (a) 3+ straight up closes before the climax day; (b) 2+ straight
   overnight gap ups, the climax gap may count; (c) in 2 of the last 3 days the percent gain beat the day before; (d) volume
   up 2 days in a row. [UCT] Need 3 of 4 for a full-size grade; 2 of 4 only with exceptional extension (Bracco's two-day
   exception, his PLUG and KORU). [UCT; measured: under 3 boxes did about nothing]
4. **The climax-day gap.** The climax day opens above the prior close. Required. [UCT; Breitstein, secondhand] A gap of
   5%+ is stronger. [measured]
5. **Volume.** The climax day's volume, and ideally its first 5 to 15 minutes, the highest of the run. [UCT; measured:
   year-high volume helped]
6. **Location.** Above the 200-day by nature; allowed by the B26 exception for setups that pass lines 1 to 4. [house rule]
7. **Liquidity and borrow.** $10+ and $20M+ a day (B23); shares available to borrow at a fair fee (D48). [house rule]
   Mid-to-large caps preferred. [UCT]
8. **Not this setup:** a steady, linear trend however far it has run (AAPL 2023 is Bracco's example); day 1 or 2 of a
   burst; a stock in week 1 out of a long base. [UCT]

### 8.3 The trigger and the order (P1)

1. On the climax day, after the gap up, do nothing at the open. [UCT; originator; Stamatoudis]
2. Short when the stock breaks back under the session VWAP after the high is set, usually 10 to 60 minutes after the open
   (the U-Turn). [UCT] Kullamägi's alternatives: a break of the 1 or 5-minute opening range low, the first red 5-minute
   candle, or a failed bounce into VWAP. [originator]
3. Market order (E57). [house rule]
4. No chasing: skip if the price is already more than 4% under the VWAP break. [house rule C28 mirrored; my proposal for the
   reference point]
5. One entry, full size, one stop (A5) [house rule], unless the owner allows Bracco's second entry at the break of the
   day's low (question 7).
6. A 1 to 2 day window: if the trigger fails twice or the window passes, drop the idea. [Stamatoudis; house E56 caps
   tries at 3 a week]

**P2 (day-2 gap down).** The climax day closes in the middle or top of its range (a hanging man or doji at the high), and
the next day gaps down. Short an opening-range breakdown while the gap stays unfilled. Stop a few cents over the prior close
(the gap fill) or the day's high, whichever the owner picks. Smaller size. [UCT; my proposal for the stop]

### 8.4 The stop

- A few cents over the climax day's high (the high at the time of entry). [UCT; originator; house rules D47, F62]
- If the price reclaims the day's high, you are out; no widening. [UCT; house rule A4]
- Size from that stop (A5). Expect it wider than 3%: median about 4% from a VWAP entry. If the stop does not fit the risk
  budget, skip (A3). [measured; house rule]
- A gap up through the stop: the first 30-minute high is the new stop; out if the loss passes 2R (B20 mirrored). [house
  rule]

### 8.5 Target, trims and trail

- Cover at the daily 9 EMA. [UCT; house rule D47] (Kullamägi's 10- and 20-day MAs are the outside option.) [originator]
- Intraday, after the second leg down, trail over the previous 5-minute bar high, then the 5-minute 20 EMA or VWAP.
  [UCT, from Breitstein]
- Overnight: hold only if the trade is already in profit ("if the risk is paid for"), with the stop no worse than
  breakeven. [UCT; my proposal for "breakeven"]
- These replace the default 3R/5R trims and the 10/21-day trail for this setup. [my proposal; question 6]
- Time limit: if the 9 EMA is not reached within 3 sessions of entry, cover. [my proposal; measured: a median 3 sessions
  to the 9 EMA inside the T1 trade on the A+ cut, 5 on the broad proxy; the Discord summary t10902 says "2-3 days to
  reach the 9 EMA"]

### 8.6 What invalidates it

- No gap up on the climax day (then it is not P1). [UCT]
- The high of the day is reclaimed (stop). [UCT; originator]
- A VWAP reclaim after a VWAP-fail entry. [originator]
- The run is linear, or fewer than 2 boxes, or less than 10% over the 9 EMA. [UCT; my proposal for the cut]
- Hard to borrow (D48); an earnings report within 3 days (B22 mirrored). [house rule]

### 8.7 The mirror

- The parabolic long (setup 38) is the mirror: a 3 to 5 day burst down, a gap down on the capitulation day, a long on the
  intraday turn, target the 9 EMA from below. The owner confirmed the mirror ("1, yes"). Kullamägi's long: after a short
  "goes down 50-60%+ in a few days". [house rule; originator] Bracco notes that a blown-off short candidate can turn into a
  mean-reversion long within days (UAMY, CAR). [UCT]

### 8.8 Best market conditions

- A hot, euphoric tape, often near the end of an up-cycle: "each cycle almost always ends with biggest and best leaders
  going parabolic and blowing off top." [UCT] Stockbee: they "can work very well" in a bullish market. [Stockbee]
- An index that is itself short-term stretched adds conviction. Bracco (2025-09-21): "One thing that does help add a
  little confidence to these setups is the euphoric sentiment post fed meeting and ETF’s like ARKK and QQQ becoming a
  little short-term extended." [UCT]
- Thursdays and Fridays into monthly options expiration, when a gamma squeeze is fading (the 20-delta distance narrowing).
  [UCT]
- [measured] 92% of proxy events came with SPY above its 200-day. The few with SPY under it did as well or better (n=25).

### 8.9 Common mistakes

1. Shorting too early, into strength, at the highs. [UCT; originator; measured: green climax days won 23%]
2. Adding to a losing short, or averaging up. [UCT]
3. Judging "parabolic" by percent gain alone; shorting a linear trend. [UCT]
4. Shorting day 1 or 2 of a burst, or a stock just out of a base. [UCT]
5. Holding a big position overnight; widening the stop. [UCT; Stamatoudis; house rule A4]
6. Obsessing over an idea after its window passes; revenge-shorting after a stop. [UCT; Stamatoudis]
7. Trading the news narrative instead of price and volume. [UCT]
8. Oversizing because the setup "has to" work (Breitstein's Avis loss). [secondhand]
9. Choosing the wrong vehicle, or a hard-to-borrow name. [originator; house rule D48]
10. Using a target or stop from no source (the scanner's 50-bar low, a 43% stop). [measured]

### 8.10 Example candidates (UCT-named; checked on the bars; not yet ruled by the owner)

The eleven in 6.6: SMCI 2024-02-16, NVDA 2024-03-08, MSTR 2024-11-21, TIGR 2024-10-07, MRNA 2020-12-01, PLUG 2014-03-11,
QCOM 2000-01-03, UAMY 2025-10-14, KORU 2026-02-26, SLV 2026-01-29, CAR 2026-04-22. Counter-examples for the do-not-short
lesson: AGQ 2026-01-14, MSTR 2024-03-08, RGTI 2025-09-24, SLV 2025-12-26. Bracco's day-2 variant examples (DJT, FUTU, TASR,
TSLA, CGC, UVXY) belong to P2. Charts of all fifteen (split-adjusted prices, with the climax high and the prior day's 9
EMA drawn) are rendered in my scratch folder, not the repo.

---

## 9. Grading: what makes an A+ versus a B-

Grading is the owner's call (E50). These are observable marks from the sources and the test.

| Mark | A+ ("5-star") | B- (3 or fewer stars) | Basis |
|---|---|---|---|
| Burst boxes | all 4, plus the climax gap | 2 or 3 | UCT; measured (4 boxes best, 3 about nothing). A guide, not a gate: Bracco's own PLUG had 2 boxes and KORU 1 (6.6). |
| Extension at the prior close | above Bracco's averages (2026 table: about 17 Jeff Sun ATR multiples, 23% over the 9 EMA, 41% over the 20 EMA, 85% over the 50-day) | near his lowest rows (about 10% over the 9 EMA, 40% over the 50-day) | UCT; measured (A+ cut best) |
| Climax gap | large, 5%+ | small | UCT ("significant"); measured |
| Volume | the climax day's volume, and its opening minutes' volume, the highest of the run | rising but not a record | UCT; measured |
| Curve | exponential; shrinking bases; weekly range expansion for 3+ weeks, biggest in week 3 or 4; parabolic on a log chart | linear stair-steps | UCT |
| Intraday | a clean U-Turn: a run at the open, then a fast break under VWAP and the day's low | choppy range for 1 to 2 hours (Long-Drawn-Out Range Breakdown), or a Quick Opening Range Breakdown on day 1 or 2 | UCT (he links the first to 3 to 4-star setups) |
| Context | hype, a round-number top, Thursday or Friday into monthly expiration, the gamma gauge narrowing, the index stretched | no catalyst for exhaustion; a market just starting a rally | UCT |
| Version | P1 | P2 (day-2 gap down): "Any other variation may be taken with smaller size." | UCT |
| Cap | mid or large, liquid, easy to borrow | small cap, hard to borrow | UCT; house rule D48 |

---

## 10. Questions for the owner

1. **Which versions do we teach?** (a) P1 only, the climax-day short; (b) P1 and P2 (day-2 gap down) at smaller size; (c)
   also a swing version on daily bars. I recommend (b): both are Bracco's, and P2 had the cleaner stop in my test.
2. **Day trade or swing?** (a) teach it as Bracco trades it, mostly intraday, overnight only when in profit; (b) a swing
   short held to the 9 EMA with a daily stop. I recommend (a); C35 needs a note for this setup.
3. **The target.** (a) the daily 9 EMA (Bracco; D47 already says so); (b) Bracco's later "9 or 10 day"; (c) Kullamägi's 10
   and 20-day. I recommend (a).
4. **The B26 exception test.** Which test makes a stock "parabolic" for the 200-day exception? (a) Bracco's five boxes,
   3 of 4 plus the gap; (b) that plus an extension floor (10% over the 9 EMA, 40% over the 50-day, 10+ Jeff Sun ATR
   multiple); (c) your judgment per chart. I recommend (b), so a scanner and a quiz can apply it.
5. **The stop width and size.** The honest stop is usually 4% to 14%, not 3% (A13). (a) allow it, with smaller share size
   under A5; (b) skip any setup whose stop is over a set width (say 8%); (c) use a tighter intraday stop (Kullamägi's VWAP
   reclaim). And: should the app's "size small" / "smallest size in the catalog" be replaced by the normal grade sizing (D38,
   E49)? I recommend (a) and replacing the "size small" text.
6. **Trims and trail.** (a) the setup's own exit (cover at the 9 EMA; intraday trail over the prior 5-minute high) replaces
   3R/5R and the 10/21-day trail; (b) keep the house trims. I recommend (a); my test found the house trims added nothing
   here.
7. **One entry or two?** Bracco shorts at the VWAP break and again at the day's low. A5 says one price, one stop. (a) one
   entry at the VWAP break; (b) allow his second entry as an add only after the first is in profit.
8. **Which ATR multiple do we teach?** (a) Jeff Sun's percent form (Bracco since 2025-09); (b) the 2025 points form;
   (c) percent extensions only. I recommend (a), with the formula written out.
9. **Vehicles.** (a) shares only (A6; Bracco says beginners should short shares); (b) also inverse leveraged ETFs (E54) and
   puts (B25), as Bracco does on hard-to-borrow or options-priced names.
10. **The market filter.** These setups come in Green markets. (a) allow the parabolic short in Green and Yellow markets;
    (b) only where F65 allows shorts (Red). I recommend (a).
11. **Small caps.** Kullamägi trades 300-1000% small-cap runs; Bracco prefers mid and large caps. Include small caps that
    pass B23 and D48?
12. **Re-entry.** The plan template says "Do not re-short the same run after you are stopped out"; B21 and E56 allow a new
    trigger, up to 3 tries a week. Which wins?
13. **The scanner.** Replace `parabolic_short.py` with Bracco's checklist (boxes, extension, climax gap, red close as the
    daily trace) and delete the invented narrative (5.5)? Also fix the voice entry, the patterns description and the Model
    Book glyph (add the climax gap)?
14. **Quoting UCT's posts.** This public dossier quotes short Sunday Scans and Rest of the Week passages. Is that fine, or
    should those quotes move to the private side?
15. **Examples.** Approve, cut or add to the eleven examples and four counter-examples in 6.6.

---

## 11. Sources (all read on 2026-11-09)

| # | Source | URL | Publisher / author | Date | Reliability note |
|---|---|---|---|---|---|
| 1 | "The Parabolic Short" | https://unchartedterritoryy.substack.com/p/the-parabolic-short | UCT Substack / Bracco | 2025-06-13 | House definition by owner ruling. Saved text; the 2025 extension table read from its image. |
| 2 | Sunday Scans and The Rest of the Week, all 103 sitemap posts (links in 3.2 and 6) | https://unchartedterritoryy.substack.com/sitemap.xml | UCT / Bracco, TSDR, unsigned | 2025-06 to 2026-11 | House; authorship from section headings. One subscriber-only post had no text. The 2026 extension table (2026-05-10) read from its image. |
| 3 | "3 TIMELESS setups that have made me TENS OF MILLIONS!" | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Kristjan Kullamägi | 2021-01-08 (upd. 2021-04-28) | Originator, primary. |
| 4 | FAQ; "Lessons from a $140K loss" | https://qullamaggie.com/faq/ ; https://qullamaggie.com/lessons-from-a-140k-loss/ | Kristjan Kullamägi | 2021-04-27; 2020-04-08 | Originator, primary. |
| 5 | CTE Research Sheet: Lance Breitstein | https://completetradersedge.com/wp-content/uploads/2026/09/CTE-Research-Sheet-Lance-Breitstein-market-wizards-next-generation.pdf | Complete Trader's Edge (summary of Schwager & Coyle, 2026, ch. 2) | 2026 | Secondhand summary; the book itself not read. The sheet names the book, both authors, 2026 and "Chapter 2" but not the publisher; Harriman House's own listing (harriman-house.com, published 2026-06-09) showed in search results in both passes and was not opened. |
| 6 | "Unlock Massive Profits with Parabolic Shorts: 6 Essential Nuances" | https://web.archive.org/web/20250513105402/https://traderlion.com/profile/marios-stamatoudis/parabolic-shorts/ | TraderLion / Marios Stamatoudis | 2025-01-24 | Established educator site; archived copy (live site blocks fetches). |
| 7 | The Cycle of Price Action (home page) | https://kelltrading.com/ | Oliver Kell | read 2026-11-09 | Originator of the cycle, primary. |
| 8 | "Exhaustion Extension: How to Sell into Strength" | https://web.archive.org/web/20240915143622/https://traderlion.com/technical-analysis/chart-patterns/exhaustion-extension-sell-into-strength/ | TraderLion / Ameet Rai, on Kell | 2024-09-11 | Educator summary of Kell; archived copy. |
| 9 | The Wyckoff Method: A Tutorial | https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial | StockCharts / Roman Bogomazov, Michael Lipsett | n/a | Established educator (Wyckoff Analytics school). Same text: https://www.wyckoffanalytics.com/wyckoff-method/ |
| 10 | Gaps and Gap Analysis | https://chartschool.stockcharts.com/table-of-contents/chart-analysis/gaps-and-gap-analysis | StockCharts ChartSchool | n/a | Established educator. |
| 11 | "Investor's Corner: When To Sell On The Way Up" | https://finance.yahoo.com/news/investors-corner-sell-way-183200275.html | Investor's Business Daily (on Yahoo Finance) | 2014-04-04 | Read through a fetch tool (plain request refused). |
| 12 | Vertical Run Up | https://thepatternsite.com/VerticalRunUp.html | Thomas Bulkowski | n/a (data 1995-2014) | Measured statistics. Site states it "shall not be used to train artificial intelligence (AI) systems". Read through a fetch tool. |
| 13 | Stockbee guides teaser | https://stockbee.blogspot.com/2022/10/if-you-are-member-check-out-new-guide.html | Pradeep Bonde | 2022-10-23 | Primary, but one line only. |
| 14 | "Bubbles for Fama" | https://www.nber.org/papers/w23191 | NBER / Greenwood, Shleifer, You | 2017-02 | Peer-level research; abstract only read. |
| 15 | "Maxing Out" | https://www.nber.org/papers/w14804 | NBER / Bali, Cakici, Whitelaw | 2009-03 | Research; abstract only. |
| 16 | "Fads, Martingales, and Market Efficiency" | https://www.nber.org/papers/w2533 | NBER / Bruce Lehmann | 1988-03 | Research; abstract only. |
| 17 | "Short Sale Constraints and Stock Returns" | https://www.nber.org/papers/w8494 | NBER / Jones, Lamont | 2001-10 | Research; abstract only. |
| 18 | "Systemizing Kullamägi’s Parabolic Short Setup" | https://stonkscapital.substack.com/p/systemizing-kullamagis-parabolic | Niv Goren | 2025-02-10 | Read; not used (rules undisclosed, tool promotion). |
| 19 | "Identifying Stocks to Fade" | https://concretumgroup.substack.com/p/identifying-stocks-to-fade | Concretum Research | 2026-05-23 | Paywalled; not used. |
| 20 | App code: `parabolic_short.py`, `patterns.py`, `screener/base_catalog.py`, `chart_iq/engine/v2_setups.py`, `markup.py`, `kell_cycle.py`, `voice_kb/trading_principles.json` | this repo | this app | as of 2026-11-09 | Read in full where relevant. |
| 21 | App text: `setupCatalog.js`, `setupPlaybooks.js`, `setupGroups.js`, `setupTagMap.js`, `notebookTemplates.js`, `fingerprintChecklist.js`, `docs/curriculum/uct_method_course.json`, `docs/study/UNITS-method.md` | this repo | this app | as of 2026-11-09 | Read. |
| 22 | House rules: `docs/study/sizing_rule.md` section 9; `docs/study/TRADE_PLANS.md`; `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | this repo | the owner | 2026-11-09 | The rulebook and rulings. |
| 23 | Lift ledger `docs/base_lift_ledger.json`; brain KB `docs/study/levels/brain_kb_*.json` | this repo | this app | 2026-09-01; 2026-11-06 | Ledger: our measurement. Brain KB: machine summaries of Discord posts, not exact words. |
| 24 | Daily bars (`bars.db`, workbench copy) and hourly bars (shared intraday store) | local | the app's own data | to 2026-11-09 | Used for every [measured] number; read-only; survivorship bias against shorts; method in 4.2. |

---

## 12. Checked, changed and removed in checking (2026-11-09, second pass)

**How it was checked.** All 24 sources were opened again from their URLs (the two that refuse plain requests, Bulkowski
and IBD on Yahoo, through a fetch tool, which returned the sentences quoted here word for word). A script matched every
quoted string in this file against the saved page text and the repo files; the few it could not match are code strings
split across lines in the source (`setupPlaybooks.js`, `parabolic_short.py`) and were checked by eye. The scanner
summary (5.1) was read against `parabolic_short.py` line by line: every gate, level, score weight and narrative claim is
as stated. The Chart IQ, Kell-cycle, screener, voice-KB, patterns-API, Model Book, journal-tag, template, fingerprint and
course passages (5.2, 5.3) were read in the code and match. The owner's words in 5.4 are in `owner_verdicts.jsonl` lines
555 to 584 as quoted. Both extension tables were re-read from the images in the posts (2025: 8.81 / 21% / 37% / 77% /
172.50%; 2026: 17.01 / 22.88% / 40.62% / 85.25% / 191.88%, with NVDA 12.6, SMCI 25.67, MSTR 15.52, SLV 13.32, INTC 18.74,
SNDK 14.57, MU 12.61). The proxy facts in 4.2 (n=325, median $84M dollar volume, 98% above the 200-day, SPY above its
200-day 92%, median stop 6%, over 3% in 81%, over 10% in 26%, 9 EMA a median 11% below and 1.97R away, 51% reached before
a new high) were recomputed from the saved event file and agree; the per-example numbers in 6.6 were checked against the
saved example file. Every post date in 3.2 and 6 matches the page's publish date. The CTE sheet's trade-log table reads
misaligned in plain text; read row by row, the Avis short (2 Nov 2021, "Upside capitulation") is the one with "Over $2
million lost in under an hour", as 3.4 says. Section 8 uses no [source consensus] tag, so none needed two sources.

**Changed.**
- Section 2: the Jeff Sun credit is in Sunday Scans 2025-09-21 and 2026-05-10, not in the 2025 post (which names
  Breitstein, Stamatoudis and Steven Place); and the 2025 post already describes the gap-down top formation, so what came
  later (2025-12-28) is the name "day 2 gap down", not the variant.
- Section 3.8 and 3.9: IBD's framing sentence and Bulkowski's signal sentence added as exact quotes.
- Section 4.1: the Bulkowski "79%" line is now his exact sentence instead of a paraphrase.
- Section 4.2 and 8.5: "median days to the 9 EMA" now says which count it is (inside the T1 trade, where a stop-out counts
  as never reaching it: 5 sessions, 3 on the A+ cut); the plain first touch came in a median 2 sessions.
- Section 8.2 line 4: the Breitstein tag now carries "secondhand", as the tag legend requires.
- Section 8.8: the ARKK/QQQ line now carries Bracco's exact words (2025-09-21).
- Section 11, source 5: the sheet does not name the publisher; Harriman House comes from the publisher's listing seen in
  search results.

**Removed.**
- Section 8.3 line 6: the basis tag UCT "move on". The only "move on" in Bracco's posts (2026-01-18, "Just have to review
  it, learn, and move on.") is about a mental mistake on a long trade, not a rule about a window for the parabolic short.

**Still not verified (unchanged, flagged).** The book behind the CTE sheet; Kullamägi's X posts and streams (the source of
the two lines Bracco attributes to him, 3.1 and 6.2); O'Neil's book list of climax signs (a web search in this pass also
found no investors.com page with it); the hourly-bar test (T3) was not re-run.

---

## 13. Examples (from our data)

**The scan's rule (one paragraph).** Daily bars from the local sandbox, scanned over the house liquid universe (the 2,630
names that ever met B23; all 2,630 scanned in 226s, nothing cut for time), 1984 to 2026-11-06. A hit is a
climax day that meets section 8.2 on the daily bars: at the prior close, 10%+ over the 9-day EMA, 40%+ over the 50-day
SMA, Jeff Sun ATR multiple (percent over the 50-day divided by the 14-day ATR as a percent of price) 10 or more, and a
run of 50%+ from the lowest low of the prior 60 sessions; the last three 5-day ranges each larger than the one before
(parabolic, not linear); 3 of Bracco's 4 boxes (3 straight up closes before the day, 2+ gap-up opens in the last 4 days,
the day's gain beating the day before in 2 of the last 3, volume up 2 days running); the climax day opens above the
prior close (any size), its volume is the highest of the prior 20 sessions, and it closes red (the daily-bar stand-in
for the intraday U-turn, because daily bars cannot see the VWAP break); prior close $10+ and 50-day dollar volume $20M+
(B23); shorts on either side of the 200-day (the B26 parabolic exception). Entry: a market order at the climax day's
close; stop 0.1% plus a cent over the climax high (8.4); one hit per name per 20 sessions. Not coded: the intraday
trigger, the chase limit (it has no VWAP to measure from), the 9 EMA cover, the borrow check, the earnings window and
the overnight rule. Outcome: from the next session, 60 sessions forward, the first of stop / 3R / 5R on the shorted
distance; same session, the stop wins.

**Base rate.** 48 hits in the whole database (38 on stocks, 10 on leveraged or commodity ETFs). Of all hits,
**18.8% reached 3R and 12.5% reached 5R before the stop**; 27 (56%) were stopped within 60
sessions. On the stock hits alone: 5 of 38 (13.2%) reached 3R, 3 (7.9%) 5R. A relaxed pass
that also allows 2 of 4 boxes when the ATR multiple is 15 or more (8.2 line 3's exception) found 57 hits, 15.8% to
3R and 10.5% to 5R. Window: 1984 to 2026-11-06, with the first hit in 1997. **Caveats:** this is a fixed stop with
no trims, no 9 EMA cover, no breakeven move and no time limit, so it measures how often the structure delivers 3R and
5R from a climax-close entry, not what the house trade earns. The close-entry proxy puts the stop a median 13% away
(the real VWAP-break entry is nearer the high; the dossier's own proxy in 4.2 measured a median 6%), so one R here is
large and 3R usually lies beyond the 9 EMA target; the setup's own cover rule (8.5) would have closed most of these
trades at 0.5R to 2R within 2 to 6 sessions. The real intraday trigger on hourly bars (the T3 test named in section 12)
was not re-run in this pass.

**The 10 examples** (all stocks, one per name, eight different years, prices split-adjusted as the database holds them;
the first four reached 3R, three of them 5R; the other six are the next-best clean climax structures and their best R is
stated as measured). Files: `scratchpad/setups/39-parabolic-short/final/NN_TICKER_DATE.png` and the phone sheets
`sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png` (not in the repo). Burst = from the lowest low of the 15 sessions
before the climax to the climax high.

| # | Ticker | Climax day | Structure | Short | Stop (risk) | Best R; sessions to the 9 EMA | Why it is textbook |
|---|---|---|---|---|---|---|---|
| 1 | GDS | 2025-02-20 | +145% in 13 sessions (+150% in 60); 21% over 9 EMA, 75% over 50-day, ATR x11.4; 4/4 boxes; gap +15.4%; vol 1.45x 20-day high; above 200-day | 48.5 (close) | 52.56 (8.4%) | 7.78R (3R day 5); 9 EMA in 2 | The cleanest: 13-session burst from a flat base, 15% gap on record volume, closed red in the lower half; 9 EMA in 2 sessions, 5R in 5 weeks |
| 2 | CGC | 2021-02-10 | +74% in 12 sessions (+114% in 60); 14% over 9 EMA, 56% over 50-day, ATR x10.2; 3/4 boxes; gap +7.6%; vol 1.25x 20-day high; above 200-day | 521.7 (close) | 565.54 (8.4%) | 6.44R (3R day 2); 9 EMA in 1 | Cannabis mania top: three gap days into a 7.6% gap on 3x volume, long upper wick; the 9 EMA the next day, 5R in 6 weeks |
| 3 | BILI | 2024-10-02 | +121% in 12 sessions (+110% in 60); 28% over 9 EMA, 72% over 50-day, ATR x13.3; 3/4 boxes; gap +11.3%; vol 1.64x 20-day high; above 200-day | 29.66 (close) | 31.81 (7.2%) | 5.46R (3R day 4); 9 EMA in 4 | Twelve-session China-stimulus vertical, 11% gap on the biggest volume of the run, reversal close in the lower third; 9 EMA in 4 sessions |
| 4 | SCHW | 1999-04-14 | +94% in 14 sessions (+177% in 60); 24% over 9 EMA, 79% over 50-day, ATR x15.5; 4/4 boxes; gap +1.7%; vol 1.0x 20-day high; above 200-day | 46.08 (close) | 51.73 (12.3%) | 3.44R (3R day 42); 9 EMA in 1 | Dot-com bubble climax: 4/4 boxes, 24% over the 9 EMA, three record-volume days; the 9 EMA the next session, 3R by June (the 1.7% gap is the weak point) |
| 5 | LVS | 2009-09-16 | +56% in 10 sessions (+209% in 60); 17% over 9 EMA, 62% over 50-day, ATR x12.2; 4/4 boxes; gap +4.3%; vol 1.74x 20-day high; above 200-day | 18.67 (close) | 20.76 (11.2%) | 2.74R; 9 EMA in 6 | 2009 casino squeeze: 10-session burst, 4.3% gap on the run's record volume, closed near the low; 9 EMA in 6 sessions, 2.74R inside the 60-day window |
| 6 | CAR | 2020-06-08 | +225% in 15 sessions (+395% in 60); 27% over 9 EMA, 100% over 50-day, ATR x10.8; 4/4 boxes; gap +6.0%; vol 1.04x 20-day high; above 200-day | 32.28 (close) | 36.47 (13.0%) | 2.91R; 9 EMA in 2 | The only one under the 200-day (the B26 short side): a +395% V-rally ends with a 6% gap and a closing reversal; 9 EMA in 2 sessions |
| 7 | TPL | 2026-02-23 | +68% in 13 sessions (+86% in 60); 14% over 9 EMA, 49% over 50-day, ATR x10.8; 4/4 boxes; gap +2.8%; vol 1.18x 20-day high; above 200-day | 502.85 (close) | 547.76 (8.9%) | 2.95R; 9 EMA in 8 | 4/4 boxes and a close at the day's low, but the gap was 2.8% and the stock chopped under the climax high for five weeks before the real break: a slow one, taught as 'patience or the time limit' |
| 8 | GSAT | 2021-02-10 | +224% in 15 sessions (+593% in 60); 59% over 9 EMA, 213% over 50-day, ATR x22.1; 4/4 boxes; gap +39.9%; vol 1.05x 20-day high; above 200-day | 36.0 (close) | 44.75 (24.3%) | 2.71R; 9 EMA in 6 | A 40% gap on 20x average volume after a +593% run, the extreme form; the 24% stop meant 3R was never on the table (best 2.71R); the 9 EMA in 6 sessions |
| 9 | TIGR | 2024-10-07 | +327% in 15 sessions (+269% in 60); 67% over 9 EMA, 192% over 50-day, ATR x24.6; 4/4 boxes; gap +12.1%; vol 1.56x 20-day high; above 200-day | 11.46 (close) | 14.5 (26.5%) | 2.01R; 9 EMA in 2 | Bracco's own named example (Sunday Scans): ATR multiple 24.6, 12% gap, closed near the low; 9 EMA in 2 sessions; a 26.5% stop makes the house R small |
| 10 | TSM | 2000-01-26 | +60% in 13 sessions (+104% in 60); 17% over 9 EMA, 52% over 50-day, ATR x13.1; 4/4 boxes; gap +2.7%; vol 1.62x 20-day high; above 200-day | 23.98 (close) | 27.33 (14.0%) | 2.72R; 9 EMA in 2 | Dot-com era chip leader: 4/4 boxes, 1.6x volume, closed at the low; the 9 EMA in 2 sessions, then a marginal higher high that never reached the stop, 2.72R later |

**Notable failures (same scan, in words).** SMCI 2024-02-16 (Bracco's own example): 4/4 boxes, ATR multiple 22, the day
closed at its low 34% under the high, so the close-entry stop was 34% away; the stock rallied back through the climax
high within three weeks and the proxy trade lost; the hourly-bar trigger from the earlier pass (a VWAP break at 10:30,
short 90.01, stop 107.90) ran 1.16R before that same stop, so even the real entry needed the 9 EMA cover, not 3R. MSTR 2024-11-21: 3 boxes,
a 13% gap, closed in the lower sixth; the 9 EMA was 0.14R away and the stock never gave more than 0.77R before chopping,
a trade the cover rule handles and the 3R test cannot. PLUG 2021-01-13 (relaxed pass): a 6.5% gap, 3 boxes, 40% over
the 9 EMA, but the stock made a marginal higher high eight sessions later and the stop was hit before the real top on
2021-01-26; the first climax of a mania is not always the last. SLV, AGQ and SIVR on 2026-01-26 all hit and all lost
(stopped on the next leg up), which sides with the dossier's counter-examples in 8.10 and with keeping commodity ETFs
out of this setup.

## 14. Failures and near-misses (from our data)

(Charts 2026-11-10, same scan and same render as section 13, in `_study-resume/scratchpad/setups/39-parabolic-short/final/`:
`fail_1-4.png`, `near_1-4.png`, `pair_38-parabolic-long.png`. The strict scan has only 48 hits (27 stopped), so the
four losses are what the data gives; they are the four clean stock climaxes among the stopped hits, in four different
years. The near-misses come from `near_scan.py`, the section 13 rule re-run with the seven daily-bar gates (prior move,
extension, parabolic shape, boxes, climax gap, climax volume, red close) turned into flags, keeping the days that fail
exactly one gate and still sit 5%+ over the 9 EMA and 20%+ over the 50-day (`final/near_hits.json`, 2,630 of 2,630
names). Short = the climax close (the daily-bar proxy); stop 0.1% plus a cent over the climax high; "where it stopped"
is the first session whose high reached the stop. "9 EMA" is the first session whose low touched the daily 9 EMA, with
the open R at that average.)

**Four valid Parabolic Shorts that lost (every scan gate passed, traded by the proxy rules).**

| # | Ticker, date | The climax | Short | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | QCOM 1999-12-22 | +174% in 60 sessions; 12% over the 9 EMA, 55% over the 50-day, ATR x13.4; 3 of 4 boxes; gap +4.6%, 1.14x the 20-day volume high, closed at the low | 60.68 | 65.34 (7.7%) | day 3, 1999-12-28, high 66.06 | The 9 EMA on day 2 at 0.52R (the cover rule takes it there); a new high on day 3 took the stop; 20 sessions later the close was 27.7% above the entry. The first climax of a mania was not the last. | ps.window (a 1 to 2 day window, then drop the idea); ps.cover_9ema |
| 2 | TSLA 2020-07-13 | +129%; 18%, 63%, x12.6; 3 boxes; gap +7.4%, 1.67x, closed near the low | 99.80 | 119.80 (20.0%) | day 25, 2020-08-17, high 123.06 | 0.44R at best. The 9 EMA was only touched on day 8, and by then it sat above the entry (-0.07R). Twenty-five sessions of chop under the climax high, with the report of 2020-07-23 eight sessions after entry. | ps.time_limit (no 9 EMA within 3 sessions: cover); ps.earnings (the report inside the hold) |
| 3 | SMCI 2024-02-16 | +300%; 28%, 136%, x22.3; 4 of 4 boxes; gap +4.1%, 1.35x, closed at the low | 80.33 | 107.90 (34.3%) | day 10, 2024-03-04, high 115.50 | The 9 EMA on day 1 at 0.06R; 0.40R at best; a new high on day 10 took the stop; 20 sessions later +24.6%. Bracco's own five-star example, lost by the proxy entry. | ps.cover_9ema; ps.stop_width (a 34% stop does not fit the risk budget: skip, or the VWAP entry with its 4% median stop) |
| 4 | RGTI 2025-09-24 | +191%; 28%, 85%, x12.3; 3 boxes but only 2 up closes before the gap; gap +3.9%, 1.11x, closed at 41% of the range | 31.64 | 34.44 (8.8%) | day 6, 2025-10-02, high 35.81 | The 9 EMA on day 5 at 0.99R; 1.14R at best; a new high on day 6 took the stop; 20 sessions later +14.0%. Fresh out of a base, Bracco's "very short lived". | ps.not_this (week 1 out of a base, day 1 or 2 of a burst) |

**Four near-misses (the chart looks like a climax day; exactly one gate fails).**

| # | Ticker, date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|
| 1 | TSLA 2020-02-03 | ps.red_close_daily | the day closed 15.8% above its open, at 95% of its range (rule: a close under the open) | a green climax day with no crack: the real top came the next day (2020-02-04). A short at that close was stopped the next session at 0R |
| 2 | NVDA 2024-03-08 | ps.parabolic_not_linear | the last three 5-day ranges were 12.33, 5.27, 13.33: the middle week shrank (rule: each larger than the one before) | a steady leader's one-day reversal, the AAPL 2023 case of 8.10; 1.19R, then stopped |
| 3 | AAOI 2026-03-02 | ps.burst_boxes | 2 of 4 boxes: no 3 straight up closes, no acceleration (rule: 3 of 4) | a one-day 27.7% gap after a slow rise, the News Failure shape (23); 2.16R, then stopped |
| 4 | AVGO 2025-06-05 | ps.extension | the prior close was 6% over the 9 EMA and 31% over the 50-day (rule: 10% and 40%) | a leader at new highs, not stretched; the dip reached 3.6R before the stop, but it is a mean-reversion trade (36), not this setup |

**What the four losses have in common.** The proxy's entry at the climax close put the stop 8% to 34% away, so one R
was large and 3R was never the right yardstick: in three of the four the 9 EMA arrived within one to five sessions at
0.06R to 0.99R, and the cover rule (ps.cover_9ema) would have closed the trade before the stop. In three of the four a
new high came within three to ten sessions: the first climax of a mania is often not the last, which is what the 1 to
2 day window and the three-tries cap are for. The fourth (TSLA 2020) never reached the average in three sessions and
should have been covered by the time limit. For the member: this setup is paid at the 9 EMA, inside a few sessions, or
not at all.

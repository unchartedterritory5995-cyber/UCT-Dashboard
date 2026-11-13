# Setup 15: Wedge Pop (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page
or file named next to it and checked word for word against a saved copy (the check script and the copies are in the
session scratchpad, not in the repo). Three short quotes from Bulkowski's site were read through a fetch tool only
(the site blocks plain downloads), and are marked so. Nothing here is a ruling. Where I could not read a source, I say so
and give no wording from it.

**Cold check, 2026-11-09.** A second reader re-fetched every source on their own (the TraderLion archive copies, all 33
Weeklies Watch posts and all 103 UCT posts through Substack's post API, Kell's site, Deepvue, Trading Engineered, the X
embed, the TradingView pages, YouTube, Goodreads and Bulkowski through a fetch tool), re-read the repo files, re-ran the
app's own rule on the named pops and re-measured section 4.5 from the bars. A script found the quoted passages word for
word in saved copies of their sources; the few it could not match (sentences split across lines of code) were checked
by eye. What was wrong was fixed in place, what
could not be confirmed was taken out, and both are listed in section 12 at the end.

Tags used in section 8: **[source consensus]** several outside sources agree; **[originator]** Oliver Kell's own words
or pages published under his name; **[UCT]** UCT's own writers or the owner's verdict log; **[house rule]** the account
rulebook, `docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation, for the owner to accept or change.

Words used below. **The averages**: the 10-day and 20-day exponential moving averages (EMAs), Kell's pair. **SMA**: simple
moving average. **ATR**: average true range, the stock's typical daily range. **R**: the risk on a trade (entry minus
stop); 3R is a gain of three times that risk. **Pop day**: the day the stock breaks out of its tight range and closes back
above the averages. **Pivot**: the top of the tight range under the averages (Kell's word). **Reversal Extension**: Kell's
name for the capitulation low that comes before a Wedge Pop. **TSDR**: the owner, Patrick (his own Substack sections).

---

## 1. What it is

After a stock has fallen and been stretched below its short averages, it stops falling and drifts sideways or slightly
lower for a few days under the 10 and 20-day EMAs while its daily ranges shrink and the averages flatten toward price.
The Wedge Pop is the first strong day that breaks the top of that tight range and closes back above both averages,
ideally on a gap and rising volume. Oliver Kell treats it as the first buy of a new up-cycle (TraderLion's cycle page:
"The Wedge Pop is the first bullish signal after a reversal."), and TraderLion says he calls it "The Money Pattern".

**Why it works (the psychology).** The points below are reasoning, backed where shown by the sources. None is a measured
fact; section 4 shows how small the measured edge of a mechanical version is.

- **The panic sellers are already out.** The Wedge Pop comes after the capitulation Kell calls the Reversal Extension:
  "Fear takes over, and people finally sell, no longer able to withstand the pain of loss."
  ([TraderLion, "Cycle Of Price Action", Kell byline, 2024-09-10](https://traderlion.com/technical-analysis/chart-patterns/cycle-of-price-action-by-oliver-kell/))
- **The quiet days show sellers drying up.** "A key sign of a new uptrend is when distribution volume decreases while
  accumulation volume picks up."
  ([TraderLion, "Wedge Pop: The Money Pattern", Kell byline, 2024-09-11](https://traderlion.com/technical-analysis/chart-patterns/wedge-pop-the-money-pattern/))
- **Who is trapped under the averages.** While price sits under falling averages, shorts lean on them and people who
  bought higher sell every bounce into them. UCT's newsletter describes the mood before the pop: "Shorts are eager to put
  their positions back on, longs are getting chopped and nervous about another leg lower. This leads to basing and
  volatility contraction prior to a respectful move higher."
  ([Sunday Scans, 2026-04-05, INTRO, unsigned](https://unchartedterritoryy.substack.com/p/sunday-scans-356)) When a strong
  day clears the range and the averages, those shorts are wrong and must buy, and trend followers who wait for a close back above
  the averages start buying. (Reasoning, not a sourced fact.)
- **The tight range gives a clear line to be wrong at.** Kell's page: "If the price breaks above the pivot, the trend
  should continue upward." and "If the price fails and drops, the timing isn't right yet." (same TraderLion page)
- **Gaps show the crowd was caught off side.** The page says gaps show that "the street is caught off guard", and: "Most
  Wedge Pops that lead to new, powerful trends start with gaps." (same TraderLion page)
- **It finds the next leaders.** "This phase is critical for spotting relative strength against market indices."
  (TraderLion, "Cycle Of Price Action")
- **Why it is hard to trade before it.** UCT, citing Kell: "Based on Oliver Kell's cycle of price action if we are at
  the Reversal Extension and before a wedge pop then we know that this is the hardest period to trade."
  ([Sunday Scans, 2026-04-05, INTRO, unsigned](https://unchartedterritoryy.substack.com/p/sunday-scans-356)) The Wedge Pop
  is the event that ends that hard window.

---

## 2. Origin and naming

- **Who.** Oliver Kell, winner of the 2020 U.S. Investing Championship. TraderLion's author box on his articles: "Oliver
  Kell is a champion trader who achieved an impressive 941% return by winning the 2020 U.S. Investing Championship."
  The setup is step 2 of his six-step "Cycle of Price Action": Reversal Extension, Wedge Pop, EMA Crossback, Base 'n
  Break, Exhaustion Extension, Wedge Drop, then around again
  ([kelltrading.com](https://kelltrading.com/), read 2026-11-09). TraderLion's cycle page gives the same six in the same
  order and adds two downside steps after the Wedge Drop ("EMA Crossback Downside" and "Base n' Break Downside") before
  "Eventually, we will see a Reversal Extension, which will restart the Cycle of Price."
- **His nickname for it.** The TraderLion page says the Wedge Pop is "also called" The Money Pattern "by Oliver Kell",
  and that it "signals that a stock has bottomed and is starting a new uptrend." (TraderLion, 2024-09-11). TraderLion's course page lists the lesson as
  "Wedge Pop | The Money Pattern"
  ([course page, archive copy 2025-06-23](https://web.archive.org/web/20250623150402/https://traderlion.com/courses/swing-trading-masterclass-with-oliver-kell/)).
  His own site calls it "The highest-probability long entry." ([kelltrading.com](https://kelltrading.com/)); no number
  is given for that claim.
- **When.** The earliest dated public uses I could find:
  - 2021-10-15: Richard Moglen (TraderLion), summarising his interview with Kell published on January 13 (2021): "Similarly
    for buying, you can use an intraday price cycle setup such as a reversal extension or wedge pop to enter a stock with
    low risk near a daily key level."
    ([Trading Engineered](https://tradingengineered.substack.com/p/5-key-concepts-from-my-interview)). These are Moglen's
    words of October 2021; they do not show which words Kell used in the January interview.
  - 2021-12-05: an Internet Archive copy of a TraderLion course-members' forum thread whose address ends
    `/forums/discussion/tos-scanner-for-oliver-kells-wedge-pop-criteria/` (address only, not read; a forum, used here
    for the date and nothing else).
  - 2023: Kell's own newsletter, The Weeklies Watch, uses "Wedge Pop", "Wedge Pop buy area" and "Wedge Pop Buy Signal"
    from February 2023 (first on 2023-02-25) ([weeklieswatch.substack.com](https://weeklieswatch.substack.com/), all 33
    posts read).
  - Not a dated use: TraderLion's YouTube upload of Kell's 2021 conference talk (2021-09-23) is titled today "The Wedge
    Pop Trading Setup of Trading Champion Oliver Kell", but the Internet Archive copy of 2022-10-04 shows it was then
    titled "Swing Trading Crash Course | US Investing Champion Oliver Kell", and its description still calls it "Oliver
    Kell's Swing Trading Crash Course". The Wedge Pop title came later.
  - I could not date a first use before 2021. Kell's book was not read (below).
- **His book.** Goodreads lists one book under his name: "Victory in Stock Trading: Strategy and Tactics of the 2020 U.S.
  Investing Champion", 80 pages, dated 2021 by Goodreads
  ([Goodreads](https://www.goodreads.com/book/show/58295305-victory-in-stock-trading); re-read in checking through a fetch
  tool: "80 (ebook)", "January 1, 2021"). Kell's own site sells one book, "Victory in Stock Trading.", subtitled "The
  Cycle of Price Action — and the system behind a 941% return." ([kelltrading.com/the-book](https://kelltrading.com/the-book/)).
  I did not read it and give no wording from it. **Our code names a book "Victorious Stock Operator"** (section 5). No
  source names a Kell book with that title, and his own site names only "Victory in Stock Trading": treat "Victorious
  Stock Operator" as a mistake.
- **Other names.** "The Money Pattern" (Kell). "Wedge Pop buy area", "Wedge Pop Buy Signal" (Kell's newsletter). "wedge
  popped" (UCT writers, three Sunday Scans posts). ("wedge popping" appears only in the brain file's summary of a Manrav
  post, KB 10937, not in his stored words.) On an index Kell also calls it a "buy signal" for his system (X, 2025-03-24).
- **What it is not.** It is not the classical falling wedge of Edwards and Magee and Bulkowski, which needs two
  down-sloping trendlines that converge, at least three weeks and five touches (section 3.12). Kell's version is defined
  by the averages and a tight pivot, and needs no trendlines. The word "wedge" is about price and the averages squeezing
  together. Kell himself keeps the two apart: his newsletter uses the classical word separately ("AMZN Weekly-Breaking
  out of this descending wedge and through the $104 level.", 2023-04-22; "PANW Weekly- Clearing the weekly trendline and
  descending wedge on heavy volume.", 2023-02-25), and his TraderLion course lists "Descending Wedge" as its own lesson
  under "Consolidation Patterns", apart from "Wedge Pop | The Money Pattern" (course page, archive copy 2025-06-23).
  Two of our own files mix the two up (section 5).
- **The mirror.** Kell's Wedge Drop: "The Wedge Drop confirms the reversal when the price falls through the moving
  averages with an influx of sellers." (TraderLion, "Cycle Of Price Action"). It is setup 16.
- **How it reached UCT.** UCT's writers name Kell as the source. An unsigned Sunday Scans section, 2025-06-29:
  "Additionally I visualize this through the lens of Oliver Kell's cycle of price action that he applies to daily charts.
  I look for wedge pops, EMA crossbacks, base n breaks."
  ([sunday-scans-d70](https://unchartedterritoryy.substack.com/p/sunday-scans-d70)). The owner's own list of signature
  setups, as stored in the repo's brain file, pairs "Oliver Kell-Wedge Pop" (TSDR, 2024-11-23,
  `docs/study/levels/brain_kb_cycle_2026-11-06.json`, KB 10810). On 2025-07-11 he posted the link to TraderLion's
  "Cycle Of Price Action" page itself (same file, KB 11569; his post is the URL alone). UCT interviewed Kell on its YouTube channel on
  2025-11-10 ("Interview w/ Oliver Kell (@OliverKell_)", [video](https://www.youtube.com/watch?v=k-5i91eHX1c), 67 minutes;
  not read, see section 11).

---

## 3. Every definition I could find, source by source

### 3.1 Kell, "Wedge Pop: The Money Pattern" (TraderLion, 2024-09-11; the main definition)

Source: [traderlion.com](https://traderlion.com/technical-analysis/chart-patterns/wedge-pop-the-money-pattern/), byline
Oliver Kell. The live page blocks our fetch tools (HTTP 403), so I read the Internet Archive copies of
[2024-10-06](https://web.archive.org/web/20241006111805/https://traderlion.com/technical-analysis/chart-patterns/wedge-pop-the-money-pattern/)
and [2025-04-25](https://web.archive.org/web/20250425064619/https://traderlion.com/technical-analysis/chart-patterns/wedge-pop-the-money-pattern/).
The two copies differ: the later one adds two sentences (a comparison with the VCP and with the Base n' Break), so the
page was edited after it was published. It speaks of Kell in the third person ("by Oliver Kell"), so TraderLion staff
probably wrote it from his teaching. I treat it as Kell's method as TraderLion presents it.

- **What it signals:** "signals that a stock has bottomed and is starting a new uptrend."
- **Prior trend:** after a capitulation low. "After a sharp rebound (the Reversal Extension), the stock consolidates
  beneath the moving averages."
- **Shape:** "As price volatility contracts, the stock will find resistance near the tightening moving averages." And:
  "This pivot forms as the price fluctuates between the lows and the moving averages, retesting both levels."
- **The averages:** "During a selloff, moving averages like the 10-day and 20-day widen as the price falls. When the stock
  consolidates, these averages start to tighten, signaling a potential trend shift."
- **Length and depth:** not stated in numbers. Only "a few days": "We will unlikely see a sustainable bottom until a stock
  rallies to test the moving averages and has a few days to retreat."
- **Volume:** falling selling volume in the base, rising buying volume on the break (quote in section 1).
- **The trigger:** "The Wedge Pop occurs at the first pivot point to break, signaling that the stock has changed
  character and is ready to begin its uptrend." And: "A new uptrend begins when the stock trades through the price range,
  reclaims the moving averages and exhibits increased accumulation volume."
- **Not a moving-average cross:** "Many traders mistakenly believe the Wedge Pop is simply about crossing the moving
  averages. Instead, focus on price bars and volume."
- **The entry:** "Enter on a strong price bar with increased volume when the stock breaks through the pivot."
- **The stop:** no level is given. "If it fails, cut losses quickly." And: "If the price breaks down, be quick to cut any
  losses".
- **Targets:** none. "Let the Cycle Of Price unfold, allowing the moving averages to guide the stock higher."
- **Gaps:** "Most Wedge Pops that lead to new, powerful trends start with gaps."
- **Where not to look:** "It is best to avoid a downtrend when the moving averages act as resistance, guiding the stock
  lower."
- **The index and the leaders:** "When an index displays a Wedge Pop, the leading stocks may be setting up a more
  traditional longer-term base." And: "When the overall index is bottoming, look for stocks with relative strength that
  are still near their highs."
- **How it fails:** on QQQ in 2023, "Notice how the first two potential Wedge Pops failed with no increase in accumulation
  and consistent distribution volume."
- **Examples on the page:** DKNG 2024, CLS 2023, MSTR 2024, MHO 2023, VNT 2023, RCL 2023, QQQ 2023, CRWD 2023 (charts
  only; no dates).

### 3.2 Kell, "Cycle Of Price Action" (TraderLion, 2024-09-10)

Source: [traderlion.com](https://traderlion.com/technical-analysis/chart-patterns/cycle-of-price-action-by-oliver-kell/),
read from the [archive copy of 2025-01-19](https://web.archive.org/web/20250119115745/https://traderlion.com/technical-analysis/chart-patterns/cycle-of-price-action-by-oliver-kell/).
- **Definition:** "The Wedge Pop is the first point where a stock rallies back through its moving averages after a
  Reversal Extension."
- **Shape:** "After the initial bounce off the low, the price often drifts sideways or slightly downwards."
- **Trigger and risk:** "When price and moving averages tighten, a pivot forms. A break above short-term resistance and a
  reclaiming of the moving averages offers a clear entry point with well-defined risk."
- **The averages:** "10 and 20-day exponential moving averages guide us through the intermediate-term trend" and "50 and
  200 simple moving averages help us stay in tune with the longer trend".
- **Volume:** "We look for volume to confirm price movement at the beginning of a cycle, as a stock moves through a pivot,
  and when the stock reverses."
- **Timeframes:** "Weekly charts offer the bigger picture." "Daily charts help manage trades." "Hourly and 15-minute
  charts are for timing entries."
- **What comes next:** the EMA Crossback, the first test of the averages after the pop.
- **Before the pop, on the same page:** of the Reversal Extension, "The lower-risk entry occurs in a few trading sessions
  and will help reduce risk as the price tightens." The page's Wedge Pop chart example is NVDA 2023.
- **A Wedge Drop does not always need an exhaustion:** "In some cases, stocks will stop advancing without exhaustion, and
  we will see a tightening of price, followed by a wedge drop." (for setup 16)
- **The page's short answer:** "It happens when a stock, after rallying from a low, trades sideways and then breaks
  through short-term resistance, reclaiming moving averages."

### 3.3 Kell, "Reversal Extension: How Stocks Bottom" (TraderLion, 2024-06-11)

Source: [traderlion.com](https://traderlion.com/technical-analysis/chart-patterns/reversal-extension-how-stocks-bottom/),
[archive copy 2024-12-12](https://web.archive.org/web/20241212100755/https://traderlion.com/technical-analysis/chart-patterns/reversal-extension-how-stocks-bottom/).
It defines what comes before the pop and says to prefer the pop.
- **What comes before:** "A Reversal Extension is formed when the price pulls away from the moving averages, then snaps
  back up and is accompanied by heavy volume."
- **Not always a spike low:** "Sometimes, an intermediate bottom is more gradual and forms a rounded bottom."
- **Prefer the pop:** "Often, trading the daily Reversal Extension is best avoided. The Wedge Pop may be a better area to
  add exposure, as there is a clear pivot when volatility contracts, allowing for tighter stops."
- **Wait for the base:** "Instead, use this pattern to recognize a bottom, then wait for the price to consolidate under
  the moving averages as it forms a tradable pivot."
- **The market link:** "Get aggressive trading individual stocks when you see a Reversal Extension on the index."
- **Timeframes:** "Daily and 65-minute charts are used when buying and placing stops within the intermediate trends.
  15-minute charts are then used to pinpoint precise entries." (UCT's hourly and 65-minute use in section 6 matches.)

### 3.4 Kell's own trades on TraderLion: MU and AMD (both 2024-09-13)

**"Anatomy Of A Trade: MU +20% Wedge Pop"**
([archive copy 2025-02-11](https://web.archive.org/web/20250211124917/https://traderlion.com/profile/oliver-kell/mu-wedge-pop/)).
MU was near its all-time highs, so this pop is a small cycle inside a bigger uptrend, not a bear-market bottom.
- **Before:** "Two weeks before Oliver shared this setup, MU made a Reversal Extension, gapped up, and tightened into the
  moving averages."
- **The pop (2024-05-03):** "MU gapped up in the form of a Wedge Pop through the moving averages over the previous flag
  formation."
- **The stop:** "Initiating a new position, Oliver staggered his stops with the 10 and 20 exponential moving averages under
  the day's low." On our bars that day the 10 EMA (113.30) sat just under the day's low (113.45) and the 20 EMA (113.75)
  just above it, so on MU the averages and the day's low were the same spot, about 1% under the close. (A second Kell
  stop on a pop, CAVA, is below.)
- **Why it is low risk:** "Waiting for tightness in price and then acting quickly on positive price action offers low risk
  with tighter stops."
- **Where it sits in the cycle:** "Entering on a wedge pop puts you in the trade at the beginning third of the Cycle Of
  Price Action."
- **Exits:** he sold the first position when a Wedge Drop appeared ("The result of this part of the trade ended with a 12%
  gain in three weeks."), bought back at the EMA Crossback, reduced into an Exhaustion Extension, and sold on a bearish
  engulfing day.

**"Anatomy Of A Trade: AMD +50% Wedge Pop"**
([archive copy 2025-02-11](https://web.archive.org/web/20250211110316/https://traderlion.com/profile/oliver-kell/amd-wedge-pop/)).
- **The pop (2023-11-01, on earnings):** "AMD Triggered a buy after an earnings report when the price reclaimed all moving
  averages after a positive earnings reaction."
- **Context:** "AMD made Oliver Kell's focus after it reclaimed the 200-day simple moving average in reaction to an
  earnings report that became positive after decelerating for a year."
- **Speed:** "When a strong Wedge Pop occurs, be quick to start building a new position."
- **Adds:** "Breaking through a range is not only a new add-on point but also an opportunity to raise stops." (Kell
  adds to winners; our rule A5 does not.)
- **Exit:** "A gap down through the moving averages is more than enough for Oliver to exit the trade."

**Three more Kell trade reviews that name the Wedge Pop (found in checking; TraderLion, byline Kell, dated 2024-09-11;
archive copies of 2025-02-11):**
- **CAVA +40%**
  ([archive copy](https://web.archive.org/web/20250211122647/https://traderlion.com/profile/oliver-kell/cava-breakout/)):
  "A gap-up Wedge Pop reclaiming the moving averages provided an ideal entry when a new uptrend began." The pop day,
  2024-04-26: "CAVA blasted through the buy area on a gap up with increasing volume and Oliver initiated his position with
  a stop set under the day's low." It came after "a Wedge Drop in early April 2024", with CAVA near its highs, so like MU
  it is a pop inside a bigger uptrend. He sold into strength on 2024-04-30 ("Oliver elected to lock in his gains."). On
  our bars: +10.5% on the day, 2.3 times the 50-day volume, above the 200-day, the close 11.5% above the 10-day average;
  the app's rule fired. This is the clearest case of Kell's own stop on a pop: under the day's low.
- **COIN +110%**
  ([archive copy](https://web.archive.org/web/20250211104800/https://traderlion.com/profile/oliver-kell/coin-trendline-breakout/)):
  "The rounded bottom never formed a textbook Reversal Extension but formed a tight tradeable range after the Wedge Pop."
  No pop day is given.
- **ARM +35%**
  ([archive copy](https://web.archive.org/web/20250211111026/https://traderlion.com/profile/oliver-kell/arm-reversal-extension/)):
  "The previous two weeks consolidated tightly between $110 and $117 after a Wedge Pop reclaimed the moving averages." He
  bought the later break of weekly resistance, not the pop. No pop day is given.

### 3.5 Kell's own newsletter, The Weeklies Watch (2023; first person, primary)

Source: [weeklieswatch.substack.com](https://weeklieswatch.substack.com/), byline Oliver Kell; all 33 public posts
(2023-01-14 to 2023-10-07) read through Substack's own post API on 2026-11-09. This is the best source for how he uses
the word himself. He uses it on stocks, ETFs and indexes, on daily and weekly charts.
- **What he needs to see first (QQQ, 2023-02-25):** "Would need to see support, basing/tightening under the 20EMA, and a
  new Wedge Pop or caution is warranted."
  ([post](https://weeklieswatch.substack.com/p/correction-accelerates-after-losing))
- **His recipe (same post):** "B. Rally up, tighten under the 20EMA, build a base, and take out the 20EMA. (New Wedge Pop
  to change trend. We will need basing.)"
- **The pop itself (QQQ daily, 2023-03-03):** "followed through Friday triggering a Wedge Pop back through the Daily
  EMAs." ([post of 2023-03-04](https://weeklieswatch.substack.com/p/holding-weekly-moving-averages))
- **On a weekly chart:** "QQQ Weekly- Wedge Pop the week of 1/23 with an EMA Crossback this past week and support on the
  20 Week EMA." (same post)
- **On earnings:** "MELI Daily- Wedge Pop on earnings with a Crossback currently taking place." (same post)
- **On a huge-volume gap:** "AI Daily-Explosion on huge volume Friday triggering a Wedge Pop." (same post)
- **Near the 200-day:** "BE Daily- Channeling down into the 200SMA. If got some tight trade to start the week looking for
  a Wedge Pop buy area to build under this $23 level." (same post)
- **As a buy area with a price (2023-03-21):** "TSLA- Cleared the 186.50 Wedge Pop buy area with strong volume." and
  "ABNB- Triggered Wedge Pop buy area through 120 today."
  ([post](https://weeklieswatch.substack.com/p/going-into-the-fed))
- **The 20 EMA alone as the line (same post):** "Anticipating a Wedge Pop through the 20EMA here….310-312ish area." (NFLX)
- **Defence after the pop (2023-03-22):** "TSLA- Rejecting at the gap resistance after yesterday's Wedge Pop Buy Signal.
  Still on a buy signal so could hold these EMAs if it backtests tomorrow but playing defense seemed like the way to go."
  ([post](https://weeklieswatch.substack.com/p/fed-raises-25-bpsmarket-doesnt-like))
- **With a kicker (2023-03-23):** "NFLX-Wedge Pop on volume via a Kicker Candle."
  ([post](https://weeklieswatch.substack.com/p/push-pull-continues))
- **After a failed breakdown (2023-03-31):** "XRT-Retail a failed breakdown and now a Wedge Pop through the 20EMA."
  ([post of 2023-04-01](https://weeklieswatch.substack.com/p/continued-great-action))
- **It confirms the low (QQQ, 2023-10-06):** "QQQ Daily-The hammer into the broadening line had the potential to be the
  Reversal Extension and that is confirmed with the Wedge Pop Friday."
  ([post of 2023-10-07](https://weeklieswatch.substack.com/p/nasdaq-daily-buy-signal-can-the-spx))
- **No swing longs before it (2023-09-23):** "I am continuing to avoid long swings until I see a major capitulation
  reversal extension in the QQQ or we switch to a buy signal."
  ([post](https://weeklieswatch.substack.com/p/mutombod-by-weekly-resistancewhat))
- **His stops in the same months (not tied to a Wedge Pop by name):** "Stops to Fridays low." (TSLA, 2023-04-01); "will
  use Friday's low/10 day as the stop" (NVDA, 2023-03-04); "stops at a loss of the 10 day" (TSLA, 2023-05-06).
- **Stretch:** on QQQ, "I thought we were a little bit ahead of ourselves at 4-5% above the Daily 10EMA." (2023-03-04).
  That is an index number, not a rule for stocks.
- **The classical wedge, kept apart:** he also writes "descending wedge" in the classical sense (AMZN 2023-04-22, PANW
  2023-02-25; quotes in section 2), never calling those a Wedge Pop.

### 3.6 Kell on X, 2025-03-24 (first person)

Read through X's public embed service (publish.twitter.com/oembed), which returns the post's text:
"Got the wedge pop buy signal for my strategy. In studying 2018/2022 market when got through the 20ema was when things
reversed." The post goes on: "Just have to trade my strategy but holding through the 20ema/200sma next step."
([post](https://x.com/OliverKell_/status/1904264900354126284)). It does not name the index. On that day QQQ closed under
its 200-day SMA and SPY just above it (our bars), so Kell's "buy signal" came below or at the 200-day.

### 3.7 Kell's site (kelltrading.com, read 2026-11-09)

"Wedge Pop" is step 02: "The breakout phase — when price launches out of consolidation with conviction. The
highest-probability long entry." (the dash is in the original). Step 01: "The bottom-fishing phase. Where capitulation
gives way to fresh accumulation and the cycle begins again." His motto on the same page: "I'm not interested in calling
tops or bottoms. I'm interested in identifying repeatable patterns and trading them with size when the setup is right."

### 3.8 Deepvue, "Oliver Kell: 5 Screens to Find Stocks Like a Champion" (2025-03-21)

Source: [deepvue.com](https://deepvue.com/screener/oliver-kell-screens/), no author named; the page says "Last Updated:
March 21, 2025" (no first publication date shown). Deepvue says it "partnered with
Oliver Kell, and other top traders, to bring you his daily screens", so this is close to the originator, but it is a
vendor page.
- **Definition:** "After a Reversal Extension, a Wedge Pop occurs when the stock rallies back through its moving
  averages."
- **Shape:** "After the stock rallies off the lows, it often moves sideways forming a consolidation area." And: "A tight
  price range near short-term resistance creates a tradeable pivot point."
- **Trigger:** "A breakout above resistance and reclaiming the moving averages signals an early entry point."
- **The averages:** "At its core, the cycle of price revolves around the 10 and 20-day exponential moving averages."
- **Liquidity in his screens:** "The price above $20 avoids low-priced, volatile stocks." "The average daily volume of over
  500,000 ensures liquidity for smooth trades." Market cap "between $2 billion and $25 billion".
- **Growth:** "Earnings and sales growth in recent quarters over 30%."
- **Market:** "At market turning points, Oliver trades more aggressively and holds positions longer."

### 3.9 Richard Moglen (TraderLion), 2021-10-15

Source: [Trading Engineered](https://tradingengineered.substack.com/p/5-key-concepts-from-my-interview), a summary of his
interview with Kell. The pop as an intraday entry inside a daily setup (quote in section 2), and on selling: "you want to
watch out when a stock becomes extended from its 10 emas on both a daily and weekly timeframe."

### 3.10 Community indicators (read; not used as sources for rules)

These show how traders turned the idea into code. They are forum-level and I give no rule from them.
- **QuantVue, "Wedge Pop & Drop", TradingView, 2024-08-13**
  ([script](https://www.tradingview.com/script/GOkJ7o5J-Wedge-Pop-Drop-QuantVue/)): "A Wedge Pop occurs when a stock first
  trades up through the moving averages after reaching a downside extension." Its description defines a downside
  extension as a bar whose high is more than 1.5 ATR (the default) under the 10 EMA. No consolidation, no pivot, no volume: exactly the "crossing the moving averages"
  reading that Kell's article calls a mistake.
- **vishnuv, "Oliver Kell Cycle of Price Action", TradingView, 2025-10-26**
  ([script](https://in.tradingview.com/script/xHyBTcMq-Oliver-Kell-Cycle-of-Price-Action/)): "Wedge Pop: tight pullback or
  extension reset beneath the EMAs that snaps back above both with confirming volume."

### 3.11 What I could not read

- Kell's book (above). TraderLion's paid course and its slide PDFs (HTTP 403 and a bot check). The two videos: the
  2021 TraderLion conference talk and UCT's own 2025-11-10 interview. YouTube now refuses caption downloads from our tools,
  so I have titles, dates and chapter lists only. The UCT interview's chapters include "Optimal entry points", "Managing
  trends" and "Importance of volume"; its transcript is the best source we do not have.
- Kell's other posts on X. My web-search budget ran out after the one post above, so I could not find more.
- In checking, Kell's other TraderLion trade reviews were found and read (CAVA, COIN, ARM in 3.4; NVDA, which does not
  name the Wedge Pop).

### 3.12 The classical cousin: the falling wedge (Bulkowski)

Source: Thomas Bulkowski, [thepatternsite.com/fallwedge.html](https://thepatternsite.com/fallwedge.html). **Notice on the
site:** "This website, in whole or in part, shall not be used to train artificial intelligence (AI) systems" (it goes on).
I read it through a fetch tool only (plain downloads return HTTP 406), cite it with a link and short quotes, and did not
save a copy, so these quotes are not word-checked against a file; in checking they were read again through a second
fetch and came back the same. It is a different pattern, given here because the app and the Study draft items mix the
two up.
- Shape: "Price follows two down-sloping and converging trendlines."
- "Price should touch each trendline at least five times to outline a good pattern."
- "3 weeks is the minimum duration, otherwise it's a pennant."
- Volume: "Trends downward 72% to 75% of the time until the breakout."
- Confirmation: "The pattern confirms as a valid one when price closes outside one of the trendlines."
- Target, upward breakouts: "the highest peak in the pattern (A) is the price target."
- "The falling wedge is a poor performer as far as bullish chart patterns go."

### 3.13 Comparison table

| Source | Before it | Shape | Length | Depth | Volume | Averages | Trigger | Entry | Stop | Targets |
|---|---|---|---|---|---|---|---|---|---|---|
| Kell, TraderLion wedge pop page (3.1) | Reversal Extension (rounded bottom allowed, 3.3) | sideways under the tightening averages; a pivot between the lows and the averages | "a few days" | not stated | selling dries up; buying volume rises on the break | 10 and 20-day (EMA per 3.2) | first pivot to break, with a reclaim of the averages | "strong price bar with increased volume" through the pivot | not given; "cut losses quickly" | none; let the averages guide |
| Kell, cycle page (3.2) | Reversal Extension | "drifts sideways or slightly downwards" | not stated | not stated | confirms the pivot break | 10/20 EMA; 50/200 SMA for the long trend | break of short-term resistance plus a reclaim of the averages | hourly or 15-minute for timing | "well-defined risk" | none |
| Kell, MU trade (3.4) | Reversal Extension two weeks earlier, inside an uptrend | tight into the averages, failed breakdown, then inside the prior candle's wick | about 2 weeks | the base low 19% under the 60-day high (our bars) | not stated | 10/20 EMA | gap up through the averages over the flag | on the gap | under the day's low, staggered at the 10 and 20 EMA | sold on Wedge Drop; reduced into Exhaustion Extension |
| Kell, AMD trade (3.4) | year-long decline in earnings growth; reclaim of the 200-day | not described | not stated | not stated | earnings day (2.6x the 50-day average in our bars) | "all moving averages" | earnings reaction reclaiming all averages | buy that day, add on later ranges | raised as it rose | exit on a gap down through the averages |
| Kell, CAVA trade (3.4) | a Wedge Drop, then a pullback held on the weekly chart | bullish engulfing day, then the pop | not stated | not stated | "gap up with increasing volume" (2.3x the 50-day in our bars) | the moving averages | gap up through "the buy area", reclaiming the averages | on the gap | "under the day's low" | sold into strength 2 sessions later |
| Kell, newsletter (3.5) | correction; index first | basing, tightening under the 20 EMA | not stated | not stated | "with strong volume", "on volume" | "the Daily EMAs", often the 20 EMA alone | "take out the 20EMA"; a named price ("through 120") | at the buy area | prior day's or Friday's low; the 10-day | not stated |
| Kell, kelltrading.com (3.7) | capitulation | "out of consolidation" | not stated | not stated | "with conviction" | not stated | breakout | not stated | not stated | not stated |
| Deepvue (3.8) | Reversal Extension | sideways consolidation; tight range near short-term resistance | not stated | not stated | not stated for the pop | 10/20 EMA | breakout above resistance plus a reclaim of the averages | "early entry point" | not stated | not stated |
| QuantVue indicator (3.10) | high more than 1.5 ATR under the 10 EMA | none | none | 1.5 ATR | none | 10 EMA | first trade back through the average | the cross | none | none |
| Bulkowski falling wedge (3.12) | any direction | two converging down-sloping trendlines | 3 weeks minimum | not stated | falls in the pattern | none | a close outside a trendline | after the close | not stated | the pattern's highest peak |
| UCT Model Book playbook (5.3) | after a Reversal Extension | "Price tightens into a wedge" with a "converging range" | not stated | not stated | dries up in the wedge | 9/20 EMA | upper trendline break plus a 9/20 EMA reclaim | at the break | "Below the wedge / consolidation low." | trail the 9/20 EMA |
| UCT Sunday Scans (6) | correction, base, tightness | "get tight", "tightening" | not stated | not stated | not stated | 20 EMA, 9/20 EMA | "reclaiming the 21 EMA" (Manrav) | named prices ("through $100.5") | a named price ($86 for CRWV) | trail the 9 EMA, 20 EMA, 50 SMA |
| App, Chart IQ rule (5.1) | 8 of the prior 15 closes under the 20 EMA | shrinking ranges or a shakeout | 15 sessions looked at | none | 1.05x the 50-day average | 10/20 EMA | close over both averages and over the prior 5 highs, close in the top 40% of the day | the close | not set by the rule | not set |

### 3.14 Where the sources disagree

1. **Which averages.** Kell: the 10 and 20-day EMAs (3.2, 3.8, MU trade). His newsletter often names only the 20 EMA.
   Our Model Book uses the 9 and 20-day EMAs; the app's Chart IQ rule uses 10/20 in one place and 9/21 in another;
   Manrav wrote "reclaiming the 21 EMA".
2. **Is it a wedge with trendlines?** Kell: no trendlines; the "wedge" is price and the averages squeezing together, and
   the trigger is the pivot (the top of the tight range). Our Model Book: "Break of the wedge's upper trendline". The
   classical falling wedge needs trendlines, five touches and three weeks. An app knowledge file even calls it a "rising
   wedge breakdown OR falling wedge breakout" (section 5.6).
3. **Must a Reversal Extension come first?** Kell's pages say the pop comes after one, but also allow "a rounded bottom",
   his COIN review says "The rounded bottom never formed a textbook Reversal Extension but formed a tight tradeable range
   after the Wedge Pop", and his MU and CAVA pops came inside uptrends. The app's Chart IQ rule does not look for one; the QuantVue script requires a
   1.5 ATR stretch.
4. **Volume.** Kell: increased volume on the break, and the QQQ pops without it failed. Our Model Book talks only about
   volume drying up in the wedge. The app wants 1.05 times the 50-day average. Half of the pops Kell and UCT named had
   less than the 50-day average (section 4.5); most had more than the day before.
5. **Entry.** Kell buys through the pivot during the day and times it on hourly or 15-minute charts; the Model Book buys
   the trendline break; the app's rule is read at the close.
6. **Stop.** Kell (CAVA): "a stop set under the day's low"; Kell (MU): staggered at the 10 and 20 EMA, which that day sat
   at the day's low; his newsletter: the prior day's or Friday's low, or the 10-day. Our Model Book: under the wedge low (wider). The house default (A3): the day's low or the prior
   day's low. None gives a percentage.
7. **Where it may happen.** Kell bought pops below or at the 200-day (TSLA in March 2023 was under it; his March 2025
   index signal). Our rule B26 bans longs under the 200-day.
8. **Adding.** Kell adds as new ranges break (AMD); the Model Book says "scale into strength"; our A5 says one entry, no
   adds.
9. **Timeframe.** Kell and UCT use it on weekly, daily and hourly charts. The course will most likely teach the daily.

---

## 4. Measured evidence

### 4.1 Published statistics: none for the Wedge Pop

I found no published success rate, average move or failure rate for Kell's Wedge Pop. Kell's site calls it "The
highest-probability long entry" with no number. TraderLion's trade reviews report single trades Kell chose to show
(AMD "+50%", MU "+20%"); they are anecdotes, picked after the fact. The repo's own 2026 setup sweep reached the same
conclusion: "two Kell-bylined TraderLion articles were read in full and contain ZERO percentage extensions, ZERO volume
multiples and ZERO pivot offsets." (`docs/superpowers/research/setups/setup_criteria.json`).

### 4.2 The nearest classical numbers (a different pattern)

Bulkowski's falling wedge, from the table headed "Falling Wedge: Important Bull Market Results", read through a fetch
tool (re-read in checking: each row gives an "up/down" pair, and the first figure is the upward breakout): "Average
rise/decline: 38%/14%", so an average rise of 38%; "Break even failure rate for up/down breakouts: 26%/29%", so 26%;
overall rank "31 out of 39" for upward breakouts. Separately, the identification table says the breakout "Can be in any
direction but is upward 68% of the time." Basis: "The above numbers are based on over 800 perfect trades."; "Statistics
updated on 8/27/2020." Limits: a different pattern (trendlines, three weeks or more); "perfect trades" is not defined on
the page or in the site's glossary (the glossary defines only the "ultimate high", "The highest peak before price declines
by at least 20%, measured from the high to the close."), so read the averages as best-case figures; the market period is
not given on the page. These numbers do not measure the Wedge Pop and should not be taught as if they did.

### 4.3 Earlier UCT measurements

None. `docs/study/UNITS-method.md` lists the Wedge Pop unit (SET.16) with "expected, measure" and no detector.

### 4.4 New measurements for this dossier (local daily bars, read-only)

What I measured: the app's own Chart IQ Wedge Pop rule (`api/services/chart_iq/engine/v44_read.py`, `cycle_events`,
section 5.1), run unchanged over the local daily bars of 3,512 tickers (stocks and ETFs) with at least 400 days of data, from
2008-01 to 2026-08. A pop counts only if the stock closed at $10 or more and traded at least $20 million a day on its
50-day average (B23). That gave **24,516 pops in 2,208 tickers**.

The trade (the house plan, as close as daily bars allow): buy at the pop day's close; stop 3 cents under the pop day's
low (A3, F62); before 3R only the stop and the time stop (still under 1R at the 10th session: out, C33); at 3R sell a
third and move the stop to breakeven; at 5R sell a third; the last third leaves on a close under the 10-day SMA (E52). A
day that opens under the stop leaves at the open (B20's 30-minute rule cannot be run on daily bars). Result in R, capped
at +15R so that a few freak trades do not dominate; trades with a stop under 0.75% or over 10% left out of the R
comparisons.

Two baselines with the same entry, stop and plan: **(1)** every day that meets the app's trigger (close over both
averages and over the prior 5 highs, close in the top 40%, volume 1.05 times the 50-day average) but WITHOUT the wedge
history (fewer than 8 of the prior 15 closes under the 20 EMA): this isolates what the "wedge" part adds; **(2)** a 1 in
20 sample of all liquid days closing above both averages.

**a) What the app's pops look like (all 24,516):**
- Only **50.5%** were above the 200-day SMA. Half would be banned by B26.
- RS: with an RS proxy (0.4 of the 3-month return plus 0.2 each of the 6, 9 and 12-month returns, ranked against all
  liquid stocks that day; IBD's own formula is not published), the median pop ranked 42 and only **16.2%** ranked 80 or
  more (C31). Wedge Pops come after declines, so most have weak RS on the day.
- The day's-low stop: median **3.13%** below the close; 47.5% within 3% (A13); 10th to 90th percentile 1.3% to 7.5%.
  The lower of the two days' lows (the pop day's and the prior day's) is wider: median 4.97%.
- 10.4% closed more than 10% above the 10-day average (C29).
- 34% gapped up 1% or more.

**b) The results (R capped at +15; stops between 0.75% and 10%):**

| Group | Trades | Mean R | Std. error | Winners | Reached 3R first (60 days) | Stopped (60 days) | Median stop |
|---|---|---|---|---|---|---|---|
| Wedge pop, app rule | 22,880 | +0.07 | 0.013 | 33.2% | 20.6% | 77.0% | 3.08% |
| Baseline 1: same trigger, no wedge history | 133,598 | -0.02 | 0.005 | 31.9% | 18.6% | 79.6% | 2.53% |
| Baseline 2: any day above both averages | 76,779 | +0.02 | 0.008 | 28.8% | 18.9% | 80.8% | 1.60% |
| Pop, above the 200-day, not over 10% above the 10-day | 10,935 | +0.095 | 0.019 | 34.3% | 21.1% | 76.7% | 2.66% |
| Baseline 1, same two filters | 105,952 | -0.015 | 0.006 | 32.0% | 18.7% | 79.5% | 2.29% |
| Pop, same filters, RS proxy 80+ | 3,011 | +0.14 | 0.037 | 34.6% | 21.8% | 76.2% | 3.55% |
| Baseline 1, same filters, RS proxy 80+ | 41,104 | -0.03 | 0.010 | 31.2% | 18.3% | 80.2% | 2.67% |
| Pop, same filters, stop within 3% | 6,350 | +0.10 | 0.027 | 32.3% | 21.1% | 78.6% | 1.95% |
| Pop, below the 200-day | 11,229 | +0.04 | 0.018 | 32.0% | 20.2% | 77.5% | 3.41% |

By period (pops above the 200-day and within 10% of the 10-day, against baseline 1 with the same filters): 2008-2012
+0.05R against -0.14R; 2013-2017 +0.22R against +0.04R; 2018-2021 +0.12R against -0.02R; **2022-2026 0.00R against
+0.01R**. Year by year the pop beat baseline 1 in 15 of 19 years; it lost in 2016, 2018, 2024 and 2025.

Other cuts of the pops (all 24,516, no stop-width filter, R not capped): 200-day rising +0.10R against falling +0.03R; above the 50-day +0.10R
against below +0.02R; a gap of 1% or more +0.08R against +0.06R; volume 1.5 times the 50-day average or more +0.04R
against 1.05 to 1.5 times +0.08R. Pops that came soon after QQQ's own app-detected pop (QQQ had only 15 in the period):
re-run in checking from the same event file, pops above the 200-day and within 10% of the 10-day, R capped, within 20 or
21 trading days of a QQQ pop, gave between 0.00R and +0.12R (663 to 980 trades depending on the window, standard error
0.06 to 0.07) against +0.09R to +0.10R for the rest: no measurable edge from the index pop in this test. (An earlier
figure of +0.17R could not be reproduced; see section 12.)

How the house plan ended (pops above the 200-day, within 10% of the 10-day): 57% at the stop, 18% at the 10-day time
stop, 14% on the 10-day trail after 5R, 10% gapped through the stop.

**c) What it means.**
- The "wedge" part of the rule adds a small, fairly steady edge over the same breakout without it: about 0.1R a trade,
  and more with RS 80+. That is small: on a 3% stop, 0.1R is about 0.3% of the position, before commissions and slippage
  (not modelled). It was gone in 2022-2026.
- About one trade in three wins, about one in five reaches 3R before the stop, and most losers lose the full 1R. The
  results come from a few big winners. A member should expect strings of small losses.
- The house filters help a little: above the 200-day (+0.09R against +0.03R below it, all pops, R not capped) and RS
  80+ (+0.14R).
- Heavier volume on the pop day did not help in this mechanical test, against Kell's emphasis. The test uses one volume
  number; it cannot see what Kell sees (the volume of the base, gaps, the news).

**d) Limits.** Daily bars only; the entry is the close, while Kell buys through the pivot during the day with a tighter
stop. The bars are probably today's listed tickers only (survivorship bias, which flatters every group alike). No
commissions or slippage. Overlapping trades in the same weeks make the standard errors too small. The RS figure is a
proxy. Above all, this measures **the app's rule**, which fires on only 5 of the 24 dated Wedge Pops that Kell and UCT
named (4.5), so it is not a test of Kell's discretionary setup. The code and outputs are in the session scratchpad
(`tools/measure.py`, `tools/analyze2.py`), not in the repo.

### 4.5 The Wedge Pops that Kell and UCT named, measured (30 cases)

Every case below was named as a wedge pop by Kell or a UCT writer, with the day stated or clear from the post. The words day inferred
mark posts that gave only a week or a month; I picked the first close back over both averages in that window,
and those six rows are left out of the counts below. Facts from our daily bars. House R is the plan of 4.4 (buy at the
close, stop under the day's low).

| Ticker | Pop day | Named by | Where | App rule fired? | Day's change | Volume vs 50-day | Above 200-day | Stop (day's low) | House R |
|---|---|---|---|---|---|---|---|---|---|
| QQQ | 2023-03-03 | Kell | Weeklies Watch, 2023-03-04 | yes | +2.1% | 1.17x | yes | 1.6% | -1.0 |
| MELI | 2023-02-24 | Kell (on earnings) | Weeklies Watch, 2023-03-04 | no | +1.8% | 1.95x | yes | 3.3% | +1.0 |
| UBER | 2023-03-03 | Kell | Weeklies Watch, 2023-03-04 | no | +2.6% | 0.60x | yes | 2.3% | -1.0 |
| AI | 2023-03-03 | Kell | Weeklies Watch, 2023-03-04 | no | +33.6% | 4.68x | yes | 15.7% | -1.0 |
| SMH | 2023-03-03 | Kell | Weeklies Watch, 2023-03-04 | no | +1.4% | 0.74x | yes | 2.1% | -1.0 |
| SPY | 2023-03-21 | Kell | Weeklies Watch, 2023-03-21 | no | +1.3% | 0.99x | yes | 0.8% | -1.0 |
| ARKK | 2023-03-21 | Kell | Weeklies Watch, 2023-03-21 | no | +5.5% | 0.97x | yes | 4.2% | -1.0 |
| TSLA | 2023-03-21 | Kell | Weeklies Watch, 2023-03-21 | no | +7.8% | 0.85x | **no** | 4.8% | -1.0 |
| ABNB | 2023-03-21 | Kell | Weeklies Watch, 2023-03-21 | no | +4.5% | 0.81x | yes | 3.1% | -1.0 |
| NFLX | 2023-03-23 | Kell (kicker) | Weeklies Watch, 2023-03-23 | yes | +9.0% | 2.04x | yes | 5.2% | +4.8 |
| XRT | 2023-03-31 | Kell | Weeklies Watch, 2023-04-01 | no | +2.6% | 0.83x | **no** | 2.1% | -1.0 |
| QQQ | 2023-10-06 | Kell | Weeklies Watch, 2023-10-07 | no | +1.7% | 1.48x | yes | 2.7% | -1.0 |
| AMD | 2023-11-01 | Kell (on earnings) | TraderLion trade | no | +9.7% | 2.56x | yes | 8.9% | +4.7 |
| MU | 2024-05-03 | Kell | TraderLion trade | no | +2.1% | 0.62x | yes | 1.1% | +6.0 |
| QQQ | 2025-03-24 | Kell (index not named) | X post | no | +2.0% | 0.92x | **no** | 1.3% | -1.0 |
| SPY | 2025-03-24 | Kell (index not named) | X post | no | +1.8% | 1.05x | yes | 0.7% | -1.0 |
| MSTR | 2025-06-03 | Bracco ("stopped out on Thursday") | Sunday Scans, 2025-06-08 | no | +4.1% | 0.69x | yes | 4.2% | -1.0 |
| MSTR | 2025-06-09 (day inferred) | unsigned | Trade updates, posted the evening of 2025-06-09 ET | no | +4.7% | 0.70x | yes | 3.7% | -1.0 |
| ASTS | 2025-12-03 | Bracco (chart label) | brain file, KB 12109 | no (fired 12-04) | +8.0% | 0.92x | yes | 8.7% | +1.0 |
| BE | 2025-12-04 | TSDR | Sunday Scans, 2025-12-07 | yes | +15.2% | 1.30x | yes | 14.0% | -1.0 |
| BIDU | 2025-12-05 | TSDR ("Monster") | Sunday Scans, 2025-12-07 | yes | +5.9% | 1.26x | yes | 2.4% | -1.2 |
| TDUP | 2025-12-03 (day inferred) | Bracco | Sunday Scans, 2025-12-07 | yes (day picked from the app) | +7.3% | 1.22x | yes | 7.9% | -0.5 |
| PL | 2025-12-03 (day inferred) | TSDR ("in December") | Sunday Scans, 2026-03-22 | no | +2.0% | 0.53x | yes | 2.5% | +20.6 |
| INCY | 2025-12-19 | TSDR | Sunday Scans, 2025-12-28 | yes | +5.5% | 2.51x | yes | 5.2% | +0.7 |
| NBIS | 2026-01-06 (day inferred) | TSDR | Sunday Scans, 2026-01-18 | yes (day picked from the app) | +8.0% | 1.10x | yes | 9.3% | -0.15 |
| CRWV | 2026-01-12 | TSDR ("Monday") | Sunday Scans, 2026-01-18 | no | +12.2% | 1.50x | **no** | 13.5% | -1.0 |
| QQQ | 2026-04-06 (day inferred) | unsigned INTRO ("indexes") | Sunday Scans, 2026-04-12 | no | +0.6% | 0.51x | **no** | 0.7% | -1.0 |
| NBIS | 2026-05-01 | Bracco ("Friday") | Sunday Scans, 2026-05-03 | no | +11.8% | 0.97x | yes | 9.4% | +3.7 |
| NBIS | 2026-09-04 | Bracco ("Friday") | Sunday Scans, 2026-09-06 | no | +7.5% | 0.69x | yes | 7.5% | -1.3 |
| JOBY | 2025-12-03 (day inferred) | Manrav | Rest of the Week, posted the evening of 2025-12-09 ET | no | +5.8% | 0.38x | yes | 7.3% | -1.0 |

On the 24 cases with a stated day:
- **The app's rule fired on 5 of 24** (re-run in checking with the app's own code: QQQ 2023-03-03, NFLX, BE, BIDU, INCY).
  Why it missed (some miss on more than one count): volume under 1.05 times the 50-day average (14 cases; SPY 2025-03-24
  sat at 1.046x); fewer than 8 of the prior 15 closes under the 20 EMA (6: MELI, UBER, AI, SMH, MSTR, NBIS in May);
  no range contraction or shakeout in the last days (7, among them QQQ 2023-10-06, AMD, CRWV); the close not over the
  prior 5 highs (MU, NBIS in May); and the rule's memory: after one pop it will not call another until a different stage
  appears in between (SPY 2023-03-21, after its app pop of 2023-03-03; NBIS 2026-09-04, after its app pop of 2026-08-04).
  On 10 of the 19 misses the app instead labelled the move, 1 to 9 sessions later, "Back over the EMAs", its stage for
  "3 closes back over the 10 and 20 EMA (no real pop)".
- **Volume:** median 0.98 times the 50-day average (10 of 24 at 1.05x or more), but 1.35 times the day before (18 of 24
  higher than the day before). "Increased volume" in Kell's sense looks like more than the base days, not more than the
  50-day average.
- **The day:** median change +5.0% (indexes +1.9%, stocks +7.7%); 13 of 24 gapped up 1% or more.
- **Stop at the day's low:** median 3.7% (indexes 1.9%, stocks 5.2%); 10 of 24 within 3%. At the lower of the two days'
  lows: median 6.1%, 4 of 24 within 3%.
- **Location:** 20 of 24 above the 200-day; 4 of 24 more than 10% above the 10-day (AI, ASTS, BE, CRWV).
- **Depth before the pop:** the low of the 15 days before sat a median 20% under the prior 60-day high (8% for QQQ in
  March 2023, 56% for CRWV).
- **The mechanical house trade:** 7 winners of 24, average +0.18R. Three index pops were stopped at the day's low within
  days and then rallied in the weeks after: QQQ 2023-03-03 (stopped 2023-03-09, then up to +7.3% within 30 sessions),
  QQQ 2023-10-06 (stopped 2023-10-20, then +6.3%), SPY 2023-03-21 (stopped the next day, then +4.7%). A stop at the
  averages would not have saved them: on all three the 10 and 20 EMAs sat at or above the pop day's low. Only a stop under
  the 15-day base low would have held, and only on SPY (base low 380.65, later low 389.40); both QQQ pops later undercut
  their base lows too. The honest lesson is that index pops often shake out first; Kell times entries on lower timeframes
  (3.2, 3.3), which this daily test cannot copy.
- **Found in checking, not in the counts above:** Kell's CAVA pop of 2024-04-26 (3.4): +10.5% on the day, 2.29 times the
  50-day volume, above the 200-day, a day's-low stop 9.3% under the close, 11.5% above the 10-day average (over C29); the
  app's rule fired.

Candidates for the owner's ten model charts, by the sources' own words (his choice, not mine): NFLX 2023-03-23 (pop on
volume via a kicker), AMD 2023-11-01 (earnings reclaim of all averages), MU 2024-05-03 (gap pop out of a flag, tight
day's-low stop), CAVA 2024-04-26 (gap pop on rising volume, Kell's stop "under the day's low"), MELI 2023-02-24 (on earnings), QQQ 2023-10-06 (index pop that confirmed the low), BIDU 2025-12-05 (gap,
"Monster"), INCY 2025-12-19 (2.5 times volume, then four tight days), PL 2025-12 (range break at $12, then +20R on the
house plan), NBIS 2026-05-01 (pop off a backtest), QQQ 2023-03-03 (the only index pop the app also caught). Counter
examples worth showing: BE 2025-12-04 (+15% day, 14% stop: too wide), AI 2023-03-03 (+34% day), and the March 2023 index
pops that stopped out at the day's low.

---

## 5. Our app

### 5.1 Chart IQ: the cycle reader (`api/services/chart_iq/engine/v44_read.py`, `cycle_events`)

The most faithful version in the app. It labels Kell's six stages in his order ("Reversal extension", "Wedge pop", "EMA
crossback", "Base n' break", "Exhaustion extension", "Wedge drop") on the 10 and 20-day EMAs. A day is a **Wedge pop**
when all of these hold (constants in `CYC`):
- the last stage it called was not already a Wedge pop;
- at least 8 of the prior 15 closes were under the 20 EMA (`pop_under` 8);
- the last 5 days' average range is under 0.85 times the average range of the 10 days before, OR one of the last 3 days
  undercut the prior low by 1% and still closed up (a shakeout);
- the close is above both the 10 and 20 EMA, and above the highest high of the prior 5 days (`pop_hi` 5);
- the close is in the top 40% of the day's range;
- volume is at least 1.05 times the 50-day average (`pop_vol` 1.05);
- it is not a 3 ATR day on 4 times volume (the code excludes these), and not within 10 days of an EMA crossback.

A **Reversal extension** is a low at least 2.5 ATR under the 20 EMA while the 20 EMA is not rising, closing in the top
half. The rule does not require one before a pop. The reader also has a seventh, non-Kell stage, **Back over the EMAs**:
after a Wedge drop or a Reversal extension, three closes in a row over both averages that did not qualify as a pop
(its text: "3 closes back over the 10 and 20 EMA (no real pop)"). `confirmed()` then drops a pop once any later close (up to the chart's
date) falls under the pop day's low. The text after a pop reads "next: buy the first EMA crossback (pullback to the 10/20
EMA that holds)". The rule sets no entry or stop for the pop itself.

`api/services/chart_iq/engine/forward.py` adds a "Wedge pop watch" for the day before: 8 of 15 closes under the 20 EMA,
ranges tightening (the last 5 days' average range at most 0.85 times that of the 15 days before), price near the
averages, not under a 50-day that fell more than 3% in 10 days; trigger "a close over" the higher of the averages
and the last 5 highs, "stop under" the lowest low of the last 5 days.

`api/services/chart_iq/engine/v2_setups.py` has a second, different Wedge pop: the first close above the 9 and 21 EMA, at
least 5 of the prior 8 closes under the 21 EMA, volume 1.3 times the 50-day average; text "back over the 9/21 EMA after a
contraction under them".

Who sees it: Chart IQ is behind flags (`CHART_IQ_ENABLED` for admins, `CHART_IQ_MEMBERS_ENABLED` for members, per
`app/src/components/chart/chartIq/chartIqGate.js`). I did not check their live values.

### 5.2 The pattern engine's Kell detector (`api/services/pattern_engine/detectors/uct/kell_cycle.py`)

Registered in the pattern engine and listed by the patterns API (`api/routers/patterns.py`, which describes it as "From
'Victorious Stock Operator'"). It always returns one of five stages. Its Wedge Pop (stage 2): a 5-day move of 7% or more
(either way) 10 to 20 days ago, and a 15-day range under 8% of its midpoint; entry 0.1% above the 15-day high, stop 1%
under the 15-day low. Problems:
1. **The cycle is in the wrong order.** It teaches "reversal extension -> wedge pop -> exhaustion extension -> wedge drop ->
   base & breakout". Kell's order (3.2, kelltrading.com, our own Chart IQ) is Reversal Extension, Wedge Pop, EMA Crossback,
   Base 'n Break, Exhaustion Extension, Wedge Drop. The EMA Crossback is missing, and the base comes last instead of
   before the exhaustion.
2. **It puts words in Kell's mouth.** Its narrative quotes Kell as saying, among others, 'do nothing until the wedge pop
   sets up.', 'size the Wedge Pop trade aggressively because the structure tells you exactly where you are wrong.' and
   'size the Wedge Drop trade larger than your Wedge Pop because the prior Exhaustion gives you better confirmation that
   the old trend is dead.' None of these appears in any Kell source read (his site, newsletter, X post and his
   TraderLion articles and trade reviews). They should be treated as invented until someone finds them. The detector
   also ranks the stages against Kell's own words: its header calls the Base & Breakout "the highest-edge stage for a
   long", where Kell's site calls the Wedge Pop "The highest-probability long entry"; and it calls the Wedge Drop
   "Kell's HIGHEST-edge trade", where his site describes the Wedge Drop as "The downtrend signal" and "How to exit before
   the damage."
3. **It credits Kell with numbers he never published:** "Kell §2" for the 7% break, "Kell's textbook base >= 15 bars", a
   "15-60 bar window". The repo's own sweep found no numbers in Kell's material (4.1).
4. **The book title** "Victorious Stock Operator" is wrong: Kell's book is "Victory in Stock Trading" (section 2).
   `stage_analysis.py` repeats it and the wrong order in its narrative text.
5. **It can never call a Wedge Pop.** Found in checking, from the code: stage 5 is tested before stage 2, and stage 5 is
   true whenever stage 2's range test is (the 15 bars that set the range always count toward its 15-bar base, so
   `base_bars` is at least 15 whenever `is_consolidating` is true). Stage 2 is unreachable. The original run agrees: on
   20 large liquid names (AMD, MU, NVDA, TSLA, NFLX, META, AAPL, MSFT, AMZN, GOOGL, CRWD, SHOP, UBER, ABNB, MELI, QQQ,
   SPY, PLTR, COIN, SMCI), every third day from 2019 to 2026, 200 days of history each time: 11,586 readings, **zero**
   stage 2; 81% stage 5 and 19% stage 4. The repo already records that it
   fires on 100% of symbols and carries no information (`api/services/screener/pattern_join.py`).
6. **A direction bug.** Stage 2 takes its direction from a "reversal direction" that is only set when the 7% break is in
   the last 5 days, but stage 2 looks for it 10 to 20 days back. In the usual case the direction comes out "neutral", and a
   neutral reading takes the short-side branch of the level code (entry under the range low, stop over the range high).
   (Moot today, since stage 2 never fires, but it would bite if the order in point 5 were fixed.)

### 5.3 The Model Book card and playbook

**Card** (`app/src/pages/modelbook/setupCatalog.js`): family "Momentum & Trend", direction long, essence "After the
decline ends, price coils into a tightening wedge below the averages — the pop reclaims them and starts the up-cycle."
(the dash is in the original). The glyph draws the 9 and 20 EMA.

**Playbook** (`app/src/pages/modelbook/setupPlaybooks.js`, added 2026-06-17 in commit ff18bf3fe5, whose message reads
"Authored full {intro, sections, mistakes} entries from the user's write-ups"):
- Context: "At the transition from down-cycle to up-cycle" and "Works intraday, daily, and weekly."
- Criteria: "Price tightens into a wedge (converging range, contracting volatility) after a reversal off lows, frequently
  still below the 9/20-EMA. Volume dries up through the wedge."
- The pop: "The pop is a strong-range candle that breaks the upper boundary and reclaims the moving averages, ideally with
  a gap and a strong close."
- Entry: "Break of the wedge's upper trendline together with the reclaim of the 9/20-EMA; on earnings, the gap-up that
  pops the wedge with a strong close."
- Stop: "Below the wedge / consolidation low."
- Exit: "Trail the 9/20-EMA as the new trend develops; scale into strength on reward-to-risk."
- Mistakes: "Entering inside the wedge before the pop confirms." and "Ignoring whether volume actually dried up through
  the coil."

### 5.4 The journal tag

`app/src/constants/setupGroups.js`: "Wedge Pop" (and "Wedge Drop") in the Swing list. No definition is attached.

### 5.5 The trade plan

`docs/study/TRADE_PLANS.md` has no Wedge Pop row: no detector the plan reads covers it.

### 5.6 Other places the app defines or describes it

- `api/data/voice_kb/trading_principles.json` entry sd-010, titled "Wedge pop (rising wedge breakdown OR falling wedge
  breakout)": a classical falling-wedge definition with trendlines. A Study draft item (`docs/study/bank/recall.principles.json`,
  si_fe5633958fab) uses it as a correct answer.
- `app/src/constants/quotes.json` line 244 credits Kell's book with "Price moves in a cycle: reversal extension, wedge pop,
  EMA crossback, base and break, exhaustion extension. Learn the cycle and you never trade blind." I could not check it
  (the book was not read), and it leaves out the Wedge Drop. Unverified.
- The brain's compiled Kell rows (`docs/study/levels/brain_kb_cycle_2026-11-06.json`, KB 815 and 817 to 821; there is no
  816 in the file; no source given)
  attribute quotes to Kell such as 'If you miss the Wedge Pop, wait for the EMA Crossback.' Unverified.
- The brain's setup template "Wedge Pop (Kell)", as quoted in `docs/superpowers/research/setups/setup_criteria.json`:
  "First close above BOTH 10 EMA and 20 EMA on the same day is the core trigger." and "low-volume wedging up is a warning
  sign, not a trigger", with a family stop maximum of 8.0%.
- `api/services/screener/base_catalog.py` lists the Wedge Pop among structures with no published source ("They come from
  our own `setupGroups.js` model-book taxonomy"). That was true of its sweep; this dossier now has Kell's own pages.
- The Study glossary lesson (`docs/study/bank/recall.glossary.json`) defines it with the Model Book's 9 and 20 EMAs and
  quotes "The owner" for a sentence that sits in an unsigned INTRO section (6.4).
- `docs/study/UNITS-method.md`, unit SET.16, describes the lesson as "Spot the coil, tap the pop candle, and place the stop
  under the coil low." (the Model Book's wider stop, not the house default).

### 5.7 Where the app disagrees with the sources or looks wrong

1. **The scanner misses most named pops.** Chart IQ fires on 5 of 24 dated Wedge Pops named by Kell and UCT (4.5),
   mainly because of its volume floor (1.05 times the 50-day average), its 8-of-15 rule and its range-contraction test.
2. **Half its pops are under the 200-day** (4.4 a), which B26 bans for longs.
3. **Four different definitions** in one app: Chart IQ (10/20 EMA), Chart IQ v2 (9/21 EMA), the Model Book (9/20 EMA,
   trendlines), the pattern engine (a range after a 7% move), plus a knowledge file that calls it a classical wedge.
4. **The pattern engine's Kell detector** teaches the wrong cycle, invents Kell quotes and numbers, never calls a pop in
   my test (and, per the code, cannot), and points its levels the wrong way (5.2). It should not reach members as it stands.
5. **The Model Book's 9/20 EMA** differs from Kell's 10/20, and its "upper trendline" is not Kell's trigger (the pivot).
6. **The Model Book's "scale into strength"** conflicts with A5 (one entry, no adds).
7. **The Model Book's stop** ("Below the wedge / consolidation low") is wider than the house default (the day's low,
   A3) and than Kell's own MU stop.
8. **The Model Book's Wedge Drop** says it comes "after a topping move or Reversal Extension"; Kell's comes after an
   Exhaustion Extension, or sometimes without one ("In some cases, stocks will stop advancing without exhaustion, and we
   will see a tightening of price, followed by a wedge drop."); no Kell source read puts it after a Reversal Extension.
   (For setup 16.)
9. **No trade plan exists** for the setup (5.5), so Hard mode cannot show an entry and stop for it yet.

---

## 6. UCT's own words

I read all 103 posts in
https://unchartedterritoryy.substack.com/sitemap.xml through Substack's post API on 2026-11-09 and searched for "wedge",
"Kell", "cycle of price", "crossback" and "reversal extension". 102 are public; one (2026-10-18) is for subscribers only, its text was cut
to a preview, and nothing below comes from it. Dates below are the US Eastern date of posting; Substack stores UTC, so a
post sent on a weekday evening carries the next day's date in the API. Authorship is by section: "TSDR's Weekly Outlook &
Watchlist" (with its "Charts Covered") is the owner, Patrick (TSDR); "Bracco's Breakdown & Top Ideas" is Bracco; INTRO,
"Index & ETF" and "ETFs Covered" sections are unsigned; "The Rest of the Week" has named contributor sections. Bracco's
"The Parabolic Short" does not mention wedges. The owner's verdict log (`owner_verdicts.jsonl`) has no Wedge Pop ruling.

### 6.1 TSDR (the owner)

- **BIDU, 2025-12-05:** "”Monster” Wedge Pop on Friday following news of IPOing a chip design and AI segment of their
  business." ([sunday-scans-088](https://unchartedterritoryy.substack.com/p/sunday-scans-088), 2025-12-07)
- **BE, 2025-12-04:** "Price got nice and tight in the first half of the week leading to an impressive wedge pop on
  Thursday and closing at weekly highs." (same post)
- **INCY, 2025-12-19:** "Four days of rest within a wedge pop candle on 12/19. I am a buyer on strength through $100.5
  looking for a close above $103.50 to show good presence of buyers."
  ([sunday-scans-249](https://unchartedterritoryy.substack.com/p/sunday-scans-249), 2025-12-28). He buys strength out of the
  few tight days after the pop ($100.5), and wants a close over the pop day's high (103.45 in our bars), not the pop
  day itself.
- **BE, if/then (same post):** if it gets a wedge pop, "this would look very clean."
- **NBIS (January 2026):** "Two bullish open gaps off lows as we wedge popped and building out over the base."
  ([sunday-scans-2a1](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1), 2026-01-18)
- **CRWV, 2026-01-12:** "Incredible week closing up 26.32% with a wedge pop out of the gate on Monday and continuation into
  $100+." (same post). A week later: "Wedge pop last Monday and building over this little base." and "got a tiny size
  position in CRWV at $88 and $93, only a 3% size using $86 as stop."
  ([sunday-scans-7fb](https://unchartedterritoryy.substack.com/p/sunday-scans-7fb), 2026-01-25)
- **PL:** "Again another one that is a simple buy setup on the range break at $12 and wedge pop in December. Then just
  trailed the 9ema." ([sunday-scans-cab](https://unchartedterritoryy.substack.com/p/sunday-scans-cab), 2026-03-22). The same
  passage describes his trail: "Then trailed the 20EMA as it came through my buy price and first trim, then trailed the
  50SMA as it came through my buy price and trim price."
- **What he waits for:** "From there I want to see some stories and stocks get tight and offer good entries against the
  20EMA via wedge pop or crossback."
  ([sunday-scans-29e](https://unchartedterritoryy.substack.com/p/sunday-scans-29e), 2026-02-08)
- **Setting up:** "Setting up for potential wedge pop." (AMD,
  [sunday-scans-461](https://unchartedterritoryy.substack.com/p/sunday-scans-461), 2025-09-14); "Need near term tightening
  and wedge pop." (BE, NBIS, INTC, [sunday-scans-cd2](https://unchartedterritoryy.substack.com/p/sunday-scans-cd2),
  2026-08-02)
- **The market:** "We are pre wedge pop and could get that as early as late this week honestly. That is unless we base to
  head lower once more." (same post)
- **Hourly charts (Discord, as stored in the repo's brain file, KB 10165, 2025-08-20, his words):** "LASTLY, This is a
  time where i use HOURLY charts and the cycle of price action to look for wedge pops." and "It does two things for me,
  prevents me from searching for bottom and gives me higher low areas to risk off". Found in checking.

### 6.2 Bracco

- **MSTR, 2025-06-03:** "Tried this on the wedge pop Tuesday, but got stopped out on Thursday. Bought back small position
  Friday." ([sunday-scans](https://unchartedterritoryy.substack.com/p/sunday-scans), 2025-06-08)
- **TDUP:** "Orderly correction back into 200ma and wedge popped last week."
  ([sunday-scans-088](https://unchartedterritoryy.substack.com/p/sunday-scans-088), 2025-12-07)
- **NBIS, 2026-05-01:** "Back tested previous highs and wedge popped on Friday. Would like a bigger base here, perhaps just
  consolidates into earnings" ([sunday-scans-bcc](https://unchartedterritoryy.substack.com/p/sunday-scans-bcc), 2026-05-03)
- **NBIS, 2026-09-04:** "Nice wedge pop on Friday and going to be watching on the next pullback."
  ([sunday-scans-fcd](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd), 2026-09-06). He buys the pullback after
  the pop, not the pop.
- **From the repo's brain file** (`docs/study/levels/brain_kb_cycle_2026-11-06.json`; Discord posts as stored there, his
  spelling): "i think most traders are not as good at that and woudl rather buy the wedge pop into a new uptrend versus the
  oversold bounce." (KB 12095, 2025-12-01). The same file summarises him on gold: "wedge pops follow through with much
  higher probability early in a cycle" (KB 11404, 2025-05-18; a summary, not his words), and on MSTR: "only one close above
  the 20EMA" was a wedge pop setting up, "not a crossback" (KB 12254, summary).

### 6.3 Manrav (The Rest of the Week)

- **JOBY:** "A wedge pop and a cross back. Price is now pinched between 8, 21 and 50 SMA's."
  ([the-rest-of-the-week-b3f](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-b3f), 2025-12-09)
- **GOOGL:** "Now we want to see a wedge pop (reclaiming the 21 EMA and stay above it)."
  ([the-rest-of-the-week-1b7](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-1b7), 2026-03-10)
- **From the brain file:** "Yes, wedge pop and cross back is a where you want to focus for an entry" (KB 10945,
  2024-06-02, his spelling). The file's summary adds that being long the pop itself "is tough"; that is the summary's
  word, not his: his stored words break off at "(if you are not already long on the wedge".

### 6.4 Unsigned sections (INTRO, Index & ETF, ETFs Covered)

- **The lens:** "Additionally I visualize this through the lens of Oliver Kell's cycle of price action that he applies to
  daily charts. I look for wedge pops, EMA crossbacks, base n breaks." And: "Have found it very reliable for getting pin
  point entries and exits." ([sunday-scans-d70](https://unchartedterritoryy.substack.com/p/sunday-scans-d70), 2025-06-29; it is
  about hourly and 65-minute charts.)
- **The hard window:** "Between the extension and the wedge pop is the hardest spot to trade" and "And possibly even more
  important, we do not know if it is a reversal extension until after the fact and until we get a wedge pop."
  ([sunday-scans-356](https://unchartedterritoryy.substack.com/p/sunday-scans-356), 2026-04-05)
- **An index pop:** "This was a very aggressive wedge pop in the indexes and really more like a failed breakdown for the
  most part. Now looking for continuation and crossback."
  ([sunday-scans-a43](https://unchartedterritoryy.substack.com/p/sunday-scans-a43), 2026-04-12)
- **Before the index pop:** "We are above a flattening 9EMA but a declining 20EMA. In terms of the cycle of price action,
  we are pre wedge pop." and "Additionally, with the wedge pop, as early as TUESDAY the market could get a Follow Through
  Day." ([sunday-scans-cd2](https://unchartedterritoryy.substack.com/p/sunday-scans-cd2), 2026-08-02)
- **Bitcoin:** "Possible reversal extension and looking for a base/wedge pop in the future."
  ([sunday-scans-ccf](https://unchartedterritoryy.substack.com/p/sunday-scans-ccf), 2026-02-15); "Wonder if this can wedge
  pop and remount some short term MAs."
  ([sunday-scans-6a8](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8), 2026-03-01)
- **MSTR, posted the evening of 2025-06-02 ET, the day before the pop Bracco traded (byline Uncharted Territory, no
  section):** "If this can wedge pop on the daily and take previous weeks highs this is one of the best looking weekly
  charts in the market." The same paragraph: "MSTR with some tight wedging action on very low volume here for 4-5 days."
  ([stock-setups](https://unchartedterritoryy.substack.com/p/stock-setups))

### 6.5 What UCT's words add to Kell

- The same averages: the 20 EMA most of all, the 9/20 EMA pair, and the 21 EMA (Manrav).
- Tightness first: "get tight", "Need near term tightening", "nice and tight".
- Often the buy is not the pop day but the first tight days or the first pullback after it (INCY, NBIS, the crossback).
- The pop is used on indexes as a market signal, together with the Follow Through Day.
- Stops are named prices under the base or the pop (CRWV $86), not percentages. (His small CRWV size, "only a 3% size",
  was because he "Was a little off my game 2nd half of the week", not because of the stop; he would "gladly up it to
  standard 15-20%".)
- The owner uses hourly charts and the cycle to find pops and higher lows to risk against (KB 10165, 6.1), as Kell's
  pages advise lower timeframes for entries (3.2, 3.3).

---

## 7. How it fits the account rulebook (`docs/study/sizing_rule.md` section 9)

| Rule | How it applies to the Wedge Pop | Conflict? |
|---|---|---|
| B26, no longs under the 200-day SMA (hard) | Many pops come after declines. Half of the app's pops were under the 200-day (4.4); 4 of the 24 dated named pops were (TSLA 2023-03-21, XRT, QQQ 2025-03-24, CRWV 2026-01-12); Kell's March 2025 index signal came with QQQ under it. | **Yes.** The Wedge Pop is not a parabolic long, so B26's exception does not cover it. Under B26 the course teaches only pops above the 200-day. The data mildly support that (+0.09R against +0.03R, all pops, R not capped). |
| A3 and F62, stop a few cents under the day's low or the prior day's low | Kell's CAVA stop was "under the day's low"; his MU stops at the 10 and 20 EMA sat at the day's low that day. | No conflict on the method. |
| A13, stops usually within about 3% | Pop days are big days: median +5% for the named pops, +7.7% for stocks. The day's-low stop had a median of 3.7% on the named pops (5.2% on stocks) and 3.1% on the app's pops. | **Partly.** About half the pops need a wider stop than 3%. A5 handles it by cutting the size; Kell handles it by entering earlier in the day through the pivot. |
| A5, one entry, one stop, no adds | Kell adds on each new range (AMD); the Model Book says "scale into strength". | **Yes.** Teach one entry. |
| E57, market orders | Fits: a market order when price trades through the pivot. | No. |
| C28, no more than 4% past the buy point | The buy point must be defined as the pivot (the top of the tight range). A pop day that runs 8% past it is a chase under C28. | Needs the pivot defined. |
| C29, skip a long over 10% above its 10-day | 4 of 24 named pops and 10% of the app's pops break it (BE, CRWV, AI, ASTS). | Applies as written. |
| C31, RS 80+ | Only 16% of the app's pops had an RS proxy of 80+; the median was 42. Kell wants relative strength too ("critical for spotting relative strength"). RS 80+ pops did best (+0.14R). | **Tension.** A literal RS 80 rule removes most pops; the owner should decide (question 7). |
| B23, $10 and $20 million a day | Kell's own screens: over $20, over 500,000 shares, $2 to $25 billion market cap (Deepvue). | No. Ours is the looser floor. |
| B22, no new buys in the 3 days before earnings | Two model pops were earnings reactions (AMD 2023-11-01, MELI 2023-02-24; NFLX's 2023-03-23 pop was not: it reported on 2023-01-19 and 2023-04-18). A pop on the day after the report is allowed. | No, if the pop comes after the report. |
| B19, E51, E52, trims and trail | Kell trails the averages, reduces into an Exhaustion Extension and exits on a Wedge Drop or a gap through the averages. TSDR trailed the 9 EMA, then the 20 EMA, then the 50 SMA on PL. | No. The house trims and the 10/21-day trail fit. |
| B20, a gap through the stop | Applies as written. 10% of the house trades in 4.4 gapped through. | No. |
| C33, the time stop | Applies. 18% of the house trades in 4.4 left on it. | No. |
| D47, shorts are our longs reversed | The mirror is Kell's Wedge Drop (setup 16), only under the 200-day. | No. |
| B18 and F65, the market filter | Kell uses the index's own Wedge Pop as his market buy signal; UCT pairs it with the Follow Through Day. F65: Green full risk, Yellow smaller, Orange only A+ setups, Red mostly cash. | No conflict; a question of whether to teach it as a market tell (question 8). The daily test found no extra edge for stock pops right after a QQQ pop (4.4). |

---

## 8. Proposed rules for our course

Each line has its basis. Numbers marked [my proposal] are mine; Kell publishes no numbers.

### 8.1 What it is (checked on the pop day, unless marked)

- **Prior decline:** the stock fell into a correction and spent most of the last three weeks under its 20-day EMA: at
  least 8 of the prior 15 closes under the 20 EMA. [my proposal, from the app's Chart IQ rule; source consensus that it
  follows a decline under the averages: TraderLion's two Kell pages, Deepvue, our Model Book. Note Kell's own MU and CAVA
  pops came on pullbacks inside uptrends, which an 8-of-15 test may or may not catch]
- **A low first:** a capitulation day (a Reversal Extension) OR a slower, rounded low is fine. Do not require a Reversal
  Extension. [originator: "Sometimes, an intermediate bottom is more gradual and forms a rounded bottom."; COIN: "The
  rounded bottom never formed a textbook Reversal Extension but formed a tight tradeable range after the Wedge Pop."]
- **The base:** after the low, at least 3 sessions in which most closes (at least half) sit at or under the higher of
  the 10 and 20-day EMAs, with daily ranges shrinking (the last 5 days' average range under 0.85 times the average
  range of the 10 days before, the app's test). [originator: "has a few days to retreat", "As price volatility
  contracts"; the numbers are my proposal and the app's]
- **The pivot:** the high of the base (short-term resistance). [originator; Deepvue]
- **The pop day:** price trades through the pivot and closes above both the 10 and 20-day EMAs, in the top 40% of its
  range. [source consensus: Kell's wedge pop page "trades through the price range, reclaims the moving averages", his
  cycle page "A break above short-term resistance and a reclaiming of the moving averages", Deepvue "A breakout above
  resistance and reclaiming the moving averages"; the close above the averages and the 40% are the app's numbers]
- **Volume:** pop-day volume above the prior day's and above the average of the base days. The 50-day average is not
  required. [originator: "increased accumulation volume"; my proposal for the measure, from 4.5: 18 of 24 named pops beat
  the prior day, 10 of 24 reached 1.05 times the 50-day average]
- **The averages:** the 10 and 20-day EMAs. [originator] (Option: our 9/20 EMA. Question 1.)
- **Location:** the close is above the 200-day SMA [house rule B26] and no more than 10% above the 10-day average [house
  rule C29].
- **Liquidity:** $10 or more and $20 million a day [house rule B23].
- **Relative strength:** the stock held up better than its index during the decline (measured: its fall from its 60-day
  high to the base low is smaller, in percent, than QQQ's or SPY's over the same days), ideally an RS rating of 80 or
  more. [originator: "critical for spotting relative strength"; house rule C31, see question 7; the measure is my
  proposal]

### 8.2 The buy

- **Trigger:** the first trade through the pivot that is also above both averages. [originator]
- **Order:** a market order when it trades through (E57). If it opens above the pivot on a gap, buy at the open if the
  gap is no more than 4% above the pivot. [house rules E57, C28; originator: "Most Wedge Pops that lead to new, powerful
  trends start with gaps."]
- **Not more than 4% past the pivot** (C28). If the pop day runs further, wait for the first tight day or pullback after
  it, as TSDR did on INCY and Bracco on NBIS. [house rule; UCT]
- **The second chance:** the first pullback into the rising averages after the pop is the EMA Crossback, a separate setup
  (14). [originator]

### 8.3 The stop

- **A few cents under the pop day's low** (default). [house rule A3, F62; originator: CAVA, "Oliver initiated his position
  with a stop set under the day's low."]
- If the honest stop is wider than about 3%, take a smaller position (A5) or skip; never tighten the stop to fit. [house
  rules A3, A13]
- Options the owner may allow instead: under the base low (the Model Book; wider) or, for an intraday entry, under the
  pivot day's low on the hourly chart. [UCT for the base low; my proposal for the hourly stop, built on Kell's "Hourly
  and 15-minute charts are for timing entries."]

### 8.4 Trims and trail (house defaults; nothing in the setup asks for its own)

- A third at 3R, a third at 5R, breakeven at 2R to 5R, trail the rest under the 10-day (fast movers) or 21-day (steadier).
  [house rules B19, E51, E52]
- Sell a big part into an Exhaustion Extension (a climax run far above the averages). [originator; house rule C34]
- The time stop: under 1R after 10 trading days, sell. [house rule C33]

### 8.5 What invalidates it

- A close back under the pop day's low: the pop failed (the stop is just under it anyway). [the app's `confirmed()` rule;
  originator: "If it fails, cut losses quickly."]
- A close back under both averages and back inside the base within 5 sessions after the pop. [originator: TSLA "playing
  defense"; my proposal for the exact test]
- Before the buy: the pop comes on volume no higher than the base days, or the index is still making lower lows with
  the averages falling. [originator: QQQ 2023's "first two potential Wedge Pops failed with no increase in accumulation"]

### 8.6 The short mirror

- Kell's **Wedge Drop** after an Exhaustion Extension (or, his cycle page says, sometimes after a stall without one): a
  tight range up into the averages, then a break down through them. Only below the 200-day (B26, D47). Setup 16.
  [originator; house rules]

### 8.7 Best market conditions

- Within about 20 sessions after the index makes its own Reversal Extension and Wedge Pop: the first leaders pop or
  break out of bases. [originator: "Get aggressive trading individual stocks when you see a Reversal Extension on the
  index."; UCT; the 20 sessions are my proposal. The daily test in 4.4 did NOT find a measurable edge for this, so it
  rests on Kell's and UCT's experience, not on our numbers]
- Early in a new cycle, not the fourth base of an old one. [UCT: Bracco, KB 11404, as summarised]
- A Green or Yellow market reading; in Orange only an A+ pop; in Red mostly cash (F65, D46). [house rule]

### 8.8 Common mistakes

- Buying the Reversal Extension low itself (bottom fishing). [originator: "Often, trading the daily Reversal Extension is
  best avoided."]
- Calling any cross of the averages a Wedge Pop, with no tight base and no pivot. [originator]
- Buying inside the wedge before the pop. [UCT Model Book]
- A pop with no rise in volume. [originator]
- Chasing a pop day far past the pivot. [house rule C28]
- Buying a pop under the 200-day. [house rule B26]
- Adding to it on the way up. [house rule A5]
- Moving the stop down when the first days are weak. [house rule A4]

---

## 9. Grading: what makes an A+ versus a B-

The owner rules that grading is discretionary and that no fixed checklist is taught as ours (E50). So this is a guide to
what the sources prize, not a scoring rule.

**A+ looks like:**
- The index has just made its own Reversal Extension and Wedge Pop, and this stock held up during the fall (near its
  highs, RS high). [originator]
- A clear tight base of several days under the flattening averages, ranges shrinking, volume drying up. [originator; UCT]
- The pop gaps up through the averages and the pivot, closes near the high, on clearly more volume than the base days.
  [originator: gaps, "strong price bar with increased volume"]
- A catalyst behind it: an earnings reaction or real news (AMD and MELI on earnings, per Kell; BIDU on news, per TSDR).
  [originator; UCT]
- Above the 200-day, ideally reclaiming the 50-day too, in a leading group or theme (semis for AMD and MU). [originator;
  house rule]
- A day's-low stop within about 3%, so it can be sized normally. [house rule A13]

**B- looks like:**
- No rise in volume; a wide, sloppy base; the stock is a laggard. [originator]
- Under the 200-day (not tradable under B26), or more than 10% above the 10-day (C29). [house rules]
- The index still falling with its averages pointing down. [originator]
- A late-cycle base (the third or fourth base of an old trend). [UCT]
- Overhead supply right above: an unfilled gap down or a falling 50-day just over the pivot. [originator: TSLA
  "Rejecting at the gap resistance"; UCT]
- A stop that has to be 8% or more away. [my proposal; 8.0% is the brain template's family maximum]

---

## 10. Questions for the owner

1. **Which averages?** (a) Kell's 10 and 20-day EMAs; (b) the Model Book's 9 and 20-day EMAs; (c) the 20 EMA alone.
   I recommend (a): it is the originator's pair and the app's Chart IQ reader already uses it.
2. **Must a Reversal Extension come first?** (a) yes, a capitulation day first; (b) no, any decline that spent most of
   three weeks under the 20 EMA (8 of 15 closes). I recommend (b): Kell allows rounded lows (COIN: "never formed a
   textbook Reversal Extension") and popped MU and CAVA inside uptrends.
3. **The 200-day.** B26 is hard and bans the pops under the 200-day, about half of all pops. Keep it as is (my
   recommendation; the data are mildly on its side), or allow index and ETF pops under it as a market tell only?
4. **Volume.** (a) above the prior day and the base days; (b) at least 1.05 times the 50-day average (the app); (c) at
   least 1.5 times. I recommend (a): half of the pops Kell and UCT named had less than the 50-day average.
5. **Entry.** (a) through the pivot during the day; (b) at the close when it closes above both averages; (c) the break of
   the pop day's high after a few tight days (your INCY plan). I recommend (a), with (c) as the fallback when the pop day
   runs more than 4% past the pivot.
6. **Stop.** (a) under the pop day's low (house default); (b) under the base low (Model Book); (c) staggered under the 10
   and 20 EMA (Kell's MU). I recommend (a).
7. **RS 80+ (C31).** Only 16% of pops qualify on the day. (a) require RS 80+; (b) require only that the stock held up
   better than its index in the decline; (c) treat RS as a grade factor, not a gate. Your call; the data favour RS but
   (a) leaves few trades.
8. **Index pops.** Teach the index's own Wedge Pop as a market tell next to the Follow Through Day (as the Sunday Scans
   do), or keep the course to stocks?
9. **Timeframes.** Daily only, or also hourly and 65-minute (as the Sunday Scans and Kell use it)?
10. **The app.** May the pattern engine's Kell detector text be pulled or rewritten (wrong cycle, invented quotes, wrong
    book title), the knowledge entry sd-010 fixed, and the Model Book card moved to 10/20 EMA with "scale into strength"
    removed? These are your product's words.
11. **Authorship.** Several Wedge Pop lines sit in unsigned INTRO and "Index & ETF" sections, and the Study glossary
    credits one of them to you. Are those sections yours?
12. **Model charts.** Which ten of the 30 named cases in 4.5 (plus Kell's CAVA 2024-04-26, found in checking) should be
    the model book for this setup? Those with a stated day are the safest.

---

## 11. Sources

Read 2026-11-09 unless marked. Archive copy means the Internet Archive's copy, read because the live site blocks our
tools.

| # | Source | Publisher, author, date | Reliability |
|---|---|---|---|
| S1 | ["Wedge Pop: The Money Pattern"](https://traderlion.com/technical-analysis/chart-patterns/wedge-pop-the-money-pattern/), archive copies [2024-10-06](https://web.archive.org/web/20241006111805/https://traderlion.com/technical-analysis/chart-patterns/wedge-pop-the-money-pattern/) and [2025-04-25](https://web.archive.org/web/20250425064619/https://traderlion.com/technical-analysis/chart-patterns/wedge-pop-the-money-pattern/) | TraderLion, byline Oliver Kell, 2024-09-11 (edited later) | High for Kell's method; written in the third person, likely by staff; TraderLion sells his course. |
| S2 | ["Cycle Of Price Action"](https://traderlion.com/technical-analysis/chart-patterns/cycle-of-price-action-by-oliver-kell/), [archive copy 2025-01-19](https://web.archive.org/web/20250119115745/https://traderlion.com/technical-analysis/chart-patterns/cycle-of-price-action-by-oliver-kell/) | TraderLion, byline Kell, 2024-09-10 | High, same note. |
| S3 | ["Reversal Extension: How Stocks Bottom"](https://traderlion.com/technical-analysis/chart-patterns/reversal-extension-how-stocks-bottom/), [archive copy 2024-12-12](https://web.archive.org/web/20241212100755/https://traderlion.com/technical-analysis/chart-patterns/reversal-extension-how-stocks-bottom/) | TraderLion, byline Kell, 2024-06-11 | High, same note. |
| S4 | ["Anatomy Of A Trade: MU +20% Wedge Pop"](https://traderlion.com/profile/oliver-kell/mu-wedge-pop/), [archive copy 2025-02-11](https://web.archive.org/web/20250211124917/https://traderlion.com/profile/oliver-kell/mu-wedge-pop/) | TraderLion, byline Kell, 2024-09-13 | High for what he did; one chosen trade. |
| S5 | ["Anatomy Of A Trade: AMD +50% Wedge Pop"](https://traderlion.com/profile/oliver-kell/amd-wedge-pop/), [archive copy 2025-02-11](https://web.archive.org/web/20250211110316/https://traderlion.com/profile/oliver-kell/amd-wedge-pop/) | TraderLion, byline Kell, 2024-09-13 | High, same note. |
| S6 | [The Weeklies Watch](https://weeklieswatch.substack.com/), 33 posts, 2023-01-14 to 2023-10-07 | Substack, Oliver Kell | Highest: his own words. |
| S7 | [Post on X](https://x.com/OliverKell_/status/1904264900354126284), read through publish.twitter.com/oembed | Oliver Kell, 2025-03-24 | High: his own words; truncated by X after about 40 words. |
| S8 | [kelltrading.com](https://kelltrading.com/) | Oliver Kell's site | High, but marketing copy. |
| S9 | [Oliver Kell: 5 Screens to Find Stocks Like a Champion](https://deepvue.com/screener/oliver-kell-screens/) | Deepvue, last updated 2025-03-21 | Medium-high: a vendor that says it partnered with Kell. |
| S10 | [5 Key Concepts from My Interview with Oliver Kell](https://tradingengineered.substack.com/p/5-key-concepts-from-my-interview) | Trading Engineered, Richard Moglen, 2021-10-15 | Medium-high: interviewer's summary. |
| S11 | [The Wedge Pop Trading Setup of Trading Champion Oliver Kell](https://www.youtube.com/watch?v=m8F3KkBDtC0) (titled "Swing Trading Crash Course \| US Investing Champion Oliver Kell" in the [archive copy of 2022-10-04](http://web.archive.org/web/20221004154858/https://www.youtube.com/watch?v=m8F3KkBDtC0)) | TraderLion on YouTube, uploaded 2021-09-23, 70 minutes | Title, date, description and chapters only; transcript not readable. The current title is not evidence of 2021 use. |
| S12 | [Interview w/ Oliver Kell (@OliverKell_)](https://www.youtube.com/watch?v=k-5i91eHX1c) | Uncharted Territory on YouTube, 2025-11-10 | Title, date and chapters only; transcript not readable. The best unread source. |
| S13 | [TraderLion course page](https://web.archive.org/web/20250623150402/https://traderlion.com/courses/swing-trading-masterclass-with-oliver-kell/) (archive copy 2025-06-23) and [Kell's TraderLion article list](https://web.archive.org/web/20250513102959/https://traderlion.com/category/profile/oliver-kell/) (archive copy 2025-05-13) | TraderLion | Lesson and article titles only. |
| S14 | [Victory in Stock Trading](https://www.goodreads.com/book/show/58295305-victory-in-stock-trading) and [kelltrading.com/the-book](https://kelltrading.com/the-book/) | Goodreads listing, Oliver Kell, dated 2021; Kell's own book page | Metadata only (Goodreads re-read in checking through a fetch tool). Book not read. |
| S15 | [Falling Wedges](https://thepatternsite.com/fallwedge.html) and its [glossary](https://thepatternsite.com/glossary.html) | Thomas Bulkowski, statistics updated 2020-08-27 | High for classical statistics, but a different pattern. **The site states it may not be used to train AI systems.** Read through a fetch tool (twice); no copy saved. |
| S16 | [Wedge Pop & Drop](https://www.tradingview.com/script/GOkJ7o5J-Wedge-Pop-Drop-QuantVue/) | TradingView, QuantVue, 2024-08-13 | Low: community indicator; not used for rules. |
| S17 | [Oliver Kell Cycle of Price Action](https://in.tradingview.com/script/xHyBTcMq-Oliver-Kell-Cycle-of-Price-Action/) | TradingView, vishnuv, 2025-10-26 | Low: community indicator; not used for rules. |
| S18 | [15 Best Oliver Kell Quotes For Swing Trading](https://web.archive.org/web/20250513093520/https://traderlion.com/quotes/15-oliver-kell-quotes-for-swing-trading/) (archive copy) | TraderLion, Ameet Rai, 2024-08-22 | Read; no Wedge Pop content; quotes unsourced. Not used. |
| S19 | [Oliver Kell: US Investing Champion Strategy](https://www.financialwisdomtv.com/post/oliver-kell-us-investing-champion) | Financial Wisdom | Read; no Wedge Pop content. Not used. |
| S20 | [#91 Oliver Kell, AlphaMind podcast page](https://alphamindpodcast.buzzsprout.com/288762/episodes/10698812-91-oliver-kell-us-trading-champion-2020-the-journey-to-trading-mastery) | Buzzsprout | Read; episode page only, no transcript. Not used. |
| S21 | [TraderLion podcast page, Oliver Kell interview](https://web.archive.org/web/20220627232838/https://traderlion.com/traderlion-podcasts/oliver-kell-interview/) (archive copy 2022-06-27) | TraderLion | Read; no transcript. Not used. |
| S22 | [UCT Substack](https://unchartedterritoryy.substack.com), all 103 posts in the sitemap | Uncharted Territory (TSDR, Bracco, contributors), 2025-06 to 2026-11 | Primary for how we trade it; authorship by section. |
| S23 | Repo files: `api/services/chart_iq/engine/v44_read.py`, `forward.py`, `v2_setups.py`; `api/services/pattern_engine/detectors/uct/kell_cycle.py`, `structure/stage_analysis.py`; `api/routers/patterns.py`; `app/src/pages/modelbook/setupCatalog.js`, `setupPlaybooks.js`; `app/src/constants/setupGroups.js`, `quotes.json`; `api/data/voice_kb/trading_principles.json`; `docs/study/levels/brain_kb_cycle_2026-11-06.json`; `docs/superpowers/research/setups/setup_criteria.json`; `api/services/screener/base_catalog.py`; `docs/study/bank/*.json`; `docs/study/sizing_rule.md`; `docs/study/TRADE_PLANS.md`; `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | UCT | Primary for what the app does; the brain rows are summaries of Discord posts, of mixed provenance. |
| S24 | Local daily bars (`bars.db` in the test data folder), read-only | UCT data pipeline | Good for the measurements in 4.4 and 4.5; probably survivorship-biased. |
| S25 | Kell's TraderLion trade reviews ["CAVA +40% Breakout"](https://web.archive.org/web/20250211122647/https://traderlion.com/profile/oliver-kell/cava-breakout/), ["COIN +110% Trendline Breakout"](https://web.archive.org/web/20250211104800/https://traderlion.com/profile/oliver-kell/coin-trendline-breakout/), ["ARM +35% Reversal Extension"](https://web.archive.org/web/20250211111026/https://traderlion.com/profile/oliver-kell/arm-reversal-extension/) (archive copies 2025-02-11) | TraderLion, byline Kell, 2024-09-11 | High for what he did; chosen trades. Added in checking. |
| S26 | [TraderLion forum thread, archive copy 2021-12-05](https://web.archive.org/web/20211205134014/https://university.traderlion.com/forums/discussion/tos-scanner-for-oliver-kells-wedge-pop-criteria/) | TraderLion course members | Forum: used only to date the term (from its URL); no rule taken from it. Added in checking. |

Not reachable this session: TraderLion's live pages (HTTP 403), TraderLion's course slides (bot check), YouTube captions
(refused), and the full text of Kell's book.

---

## 12. Checking notes (cold check, 2026-11-09)

### Removed in checking

1. **"2021-09-23: TraderLion posted Kell's 2021 conference talk on YouTube under the title 'The Wedge Pop Trading Setup
   of Trading Champion Oliver Kell'."** Wrong as a dated use: the Internet Archive copy of 2022-10-04 shows the video was
   then titled "Swing Trading Crash Course | US Investing Champion Oliver Kell"; the Wedge Pop title came later. Moved
   to a note in section 2.
2. **"Stock pops ... within 21 days after QQQ's own app-detected pop: +0.17R (standard error 0.07, 765 trades) against
   +0.09R for the rest."** The code for it is not in the scratchpad, and re-runs from the writer's own event file with
   windows of 20 and 21 trading days gave 0.00R to +0.12R against +0.09R to +0.10R: no edge. Replaced in 4.4 by the
   re-run, and the claim in 8.7 that "my measurement in 4.4 points the same way" was taken out.
3. **"'perfect trades' means selling at the ultimate high, which no trader can do."** Not stated on Bulkowski's page or
   in his glossary. Replaced by what the glossary does say.
4. **"position size shrinks when the stop is wide (CRWV 'only a 3% size')"** (6.5). His own reason was "Was a little off
   my game 2nd half of the week". Replaced by his words.
5. **NFLX as an earnings pop** (sections 7 and 9). NFLX reported on 2023-01-19 and 2023-04-18; Kell's 2023-03-23 note
   names no catalyst.
6. **"a reason to weigh Kell's wider stop staggered at the averages (MU)"** (4.5). On MU and on the three index pops the
   10 and 20 EMAs sat at or above the pop day's low, so a stop at the averages was not wider. Replaced by the measured
   facts.
7. **"the last [invented quote] contradicts his site"** (5.2). The Wedge Drop sizing line does not directly contradict
   "The highest-probability long entry" (one is a short, one a long). Replaced by two contradictions that are direct.

### Corrected in checking

- The app's volume floor: 10 of 24 named pops reached 1.05 times the 50-day average, not 11; 14 missed on volume, not
  13 (SPY 2025-03-24 sat at 1.046x). Fixed in 4.5 and 8.1.
- Section 4.4: "The prior day's low is wider: median 4.97%" measured the lower of the two days' lows; reworded. "+0.09R
  against +0.04R" for the 200-day mixed two filter sets; now +0.09R against +0.03R on the same basis (sections 4.4 and 7).
  "The edge is about the size of trading costs" had no number behind it; reworded.
- Post dates: Substack stores UTC, so five evening posts carried the next day's date. Fixed: stock-setups 2025-06-02,
  trade-updates 2025-06-09, Rest of the Week 2025-12-09 and 2026-03-10, Sunday Scans 2026-02-15.
- Deepvue's date is a "Last Updated" date. QuantVue's extension rule comes from its description, not code read by us.
- TraderLion's cycle page has two extra downside steps after the Wedge Drop (section 2).
- The book title: Kell's own site confirms "Victory in Stock Trading"; "Victorious Stock Operator" is now called a
  mistake, not just unverified. Goodreads was re-read (80 pages, ebook, dated January 1, 2021).
- KB rows "815 to 821": there is no 816. Manrav's KB 10945: the word "tough" is the summary's, not his. "wedge
  popping" is the brain summary's wording (KB 10937), not a UCT writer's; now said so in section 2.
- The pattern engine's Kell detector: not "almost never" but never calls a Wedge Pop (stage 2 is unreachable in the
  code); the direction bug is moot until that is fixed.
- The Model Book Wedge Drop item: Kell's cycle page allows a Wedge Drop without an exhaustion.
- Proposed rules made measurable: the base (at least half the closes at or under the higher average; 0.85 range test),
  relative strength (smaller fall than QQQ or SPY), invalidation (within 5 sessions), market timing (within about 20
  sessions), market reading (F65's Orange and Red cases added). [source consensus] tags now name their sources.

### Added in checking

- Kell's CAVA, COIN and ARM trade reviews (3.4, S25): the clearest Kell stop on a pop ("a stop set under the day's
  low"), and his own statement that a pop can come without "a textbook Reversal Extension". CAVA 2024-04-26 measured
  and added as a model-chart candidate.
- Kell keeps the classical "descending wedge" separate (newsletter, course lesson list).
- Kell's 65-minute and 15-minute timing line (3.3); his cycle page's "lower-risk entry occurs in a few trading
  sessions" (3.2).
- The app's "Back over the EMAs" stage and how often it took the named pops (5.1, 4.5).
- TSDR's own words on using hourly charts and the cycle to find wedge pops (KB 10165) and his link to TraderLion's cycle
  page (KB 11569).
- The TraderLion forum thread of 2021-12-05 (date only) and Bulkowski's shape, volume, confirmation and target lines.

### Confirmed unchanged

Every other quote in the dossier was found on its page or in its file, in context (by a script that searched saved copies
of every source, and by eye where code splits a sentence across lines). The app summaries in 5.1 to 5.6
match the code. Section 4.4's figures match the writer's saved outputs (`analysis.txt`, `analysis2.txt`), and section
4.5's day change, volume, 200-day, stop, depth, gap and 10-day figures were re-measured from the bars and match (to
rounding). The house R column in 4.5 was spot-checked for the winners count and mean (7 of 24, +0.18R), not
re-simulated.

---

## 13. Examples (from our data)

(Numbered 13 because this dossier's section 12 is already the checking notes; this is the "Examples (from our data)"
section the other dossiers carry as 12.)

**The scan's rule (one paragraph).** Daily bars from the local sandbox, scanned over the 2,630 names that ever met the
house liquidity rule (`common.universe("ever")`), triggers from 2000-01-01 to 2026-11-04; the scan completed in 310
seconds, nothing was cut for time. A hit is a pop day t that meets section 8.1 as coded: at least 8 of the 15 closes
before t under the 20-day EMA (the prior decline); the lowest low of the 20 sessions before t is also the lowest low of
the 40 sessions before t (a fresh low, then a base); the base is the sessions after that low day up to t-1, at least 3 of
them, with at least half of their closes at or under the higher of the 10- and 20-day EMAs and ranges shrinking (the
mean range of the 5 sessions before t under 0.85 times the mean range of the 10 sessions before those); the pivot is the
highest high of the base; on the pop day the high trades through the pivot, the close is above both EMAs and in the top
40% of the day's range, volume beats the prior day's and the base days' average; close above the 200-day SMA (B26) and
not more than 10% above the 10-day SMA (C29); close $10 or more and 50-day average dollar volume $20 million or more
on the day before (B23). The fill is a market order at the pivot plus a cent, or the open when the open gapped above the
pivot, and no fill more than 4% over the pivot (C28, E57); the stop is 5 cents under the pop day's low (A3), and hits
whose stop was wider than 10% or narrower than 0.75% were dropped (the same bounds as 4.4: not tradable, or an R so
small the multiples mean nothing). One hit per name per 20 sessions. Not coded: relative strength against the index
(8.1's last line) and the RS rating (C31), the market reading, the trims, the time stop and the earnings blackout (B22).
Outcome: from the day after the pop, 60 sessions forward, the first of stop / 3R / 5R; same day, the stop wins. Code:
`scratchpad/setups/15-wedge-pop/scan_wp.py` and `chart_wp.py` (not in the repo).

**Base rate.** 6,518 hits; 6,289 on stocks after removing the obvious ETFs by ticker (SPY, QQQ, the sector and leveraged
funds). Of the stock hits, **42.7% reached 3R and 29.2% reached 5R before the stop**; 81.8% were eventually stopped at
the original stop within the 60-session window (that includes winners, since the stop never moves here). The median
stop was 1.7% of the fill and the median time to 3R among the winners was 3 sessions. **Caveats:** (1) a fixed stop
with no trims, no breakeven move, no trail and no time stop, so this measures how often the structure delivers 3R and
5R, not what the house trade earns; (2) the fill is at the pivot intraday, but the pop day's qualifying facts (the close
above both EMAs and in the top 40% of the range, the volume) are known only at the close, so a trader who buys the
pivot as it trades also takes the pops that fade before the close, which this scan never counts. That is the main
reason this rate is so much higher than 4.4's 20.6% (which bought at the close); the pop day's own run from the pivot to
the close is counted as profit here. Cuts worth teaching (stocks only): pop-day volume 1.5 times the base days' average
or more, 2,119 hits, 48.0% to 3R and 32.8% to 5R, against 40.0% and 27.4% below it (Kell's "increased accumulation
volume" earns its place); a close back under the pivot on the pop day (1,026 hits) cut the rate to 23.1% / 14.0%
against 46.5% / 32.1% for a close above it, the strongest single cut, and a reason to make "closes above the pivot" part
of the grade; a gap open of 1% or more (1,333 hits) did better, 46.2% / 33.6%, not worse, which sides with Kell's "Most
Wedge Pops that lead to new, powerful trends start with gaps"; a stop within 3% (5,170 hits) 45.5% / 31.5% against
29.8% / 18.2% for wider stops (A13 earns its place); a decline of 15% or more into the low (3,516 hits) 44.9% / 30.4%
against 39.9% / 27.6%; the count of closes under the 20 EMA (12 or more of 15 against 8 to 11) made no difference,
43.1% / 29.3% against 41.8% / 29.0%; short bases of 3 to 5 sessions (1,504 hits) did slightly better than longer ones,
46.5% / 32.4% against 41.5% / 28.2%; the app's 1.05 times the 50-day volume (4,020 hits) added little, 43.9% / 30.3%
against 40.6% / 27.1%.

**The 10 examples** (all stocks, one per name, ten different years; no pop day was an earnings-reaction day and none
had a report inside the 3 sessions after it; every one reached 5R and was above 1R by the tenth session, so the house time
stop (C33) would not have cut it; prices are split-adjusted as the database holds them). Files:
`scratchpad/setups/15-wedge-pop/final/NN_TICKER_DATE.png` and the phone sheets `sheet_1-4.png`, `sheet_5-7.png`,
`sheet_8-10.png` (not in the repo). "Decline" is the fall from the highest high of the 60 sessions before the low to the
low; "under" is closes under the 20 EMA in the 15 sessions before the pop; "vol" is pop-day volume over the base days'
average (and over the 50-day average).

| # | Ticker | Pop day | Decline / under / base | Vol | Buy | Stop (risk) | Best R (3R on day) | Why it is textbook |
|---|---|---|---|---|---|---|---|---|
| 1 | CROX | 2007-04-04 | 26% / 12 of 15 / 14 days, 21.68-24.57 | 1.9x (1.3x) | 24.58 | 23.68 (3.6%) | 25R (7) | After a 26% correction, two weeks of flat, shrinking bars under both EMAs; the pop closed at 24.99, in the top 3% of its range. The widest stop of the ten (3.6%) and the slowest start (3R on day 7): A13 says smaller size, not a skip. Then 25 to 45. |
| 2 | RCL | 2009-07-15 | 34% / 14 of 15 / 4 days, 11.80-12.95 | 1.4x (0.9x) | 13.18 (the open, a 3.9% gap) | 12.97 (1.6%) | 56R (1) | Early in the 2009 cycle, the shortest base the rule allows, right at the 200-day. A gap open under the 4% chase line, so the fill is the open and the stop (under the day's low) sits above the pivot. Volume beat the base and the prior day but not the 50-day average: the setup's own volume test, not the app's. |
| 3 | FNV | 2016-02-03 | 25% / 14 of 15 / 7 days, 41.47-45.52 | 1.7x (1.7x) | 45.53 | 44.77 (1.7%) | 34R (1) | The base formed just under a flat 200-day and the pop closed 0.6% above it, the thinnest B26 pass of the ten. 3R the next session and 45 to 69 in ten weeks. |
| 4 | TEAM | 2019-05-08 | 14% / 9 of 15 / 12 days, 100.25-112.00 | 2.1x (2.1x) | 112.01 | 110.81 (1.1%) | 31R (1) | A pullback inside a strong uptrend (28% above the 200-day), the kind of pop Kell took on MU and CAVA: the shallowest decline and the fewest closes under the 20 EMA (9) that still qualified. The pop closed at 117.17 in the top 4% of its range. |
| 5 | NET | 2020-09-18 | 28% / 12 of 15 / 7 days, 32.70-36.33 | 2.1x (2.0x) | 36.50 (the open, a 1.1% gap) | 35.59 (2.5%) | 55R (2) | A two-week shakeout under both EMAs after a long run, the ranges shrinking to 0.57 of the prior ten days'; the pop reclaimed both averages on twice the base's volume, then 37 to 75 by November. |
| 6 | TGT | 2021-03-19 | 17% / 15 of 15 / 10 days, 166.83-181.79 | 2.2x (1.9x) | 181.80 | 179.58 (1.2%) | 25R (1) | The clearest wedge shape of the ten: the heaviest-volume day of the decline (2021-03-02) came two sessions before the low, then two weeks of shrinking bars (contraction 0.44, the tightest here) under both EMAs, then a pop that closed above the pivot and both averages. |
| 7 | SLB | 2022-01-03 | 21% / 12 of 15 / 8 days, 27.65-30.24 | 2.5x (1.8x) | 30.25 | 29.93 (1.1%) | 50R (1) | One wide-range bar from inside the base through the pivot and both EMAs, closing at 31.72, 4.9% over the pivot: buyable only as it traded through (E57), a chase at the close (C28). Energy's 2022 leadership started here. |
| 8 | DHI | 2023-11-01 | 22% / 13 of 15 / 5 days, 100.08-104.78 | 1.6x (1.3x) | 104.79 | 103.60 (1.1%) | 45R (1) | Three sessions after SPY's 2023-10-27 low: a five-day base that sat just under the 200-day, and a pop that closed 0.8% above it with 3R the next day. The "within about 20 sessions after the index's own low" condition in 8.7, in one chart. |
| 9 | SNOW | 2025-04-24 | 38% / 13 of 15 / 11 days, 120.10-151.95 | 1.6x (1.2x) | 151.96 (the open, a 1.2% gap) | 149.03 (1.9%) | 25R (3) | The deepest decline of the ten, into the 2025-04-07 crash low that SPY shared; eleven sessions of base (the box is tall because the rebound off 120 is inside it; the pivot is the high of those sessions), then a pop above both EMAs while the index itself was popping. |
| 10 | STLD | 2026-03-31 | 22% / 15 of 15 / 7 days, 162.16-175.51 | 1.2x (1.3x) | 175.52 | 171.31 (2.4%) | 27R (6) | The lightest pop volume of the ten (1.2 times the base), a B-grade pop that still worked: 3R took six sessions, then 175 to 280 in ten weeks. Shows volume as a grade cue, not a gate, exactly as 8.1 proposes. |

Replaced or passed over in the visual review: TPR 2004-10-26 and GLW 2005-10-31 (clean pops, but the report came the
same evening or the day before, so B22 would have blocked it or the pop was an earnings reaction), AXON 2014-10-28 (a
report two sessions after the pop), BHC 2010-12-01 (a gap open that put the stop above the pivot on a 16% pullback,
confusing on a first read), UCTT 2017-07-10 and SM 2011-06-29 (reached 5R on a tight stop but then chopped inside the
old range, not an obvious picture), RIO 2008-04-02 (a bear-market rally that gave back the whole move). XYZ 2018-01-03
(Square, now Block) was clean but is a renamed ticker, and TEX 2025-12-03 and SPHR 2025-08-25 are good alternates for
2025 if SNOW is replaced.

**Notable failures (in words).**
- **MU 2022-03-29.** A pop through 81.20 on 1.8 times the 50-day volume, closing at 82.05 above both EMAs, after a
  31% decline and 14 of 15 closes under the 20 EMA: a textbook picture. Micron reported that evening (2022-03-29, after
  the close); the next day's low of 78.60 went through the 79.21 stop at the open. The B22 blackout (no trigger in the
  3 sessions before a report) is the whole lesson. AMZN 2016-01-28 is the same story: a 2.9x-volume pop at 30.43
  (split-adjusted), the report that night, a 28.50 low the next day through a 29.83 stop.
- **CRWD 2021-03-17.** The pop was itself the earnings-reaction day (reported 2021-03-16 after the close) on 3 times the
  50-day volume, and the day's range left a stop 8.6% below the fill. It was stopped the next session at 47.40. Two
  lessons: an earnings-day pop is an Episodic Pivot or Power Earnings Gap, not a Wedge Pop; and a stop wider than about
  3% is a reason for a smaller position or a pass (A13), never a reason to tighten it to fit.
- **COIN 2024-08-23.** A 13-day base after a 41% decline, 15 of 15 closes under the 20 EMA, then a pop through 209.80
  that closed at 211.40, but on only 1.04 times the 50-day volume and with a 4.7% stop. Two sessions later the low of
  194.10 took the stop out. In the scan, pops with volume under 1.5 times the base and a stop wider than 3% were the
  weakest groups; this one was both.

---

## 14. Failures and near-misses (from our data)

(Added 2026-11-10, deliverable 4 of `CRITERIA_PROGRAMME.md`. Every number is read off the sandbox's daily bars with the same scan and the same fixed-stop walk as the examples section above; charts in `_study-resume/scratchpad/setups/15-wedge-pop/final/` (`fail_1-4.png`, `near_1-4.png`, `pair_14-ema-crossback.png`), numbers in `final/failures.json` and `final/near_misses.json`, scripts `near_scan_*.py` and `failnear_*.py` in the setup's scratchpad folder, outside the repo.)

**Four failures.** Valid wedge pop setups by every gate of the card, bought by the rules and stopped before 3R (fixed stop under the day's low, no trims, no breakeven move). Dates are the trigger day; "where it stopped" counts sessions after the trigger.

| Ticker | Date | Buy | Stop (risk) | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|
| MU | 2022-03-29 | 82.10 | 79.21 (3.52%) | day 1 (2022-03-30, low 78.60), best 0.0R | A 31% decline, 14 of 15 closes under the 20 EMA, a 9-day base 68.34 to 81.20, then a gap open at 82.10 over the pivot on 1.59x the base days' volume (1.8x the 50-day), closing at the high. Micron reported that evening; the next day's low of 78.60 went through the 79.21 stop. | `wp.earnings_window` |
| COIN | 2024-08-23 | 209.81 | 199.95 (4.7%) | day 2 (2024-08-27, low 194.10), best 0.11R | A 41% decline, 15 of 15 closes under the 20 EMA, a 13-day base 161.13 to 209.80, a pop that closed at the high (211.40) but on 1.24x the base days' volume (1.04x the 50-day) and with a 4.7% stop. The low of 194.10 took the stop on day 2. | `wp.volume` |
| PLTR | 2025-12-10 | 184.95 | 182.70 (1.22%) | day 1 (2025-12-11, low 180.21), best 0.0R | A 29% decline, 10 of 15 closes under the 20 EMA, an 11-day base 147.56 to 183.88, a gap open at 184.95 on 1.86x the base days' volume, closing high in its range at 187.91. The next session's low (180.21) took the 182.70 stop. A valid pop that failed; the stop did its job. | `wp.stop` |
| AMZN | 2018-11-07 | 84.88 | 83.15 (2.04%) | day 3 (2018-11-12, low 81.50), best 2.5R | A 28% decline, 15 of 15 closes under the 20 EMA, a 5-day base 73.82 to 84.87, a pop closing at the high (87.77) on 1.19x the base days' volume. It reached 2.5R in two sessions and was stopped on day 3 (low 81.50) in the late-2018 selloff. Under the house plan the stop would have been at breakeven by then. | `wp.breakeven` |

**Four near-misses.** Charts that look like a wedge pop but fail exactly one gate of the card. Each came from re-running the setup's scan with that one gate relaxed and keeping only the hits the strict rule rejects for that criterion; everything else passed. The outcome is the same fixed-stop walk, for information only: a near-miss that worked is still not the setup.

| Ticker | Date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|
| DECK | 2024-05-14 | `wp.prior_decline` | 7 of the 15 closes before the pop under the 20 EMA; the rule is 8 or more | A 12-day base after an 18% dip with a 1.4x pop, but only 7 of the 15 closes before it were under the 20 EMA. A pullback inside an uptrend the stock already rides: the EMA Crossback (setup 14) or a moving-average pullback, not a pop from under the averages. Best 9.2R. |
| TSLA | 2023-11-14 | `wp.base_tight` | last 5 sessions' ranges 1.11x the 10 before; the rule is under 0.85x | A 30% decline, 14 of 15 closes under the 20 EMA, a 9-day base, but the last 5 sessions' ranges were 1.11x the 10 before them: nothing tightened. A wide, loose rebound through the averages is a remount (setup 13), not a wedge pop. Best 2.68R, stopped. |
| AMZN | 2019-01-04 | `wp.above_200` | pop closed -7.3% against the 200-day; the rule is a close above it | A 36% decline, a 6-day base and a pop on 1.1x the base's volume, but the pop closed 7.3% under the 200-day. A bear-market rally pop under the 200-day is not ours (B26). It worked (best 7.46R) without us. |
| CSCO | 2026-07-27 | `wp.volume` | pop volume 0.88x the base days and 0.83x the prior day; the rule is above both | An 18% decline, 12 of 15 closes under the 20 EMA, a 6-day tight base, a trade through the pivot and a close above both EMAs, but on 0.88x the base days' volume and 0.83x the prior day's. A cross of the averages with no demand (wp.inv_no_volume). Best 0.0R, stopped. |

**What the failures have in common.** All four pop days closed strong, at or near the high and above both averages, so nothing on the pop day's candle separated them from the winners. What did was the calendar (MU's report that night), the volume (COIN 1.24x and AMZN 1.19x the base, under the 1.5x cut that the scan found strongest) and the stop width (COIN 4.7%). Two were stopped the next session and the other two within three. The earnings check and the volume read happen before the fill; the pop day's close only confirms what the fill already risked.

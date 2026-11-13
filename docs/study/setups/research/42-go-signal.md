# Setup 42: Go Signal (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Nothing here is a ruling. Where I could not
read a source, I say so and give no wording from it.

**The short version.** The Go Signal is the owner's own setup. Patrick (TSDR) named it; no outside writer uses the name
for this pattern. His rulings (2026-10-27 and 2026-11-01) define it as an **hourly** signal: a strong stock at support
trades under the prior day's close early, then goes back above it (red to green) in the first or second hourly candle.
Its outside relatives are Larry Williams' Oops, Gil Morales' Undercut & Rally (U&R) and Wyckoff's spring. Two things
in the app disagree with him: the Model Book card, curriculum and glossary teach a different pattern under the same
name, and the scanner can only see the daily footprint. My test on about 3 years of hourly bars found **no edge in the
mechanical trigger by itself** (section 4.3). Whatever edge there is has to come from where it happens: the stock, the
level and the market.

**How the quotes were checked.** Every quote is 40 words or fewer and was copied from the page or file named next to it.
- **Checked word for word against a saved copy** (downloaded today and searched by a script): UCT's Substack (all 103
  posts in the sitemap, through Substack's post feed), Larry Williams' own site (ireallytrade.com), the Wiley front
  matter of *Long-Term Secrets to Short-Term Trading* (1999), Deepvue's knowledge base, Gil Morales' OWL Trader
  glossary, StockCharts ChartSchool's Wyckoff tutorial (also on wyckoffanalytics.com), Qullamaggie's setups page,
  Unger Academy's Oops test, and our own code and docs.
- **Not read at all:** Toby Crabel's book, Oliver Kell's book, Brian Shannon's book, Connors and Raschke's *Street
  Smarts*, Andrew Aziz's book, any TraderLion page, any investors.com page, UCT's private Discord and members' videos.
  My web-search allowance ran out early in this run (six searches worked). Every other page came from a URL I
  already knew. Section 11 lists the gaps.
- **Cold check, 9 Nov 2026 (a second reader).** Every quote above was re-opened at its source that day: all 103 Substack
  posts were downloaded again through Substack's post API and each quote found word for word in the section named
  (owner, Bracco, The Wiz, Manrav, unsigned); the eight outside pages and the Wiley PDF were downloaded again and every
  quote, page number and date found; every owner ruling was matched to `owner_verdicts.jsonl`; the scanner summary was
  read against the code, the fixtures and the shared helpers; the test tables were matched to the scripts' outputs and
  the house-rule shares and RS proxies recomputed from the trade rows. What changed is listed in section 12.
- **UCT's private Discord** appears only through the knowledge-base summaries already stored in this public repo
  (`docs/study/levels/brain_kb_*.json`, tracked since commit ca78c0aa82). Those are machine-written summaries, not
  anyone's exact words. I paraphrase them and quote none of them. Note for the owner: the repo's `CLAUDE.md` lists the
  brain DB among private material, yet those three extract files are tracked in this public repo. Whether they should
  stay public is his call; if they go, sections 3.3, 6.5 and 6.6 should lose their paraphrases too.

Tags used in section 8: **[owner ruling]** the owner's words in `docs/study/audits/2026-10-24/owner_verdicts.jsonl`;
**[UCT]** the owner, Bracco or another UCT writer in the public Substack; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[code]** our scanner or finder; **[source consensus]** several outside sources on
the family (Oops, U&R, spring) agree; **[originator]** a named originator of a family member; **[outside source]** a named outside trader's own words on a
mechanic the setup shares (not an originator of the family); **[brain template]** the firm brain's AI-built summary of
his material, not verified as his words; **[measured]** our own test
in section 4; **[my proposal]** my recommendation, for the owner to accept or change.

Terms. **PC**: the prior day's close. **PL**: the prior day's low. **Red / green**: below / above the prior close (the
quote-screen colours). **Red to green**: price goes from below the prior close to above it in the same session. **H1,
H2**: the first and second hourly candles of the session. **Session-aligned** hourly bars run 9:30-10:30, 10:30-11:30
and so on; **clock-aligned** bars run 9:30-10:00, 10:00-11:00 and so on (the first one is 30 minutes). **Reclaim**:
price trades back above a level it lost. **R**: the risk on the trade (entry minus stop). **DCR**: where the day closed
inside its range (0 = at the low, 1 = at the high). **RS**: relative strength rating. **LOD**: low of the day.

---

## 1. What it is

A Go Signal is the owner's intraday entry for a strong stock that has pulled back to support: early in the session it
trades below the prior day's close (often undercutting a nearby low, the hourly flag or the 20-day average), and buyers
push it back above the prior close in the first or second hourly candle. You buy that red-to-green turn on the hourly
chart, with the stop a few cents under the day's low.

**Why it works (the psychology).** Each point names its source. None of it is a measured fact; section 4 has the
numbers, and they say the turn alone is not enough.
- **A weak open flushes the weak holders.** Wyckoff's school describes the same move inside an advance: "Shakeouts may
  also occur once a price advance has started, with rapid downward movement intended to induce retail traders and
  investors in long positions to sell their shares to large operators." (Bogomazov and Lipsett, [StockCharts ChartSchool](https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial))
- **The crowd reads the undercut as a breakdown, and is wrong.** Gil Morales on the U&R: "The crowd will view this as
  an obvious “break of support” at which point natural sellers will be washed out and short sellers will swarm the
  stock." ([theowltrader.com glossary](https://www.theowltrader.com/glossary/))
- **The open overreacts.** Deepvue on the Oops, the daily cousin: "This indicates traders realize an overreaction to
  the news, prompting a price reversal opposite to the gap." ([docs.deepvue.com](https://docs.deepvue.com/articles/deepvue-custom-indicators-technical-patterns))
- **What the owner says he is looking for.** A turn that shows buyers and gives a line to lean on: "Preferably get a gap
  down red to green move to show presence of buyers and clear area to risk against." (APLD, [Sunday Scans, 10 Aug 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-f6f))
  And: "Ideal situation is a gap down slightly and quick red to green move tomorrow. Would give us an area to risk
  against and a presence of buyers to signal potential momentum." (CSIQ, [21 Dec 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-34b))
- **Who is trapped and who is buying** (my reasoning, not a source): holders who sold the weak first hour, and anyone
  short the break of the prior day's low or the 20-day line, must buy back once the stock is green again. Buyers who
  wanted the stock at the 20-day line get their price. The day's low becomes the line that proves the idea wrong, so the
  risk is small and clear.
- **Why location matters more than the turn.** A red-to-green turn happens in about 30% of all liquid sessions (section
  4.4). The owner's own words put the edge in the stock and the place: "My ideal stocks and broad setups are seeing that
  exact style of upside reversal on individual names at the 20EMA. It is my GO SIGNAL." ([Sunday Scans, 9 Nov 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-720))

## 2. Origin and naming

**Short answer: the owner, Patrick (TSDR), named it. The first public use I found is the Sunday Scans of 8 June 2025;
he says where the name comes from on 22 June 2025: "This would be considered a UnR (undercut and Rally), I call it a GO
SIGNAL." ([sunday-scans-0d2](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2)).** The Substack byline
says the room is "run by Patrick (TSDR), Bracco, EliteSwingTraders, & Manrav" (post API, publication byline). The
brain's template for it is titled "Go Signal (TSDR)" (`docs/superpowers/research/setups/setup_criteria.json`).

| Name | Who | Where and when (verified) | What it covers |
|---|---|---|---|
| **GO SIGNAL** | the owner (TSDR) | Substack, first public use 8 Jun 2025 (ALAB); naming line 22 Jun 2025 (above); 24 mentions (23 passages) in 19 posts through 8 Nov 2026 (section 6) | His entry: an undercut of support and a fast reclaim, read on the hourly chart |
| **GO SIGNAL** (private) | the owner | A knowledge-base summary of his Discord post dated 2024-10-19 (`brain_kb_2026-11-06.json`, row 10789) calls it a full explanation of his core GO SIGNAL entry method, which the summary says he referred to throughout his alerts, with four annotated 65-minute examples. Machine summary, not his words | The earliest dated record I found. It implies earlier use I could not see |
| **Hourly GO Signal** | the owner | AMD, [Sunday Scans, 16 Nov 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a); "an hourly GO SIGNAL around the $140 mark" (SHOP, [27 Sep 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-09b)) | The same, said outright to be hourly |
| **Red to green GO SIGNAL** | the owner | FIG, [The Rest of the Week, 15 Oct 2025](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-39d) | The version his 2026-11-01 ruling makes the key |
| **UnR / U&R (Undercut and Rally)** | the U&R of Gil Morales' OWL method; his glossary points to the book *Short-Selling with the O’Neil Disciples* for the details ([theowltrader.com](https://www.theowltrader.com/glossary/)); the owner says the Go Signal "would be considered a UnR" | OWL glossary (undated page, read today) | The daily-chart parent idea |
| **MAU&R (moving average undercut & rally)** | Morales; used by Bracco ("These all staged MAU&R’s (moving average undercut and rallies) with most closing strong on Friday.", [26 Oct 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-13e)) | OWL glossary names it as the U&R's corollary | The 20-day-line version of the U&R |
| **Oops!** | Larry Williams | His site: "NUMEROUS TRADING PATTERNS- 1981. OOPS! Fakeout, Delayed and Hidden OOPS!, Pinch and Paunch, etc." ([ireallytrade.com/innovation](https://www.ireallytrade.com/innovation/)); book chapter "Oops! This Is Not a Mistake", p. 113, *Long-Term Secrets to Short-Term Trading*, Wiley, copyright 1999 ([Wiley front matter](https://catalogimages.wiley.com/images/db/pdf/0471297224.pdf)) | The daily cousin: a gap open beyond the prior day's range that fails back through it. The owner: "GO SIGNAL is similar to the oops reversal or the UNR but is an hourly GO SIGNAL btw" (ruling, 2026-10-27) |
| **Spring / shakeout** | Richard Wyckoff's school (Bogomazov and Lipsett on StockCharts) | ChartSchool tutorial, read today | The root idea: a drop under support that reverses, a bear trap |
| **Downside go signal** | the owner, once, in passing | Ruling on QQQ 2021-12-15: "Maybe a downside go signal but who cares" | The short mirror; he did not want it |
| **Green to Red** | the journal | `app/src/constants/setupGroups.js`, Intraday group | The mirror tag exists; no rule is attached |

**Name collisions to clear up.**
- **The Model Book card, the curriculum and the Study glossary use the name for a different pattern:** "A catalyst gap
  digests into the 9 EMA, then one wide candle engulfs the pullback and closes above the catalyst high"
  (`docs/curriculum/uct_method_course.json`). That text came in on 2026-06-10 ("Go Signal redrawn as catalyst gap ->
  9-EMA digestion -> engulfing candle", commit 1391900ba5, "Per the provided write-ups"). It does not match his
  2026-10-27 and 2026-11-01 rulings (section 5.6).
- **The market version.** On 22 June 2025 the 0.7% gap down he wanted was in the index (QQQ near its 20-day line at
  $520-$523), and the Go Signal there was the market's green light to "execute on our focus list". So the owner uses the
  name for an index turn as well as for a stock. The coach's vocabulary map files "Go Signal" under market conditions
  next to FTD (`docs/agent/coach/VOCABULARY-MAP.md`). A web search in checking (9 Nov 2026) found no IBD page or book that calls a
  follow-through day a "go signal"; the only "Go / No Go" usage found was a newsletter's own alert system, not a source.
- **No outside source.** The few searches that worked found no trader, book or educator who uses "Go Signal" for this
  pattern; a second search in checking (9 Nov 2026) found none either. TradingView scripts and promotional newsletters using "go" signals are unrelated and are not sources.

## 3. Every definition, source by source

There is no outside definition of a "Go Signal". So this section has two parts: the owner's own definitions (3.1 to
3.5, the ones that decide), and the outside definitions of its family (3.6 to 3.10), which supply the logic, the stop
and the vocabulary.

### 3.1 The owner's rulings (the governing definition; `owner_verdicts.jsonl`)

In date order, his exact words, with the note the session wrote beside each.
1. **2026-10-27, first definition:** "GO SIGNAL is similar to the oops reversal or the UNR but is an hourly GO SIGNAL
   btw". He stopped grading daily charts after 4 of 45 and asked for hourly charts. Note in the log: a daily chart
   cannot show it; the daily bar is at most the footprint.
2. **2026-10-27, on the daily footprints:** "Gonna need to see the hourly but there are all most likely good 20EMA
   APULLBSCKS or UNR setups" (NVDA 2022-07-25). So the daily context is a 20-day EMA pullback or a U&R.
3. **2026-10-27, second definition:** "GO SIGNALS are supposed to be notable hourly flags that undercut a slight range
   and quickly go red to green in the first hour". Read as: a tight hourly flag after a move, an undercut of the
   flag's range, a fast red to green in the first hour.
4. **2026-10-27, scanner picks:** VEON: "Need the hourly but needs to be more higher low ish most likely" (the flag
   should come off a higher low). VGZ: "Prob a few days earlier not that day". VST: "Ya possibly but would need full
   chart but also might just be an oops vs a real like GO SIGNAL". GIC: "Maybe but not a stock I would trade".
5. **2026-10-31, the pivot boundary:** MSFT 2022-07-14, whose first hour undercut the flag low but did not go red to
   green and then worked higher later: "Eh so this is more of a pivot vs go signal btw". So a late turn is a pivot (setup
   41, the 30-minute pivot), not a Go Signal.
6. **2026-10-31, chart rule:** "Wait stop I need to see the mkt open of the days we are looking at". The first hourly
   candles of the session must be visible and marked.
7. **2026-11-01, the key:** "None of these are really go signals, the first hourly candle should go green to red and
   take out previous day close, for the most part". Then: "I need a go signal to go red to green in the first or
   second hourly candle essentially."

What the rulings settle: it is hourly; it lives at support in a stock that has moved; the first hour must trade below
the prior close; the turn back above the prior close comes in the first or second hourly candle; a later turn is a
pivot. What they leave open: whether the open must be above the prior close first ("go green to red"), which hourly
bars, close or touch, which levels count, and how tight the flag must be (questions in section 10).

### 3.2 The owner in public (Substack, his sections; full quotes in section 6)

What the 24 Substack mentions add to the rulings:
- **Trigger shape:** "Ideal scenario for next week is a gap down of 0.7% or more that gets bought up. There is nothing
  I like more than a gap down reversal to give me signal." (22 Jun 2025, about QQQ.) Also "dip under the MAs and the
  $6.50 level with a fierce reclaim" (NVTS, 29 Jun 2025) and "The dip into bullish gap support and quick reclaim. This
  is a GO SIGNAL." (META, 14 Sep 2025.)
- **Confirmation timing:** "If we see buying activity and opening ranges being taken out or strong hourly candles
  forming after the first 30 min then we can execute on our focus list." (22 Jun 2025.)
- **Location:** the 20-day EMA most of all ("I am mostly a 20EMA kind of guy."; ALAB, CRS, BTU, INTU), also the 9 EMA
  (SOLS: "Ideally let the hourly build out and we get a go signal and tap of the 9ema."), bullish gap support (META),
  an HVC (TEM: "$61.25 the HVC. Keep an eye on the hourly for a GO SIGNAL."), a base top (ASML), a level (RDDT $141).
- **Prior trend:** "Especially in a strong trend that is pulling back to a key area or moving average." (22 Jun 2025.)
- **Size:** "Any sort of GO SIGNAL would allow me entry with immediate full size." (ALAB, 8 Jun 2025.)
- **Stop:** the day's low ("with a stop at LOD (Low Of Day)", 22 Jun 2025; "with LOD stop", REGN, 8 Nov 2026).
- **Follow-through:** "gave a GO SIGNAL on Thursday of last week with follow through on Friday" (ZS); "GO SIGNAL on
  Wednesday followed by inside day Thursday" (ASML).

### 3.3 The owner's private explanation (knowledge-base summary, paraphrased; not his words)

Row 10789 of `docs/study/levels/brain_kb_2026-11-06.json`, a machine summary of a Discord post dated 2024-10-19, lists
three parts: (1) a stock at an interesting location after a notable prior move; (2) a weak open that sweeps a nearby
support, range or moving average; (3) buyers stepping in to leave a lower wick, often red to green. It says four
annotated 65-minute examples came with it; one is MSTR, where on 2024-10-17 a bar undercut $190 support and the daily
9 EMA, then broke out the next day. The summary breaks off mid-sentence in a note about the day's low. Our scanner's
three gates (location, a weak open that sweeps support, buyers stepping in) follow this summary closely (section 5.1).
Other rows (paraphrased; these sit in `brain_kb_rules_2026-11-06.json`, rows 10117 and 12473 also in
`brain_kb_cycle_2026-11-06.json`): a desk log of 2025-06-17 calls a SNOW hourly day a possible Go Signal with red to green and
new highs the next day as confirmation (row 10117); a desk log of 2025-11-29 on CRS wants an hourly undercut and a Go
Signal in a price zone, then a trail on the 20 EMA (row 10252); a desk log of 2025-02-03 says CPNG held a support zone
and gave a Go Signal (row 10004). These desk logs look like his own Discord text, which is private, so I do not quote them.

### 3.4 The brain's "Go Signal (TSDR)" template (as quoted in our repo)

`docs/superpowers/research/setups/setup_criteria.json` quotes the firm brain's template (an AI-built summary of his
material, not his own writing; the 0.7% line matches his 22 Jun 2025 post word for word):
- Trigger: "Dip under key moving average (20 EMA) or key price level followed by a fierce reclaim - the Undercut and
  Rally (UnR)".
- Ideal trigger: "Gap down of 0.7% or more that gets bought up is an ideal GO SIGNAL trigger."
- Confirmation: "Wait for first 30 minutes before confirming hourly candle strength."
- Invalidation: "Close below the reclaimed level or moving average (20 EMA) negates the GO SIGNAL."
I could not find the invalidation line in his public posts, so it is the template's, not verified as his.

### 3.5 The other in-house definition (Model Book card, curriculum, glossary)

"A catalyst gap digests into the 9 EMA, then one wide candle engulfs the pullback and closes above the catalyst high"
(`docs/curriculum/uct_method_course.json`, lesson "Go Signal: The Catalyst Gap That Digests into the 9 EMA, Then
Engulfs"). The screener's structure library built a daily detector from it and says so: "Ours, not a published
pattern." (`api/services/screener/base_catalog.py`). It is a different setup: a daily multi-day pattern with a gap, a
pullback and an engulfing day. It has no undercut of the prior close and no hourly turn. Section 5.6 shows where it
still lives.

### 3.6 Larry Williams, Oops! (originator of the daily cousin)

- Origin, his own site: "NUMEROUS TRADING PATTERNS- 1981. OOPS! Fakeout, Delayed and Hidden OOPS!, Pinch and Paunch,
  etc." ([ireallytrade.com/innovation](https://www.ireallytrade.com/innovation/))
- Book: *Long-Term Secrets to Short-Term Trading* (Wiley, copyright 1999, ISBN 0-471-29722-4), Chapter 7 "Patterns to
  Profit" (p. 93), sections "Oops! This Is Not a Mistake" (p. 113) and "S&P Oops! Trading" (p. 119), per the publisher's
  front matter. I did not read the chapter, so I quote no rule from it.
- The rule as a tester restates it (Unger Academy, a systematic-trading school): "The long setup, shown on the left,
  requires that the current session opens with a gap down. This means the open must be lower than the previous
  session’s low" and the entry comes when prices "rise to reach the previous day’s low". ([ungeracademy.com](https://ungeracademy.com/blog/we-tested-larry-williams-oops-pattern-the-results-might-surprise-you))
- **Against the Go Signal:** Williams' level is the prior day's **low**, his open must gap **below** it, and the
  timeframe is the day. The owner's level is the prior day's **close**, the open can be anywhere, and the timeframe is
  the first two hours. The owner's scanner version of the Oops (setup 30) also uses the prior close.

### 3.7 Deepvue knowledge base (charting service, educator)

"The Oops Reversal is triggered when the opening gap down is being bought up and passes the prior day’s low."
([docs.deepvue.com](https://docs.deepvue.com/articles/deepvue-custom-indicators-technical-patterns)) The same page
gives the Upside Reversal: "Upside reversals suggest that buyers are beginning to dominate sellers, which may lead to an
increase in price." No timeframe, no stop, no location. The page dates the pattern to 1979 ("In 1979, Larry Williams
introduced the Oops Reversal trading method"); Williams' own site says 1981 (section 3.6). The originator's date is used
here.

### 3.8 Gil Morales, U&R and MAU&R (the OWL method's terms, which the owner cites)

- Entry and stop logic: "Once the stock undercuts a prior low in the pattern and rallies back above it, a long entry is
  generated at the prior low which is then used as a selling guide." ([theowltrader.com/glossary](https://www.theowltrader.com/glossary/))
- Volume: "Volume is generally not a factor".
- The moving-average form: "Its corollary, the moving average undercut & rally (MAU&R)", named but not defined on that
  page.
- Root: the U&R "is based on Wyckoff’s spring formation" and replaces "arbitrary and imprecise" point rules.
- **Against the Go Signal:** Morales' level is a prior low in the pattern (or an average), on the daily chart, and his
  sell guide is that level. The owner's level is the prior close, on the hourly chart, and his stop is the day's low,
  which sits below the reclaimed level and so is wider.

### 3.9 The Wyckoff spring and shakeout (the root; Bogomazov and Lipsett, StockCharts ChartSchool)

- "A “spring” takes price below the low of the TR and then reverses to close within the TR" (TR = trading range).
- Inside an advance: the shakeout quote in section 1.
- The test that follows: "a successful test (indicating that further price increases will follow) typically makes a
  higher low on lesser volume". This matches the owner's "higher low" remarks (VEON ruling; YOU and FLNC posts).
- Volume: a low-volume spring is the better one ("A low-volume spring (or a low-volume test of a shakeout) indicates that
  the stock is likely to be ready to move up"). The same text, unsigned there, is on [wyckoffanalytics.com](https://www.wyckoffanalytics.com/wyckoff-method/).

### 3.10 Kristjan Kullamägi (Qullamaggie): the intraday entry and the day-low stop

Not a Go Signal source; read for the entry mechanics he shares with the owner. From his post "3 TIMELESS setups that
have made me TENS OF MILLIONS!" (posted 8 Jan 2021, updated 28 Apr 2021, [qullamaggie.com](https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/)):
- On hourly bars: "(on the 60-minute timeframe the first candle is always only 30 minutes, 9.30-10 AM)". This is the
  clock-aligned hourly chart. The vendor bars on our review screen are built the same way (section 4.5).
- Stop: "Stop is always lows of the day and stop should not be wider than the ATR or ADR of the stock".
- Trail: "Trail your stop with the 10- or 20-day moving average once they surpass your initial stop."

### 3.11 Not found or not read

- **Red to green as a named strategy.** Search results point to Andrew Aziz's *How to Day Trade for a Living* and to
  retail blogs. I could not read the book; the blogs are not sources. Setup 43 (Red to Green) covers this.
- **Toby Crabel's opening range** (the root of "opening ranges being taken out"): not read; setup 40 covers it.
- **Oliver Kell's cycle of price action**, which the owner says he applies to hourly charts (section 6.4): not read for
  this dossier; setup 18 covers Kell.
- **Brian Shannon on multiple timeframes and 65-minute charts:** not read (search ran out).
- **Connors and Raschke's Turtle Soup and 80-20s** (mechanical failed-low reversals): not read.

### 3.12 The criteria side by side

| | Owner rulings (3.1) | Owner Substack (3.2) | KB summary (3.3) | Brain template (3.4) | Model Book card (3.5) | Williams Oops (3.6) | Morales U&R (3.8) | Wyckoff spring (3.9) |
|---|---|---|---|---|---|---|---|---|
| Timeframe | hourly | hourly/65-min with the daily | 65-minute examples | first 30 min, then hourly | daily | daily | daily (weekly too) | any |
| Prior trend | a move; "notable" flag | "strong trend" | notable prior move | not stated | a catalyst gap | not stated | a decline into the low | a trading range or an advance |
| Location | a slight hourly range; daily 20-EMA pullback or U&R | 20 EMA mostly; 9 EMA, gap, HVC, base top, level | near-term support, range or MA | 20 EMA or a key level | the 9 EMA | prior day's low | a prior low or an average | the range's low |
| Shape before | hourly flag, higher low | flag, tight, inside days | not stated | not stated | pullback after a gap | none | a low to undercut | a range |
| Trigger | first hour trades under PC, back above PC in candle 1 or 2 | gap down (0.7%+) or dip, bought; fierce reclaim | weak open sweeps support, lower wick, often red to green | dip under, fierce reclaim | wide candle engulfs the pullback, closes over the gap high | open below PL, trades back to PL | undercut a prior low, rally back above it | drop under support, close back in the range |
| Entry | not stated | as the red-to-green spot or opening range is reclaimed; strong hourly candle after 30 min | not stated | after the first 30 minutes | the close (detector) | at PL | at the prior low | on the spring or its test |
| Stop | not stated | the day's low | the day's low (summary cut off) | not stated | under the digestion low (curriculum) | not stated by the tester | the prior low as a sell guide | not stated |
| Volume | not stated | not stated | not stated | not stated | not stated | none | "not a factor" | low volume is better |
| Targets | not stated | prior highs, levels | not stated | not stated | not stated | first profitable open (tester) | not stated | not stated |

### 3.13 Where the sources disagree

1. **Which level is reclaimed.** Prior close (owner 2026-11-01, red to green) vs the hourly flag low (owner 2026-10-27,
   our hourly finder) vs the prior day's low (Williams, Deepvue) vs a prior low or average (Morales) vs nothing at all
   (the Model Book card).
2. **The open.** "The first hourly candle should go green to red" (2026-11-01) implies the open is above the prior
   close; the Substack's "gap down of 0.7% or more that gets bought up" puts it below. Our scanner demands an open below
   the prior close. Williams demands an open below the prior low.
3. **Timing.** "In the first hour" (2026-10-27) vs "in the first or second hourly candle" (2026-11-01) vs "after the
   first 30 min" (22 Jun 2025, the brain template). On clock-aligned bars the first candle is only 30 minutes, so the
   second candle ends at 11:00; on session-aligned bars it ends at 11:30; on 65-minute bars at 11:40.
4. **Close or touch.** His public META example (12 Sep 2025) traded back above the prior close in the second hour but
   first closed above it in the third (section 4.5).
5. **Timeframe.** Hourly (the owner) vs daily (Williams, Morales, the scanner, the Model Book card).
6. **Stop.** The day's low (owner, Qullamaggie) vs the reclaimed level (Morales). The day's low is wider.
7. **The pattern itself.** The Model Book card describes a different setup (section 3.5).

## 4. Measured evidence

### 4.1 Published statistics

**None for the Go Signal.** No outside writer uses the name, so nobody has measured it. For the family:
- **Unger Academy, Oops on DAX futures, 2010 to the page's present** ([ungeracademy.com](https://ungeracademy.com/blog/we-tested-larry-williams-oops-pattern-the-results-might-surprise-you),
  undated; its text calls 2023 and 2024 past years, so 2025 or later). Williams' rules (open beyond the prior day's
  extreme, enter back at that extreme), a €2,000 money stop, out at the first profitable open. Results as the page
  states them: total net profit about €163,000, maximum drawdown about €45,000, average trade €230; with a 15-point
  minimum gap, €146,000, €38,000 and €400. The page says the long side was "clearly more effective" and that the pattern
  lost money in 2023, 2024 and the current year: "starting from a certain point in time, it began to lose the
  effectiveness it once had". **Limits:** one futures market, daily bars, the prior-low version, no stock data, no hourly
  turn, a test by a school that sells courses. It does not test the Go Signal.
- I found no Bulkowski (thepatternsite.com) page for an undercut-and-reclaim day or a red-to-green day, and no
  published test of an hourly red-to-green in stocks. The search budget ran out before I could look further.

### 4.2 Numbers in our own repo that are not performance statistics

- **"go signal 92% precision"** (commit 8c7ba47b99, 2026-10-15; `registry.py` says "86-92% precision" for the set). This
  is how often blind judges (fresh AI agents, per the commit) agreed that a **daily footprint** looked like the setup. It
  says nothing about profit, and the owner later ruled that a daily chart cannot show the setup at all.
- **"go signal 2.90"** in `api/services/pattern_engine/tag_textbook.py`: a judged score for the member setup tag (pass
  mark 2.4). Recognition again, not results.
- **0.35% coverage** in `api/services/screener/base_catalog.py`: how often the *other* Go Signal (the Model Book card's
  gap, 9 EMA and engulf pattern) fires on daily bars (12 of 3,461 tickers on 2026-08-31).
- **6 of 40** in `owner_verdicts.jsonl` (2026-10-30 note): on the hourly finder's strict reading (first-hour undercut of
  a 2-5 session flag low, first-hour close above its open), only 6 of 40 drafted sessions fired.

### 4.3 Our own test (new, for this dossier)

**Question.** Does the owner's key, as ruled on 2026-11-01, give an edge by itself, and do the house filters help?

**Data.** Hourly bars from Yahoo (regular hours, session-aligned: 9:30, 10:30 ... 15:30) for the 1,000 most-traded
names today, 2023-12-12 to 2026-11-06; daily bars from the app's local test database. 968 names had enough history.
Read-only; nothing in the repo or on the pod was touched. Scripts and outputs are in my scratch folder
(`tools/measure.py`, `summary.txt`).

**Rules tested.**
- Liquidity (B23): prior close $10 or more and $20 million or more traded a day (50-day average).
- **Signal:** the first hourly candle trades below the prior close, and an hourly candle closes back above the prior
  close. *By hour 2* means that close comes in the first or second hourly candle.
- **Context:** above the 200-day SMA (B26), the 20-day EMA rising over 5 sessions, and our scanner's "notable move" test
  (a 13% gain over 5 sessions within the last 20, a 4% gap on 2x volume within 30, or a tight 10-day base above the
  50-day).
- **Entry:** the close of the hourly candle that reclaims the prior close, a market order (E57). **Stop:** 3 cents under
  the session's low so far (F62).
- **Reach:** the highest R reached before the original stop, over 20 sessions. **House plan:** stop to breakeven at 2R
  (B19), a third off at 3R (B19), a third at 5R (E51), the rest out on a daily close under the 10-day EMA once that EMA
  is above the stop (E52), out at the 10th session's close if still under 1R (C33), out at the open on a gap through the
  stop, 60 sessions at most.
- **RS:** a 12-month weighted return (latest quarter counted double) ranked inside this universe each day. A proxy, not
  IBD's rating. **Market:** QQQ above its 50-day SMA, a proxy for the app's market reading (B18).
- **Baseline:** the same context, but buy the first hourly close (10:30) every session, stop 3 cents under the first
  hour's low, no reclaim needed.

**Results.** *Stopped day 0* = the stop was hit the same session. *House R* = the average result of the house plan, in R
(se = standard error).

| Group | Trades | Names | Median stop | Stopped day 0 | Reached 1R | 3R | 5R | House R (se) | Winners |
|---|---|---|---|---|---|---|---|---|---|
| Any liquid session, red to green by hour 2, no context | 227,559 | 968 | 1.17% | 26.9% | 48.4% | 25.9% | 17.0% | +0.003 (0.005) | 27.4% |
| **Context, by hour 2** | 41,577 | 958 | 1.37% | 26.9% | 48.1% | 25.5% | 16.5% | +0.007 (0.011) | 25.2% |
| ... red to green in hour 1 | 34,182 | 955 | 1.35% | 29.0% | 47.9% | 25.4% | 16.3% | +0.002 (0.012) | 24.8% |
| ... red to green in hour 2 | 7,395 | 923 | 1.46% | 17.2% | 49.0% | 26.3% | 17.5% | +0.030 (0.026) | 26.8% |
| Context, red to green in hour 3 or later | 10,655 | 942 | 1.75% | 4.9% | 48.3% | 26.1% | 16.4% | +0.045 (0.020) | 27.6% |
| Context + low within 1% of the 20-day EMA or under it | 12,347 | 949 | 1.28% | 24.3% | 48.6% | 25.7% | 16.4% | +0.001 (0.018) | 27.5% |
| Context + swept the prior day's low | 10,929 | 941 | 1.75% | 18.3% | 48.7% | 25.2% | 15.6% | +0.005 (0.019) | 27.2% |
| Context + RS 80+ | 19,065 | 717 | 1.78% | 26.8% | 48.8% | 25.7% | 16.7% | +0.017 (0.016) | 25.3% |
| Context + RS 80+ + C29 + A13 | 12,760 | 705 | 1.38% | 31.5% | 47.9% | 25.6% | 16.8% | -0.022 (0.020) | 24.4% |
| ... same, market proxy up | 10,075 | 647 | 1.34% | 31.7% | 48.1% | 25.6% | 17.1% | -0.008 (0.022) | 24.3% |
| ... same, market proxy down | 2,685 | 558 | 1.50% | 30.9% | 47.4% | 25.5% | 15.9% | -0.075 (0.041) | 24.7% |
| Strict: RS 90+, above 50-day, low -3% to +2% of the 20-day EMA, C29, A13 | 1,465 | 326 | 1.60% | 32.8% | 46.9% | 24.8% | 16.2% | -0.030 (0.056) | 24.9% |
| Strict + swept the prior day's low | 495 | 240 | 1.78% | 25.9% | 48.3% | 27.1% | 17.6% | -0.037 (0.090) | 27.3% |
| Strict + gap down 0.7% or more | 200 | 140 | 2.22% | 16.5% | 46.0% | 22.5% | 16.0% | -0.057 (0.144) | 25.0% |
| **Baseline:** context, buy 10:30 every session | 117,096 | 962 | 0.87% | 46.4% | 43.8% | 24.4% | 16.7% | -0.009 (0.016) | 22.5% |
| Baseline + RS 80+ + C29 + A13 | 41,419 | 756 | 0.90% | 51.3% | 43.0% | 24.5% | 17.3% | -0.020 (0.022) | 21.9% |
| Baseline, strict filters | 5,179 | 396 | 1.02% | 53.2% | 42.0% | 23.4% | 17.0% | -0.056 (0.038) | 21.9% |

**The open (context, red to green by hour 2).** This is the open question in section 10.

| How the session opened | Trades | Median stop | Stopped day 0 | Reached 3R | House R (se) |
|---|---|---|---|---|---|
| At or above the prior close, then dipped through it ("green to red", the 2026-11-01 wording) | 22,476 | 1.15% | 33.2% | 25.1% | -0.025 (0.015) |
| Below the prior close (any gap down) | 19,101 | 1.65% | 19.6% | 26.1% | +0.045 (0.016) |
| Gap down 0.7% or more (the 22 Jun 2025 Substack line) | 5,660 | 2.73% | 12.9% | 26.1% | +0.085 (0.028) |
| Gap down 2% or more | 1,038 | 4.91% | 7.0% | 25.1% | +0.118 (0.057) |

**By year** (context + RS 80+ + C29 + A13): 2024 +0.050R (n 4,738), 2025 -0.015R (n 4,404), 2026 -0.103R (n 3,320).
December 2023 alone: -0.371R (n 298).

**How the day closed** (context, by hour 2; known only after the fact). Signals whose day closed in the top 40% of its
range, without being stopped: +0.685R (n 20,356; 41.3% reached 3R). Bottom 40%: -0.540R (n 4,329). 9.9% of signals
closed back under the prior close without hitting the stop; they averaged -0.471R. Selling those at the close, when the day
closes back under the prior close, changed nothing (+0.004R against +0.007R).

**House-rule shares** (context, by hour 2): entry more than 4% above the prior close (C28) 2.2%; entry more than 10%
above the 10-day SMA (C29) 11.3%; stop more than 3% (A13) 14.3%; RS proxy 80+ 45.9%; swept the prior day's low 26.3%;
opened below the prior close 45.9%; gapped down 0.7% or more 13.6%.

**What it says.**
1. **The trigger alone has no edge.** Every group averages about zero R, within two standard errors, and so does simply
   buying 10:30 in the same context. About a quarter of trades reach 3R and about one in six reach 5R either way.
2. **What the reclaim does buy:** fewer same-day stop-outs (27% against 46% for the 10:30 buy), because the stop is the
   session's low and the weakest days never reclaim. It does not change the average result.
3. **The house filters did not help on average** (RS 80+, C29, A13, the 20-day EMA, the prior-low sweep, the market
   proxy). The filters the owner uses by eye (the flag, the catalyst, the group, the market reading) were not tested.
4. **Gap-down opens did a little better than "green to red" opens** (+0.085R against -0.025R; the gap-down number is
   about three standard errors above zero). This agrees with his 22 Jun 2025 line, but it is one cut of many, in one
   bull-market sample, not tested out of sample. A hint, not proof.
5. **"First or second hour" did not beat later turns** (+0.007R against +0.045R). The two-hour limit is a definition
   (what he calls a Go Signal), not something this data shows to be better.
6. **The day's close sorts the winners after the fact.** A Go Signal that holds into a strong close is usually working;
   one that closes weak is usually failing. That is a reason to watch the close, not a way to enter.

**Limits.** Survivorship: these are today's most-traded names, so the losers that left the list are missing. Three years,
mostly a bull market. Yahoo hourly bars can miss the opening print (BIDU on 2025-12-29: the first hourly bar opened at
$123.00; the daily open was $121.63), so some stops are tighter than real. Session-aligned bars, not the clock-aligned
bars the owner reviewed (section 4.4 sizes the difference). No hourly flag, catalyst, earnings or group test. No costs or
slippage. Trades overlap, so the standard errors are too small. The house plan is approximated (B20's 30-minute rule
not modelled). RS and market are proxies. Inside an hourly bar that holds both the stop and a target, the stop was
assumed first.

### 4.4 Does the choice of hourly bar matter?

5-minute bars, the last 60 trading days (2026-08-17 to 2026-11-06), 58,430 liquid sessions (`tools/bucket_check.py`).
Share of sessions where the first bar trades below the prior close and a bar closes back above it by the end of the
second bar:

| Bars | Second bar ends | Close back above by bar 2 | Any trade back above by bar 2 |
|---|---|---|---|
| Session-aligned 60-minute (9:30-10:30, 10:30-11:30) | 11:30 | 31.8% | 49.6% |
| Clock-aligned 60-minute (9:30-10:00, 10:00-11:00) | 11:00 | 30.5% | 45.7% |
| 65-minute (9:30-10:35, 10:35-11:40) | 11:40 | 31.9% | 50.2% |
| 30-minute (9:30-10:00, 10:00-10:30) | 10:30 | 29.3% | 44.1% |

All four agree on 85.4% of sessions and disagree on 14.6%. Two lessons: (1) the bare key fires on about a third of all
liquid sessions, so the setup has to be defined by where it happens; (2) the chart setting changes the answer in about
one session in seven, so the course must name the bars.

### 4.5 The owner's own examples, checked against the bars

**(a) The Go Signals he named in public, and two from the knowledge base.** Hour = the hourly candle (session-aligned,
our bars) whose close first went back above the prior close after trading below it. "Best" = highest high in the next
20 sessions against the signal day's close. "Low held" = the signal day's low was not broken in those 20 sessions.

| Example | Source | Hour | The day on the daily chart | Best | Low held |
|---|---|---|---|---|---|
| ASML 2025-07-02 | Substack 6 Jul 2025 | 2 | gap -1.8%, under the prior low, low 0.6% under the 20-day EMA, DCR 0.97 | +3.4% | no |
| META 2025-09-12 | Substack 14 Sep 2025 | **3** (traded above in hour 2, closed below) | gap -0.3%, under the prior low, low 1.0% under the 20-day EMA, DCR 0.86 | +4.7% | no |
| ZETA 2025-09-11 | Substack 14 Sep 2025 | 1 | open -0.5%, under the prior low, low 0.7% under the 20-day EMA, closed +10.1% | +6.9% | yes |
| ZS 2025-09-25 | The Rest of the Week, 1 Oct 2025 | 2 | gap -1.0%, under the prior low, low 1.4% under the 20-day EMA | +11.6% | yes |
| AMD 2025-11-12 ("Hourly GO Signal on Wed") | Substack 16 Nov 2025 | **none**: gapped up 6.6% and never traded below the prior close | analyst-day gap | +0.3% | no |
| BIDU 2025-12-29 | Substack 4 Jan 2026 | 1 | gap -2.5%, under the prior low, low 0.9% under the 20-day EMA | +30.4% | yes |
| AMD 2025-12-29 | Substack 4 Jan 2026 | **5** | gap -1.6%, under the prior low; below the 50-day, 20-day EMA not rising | +23.8% | no |
| RDDT 2025-07-18 | Substack 20 Jul 2025 | no hourly bars | flat open, under the prior low, low 2.8% under the 20-day EMA, closed +4.0%, DCR 0.92 | +67.3% | yes |
| MSTR 2024-10-17 | KB row 10789 (his 65-minute example) | 2 | open -0.7%, under the prior low, 5.3% above the 20-day EMA (the 9 EMA area) | +98.2% | yes |
| CPNG 2025-02-03 | KB row 10004 | 2 | gap -2.3%, under the prior low (daily history in our database too short for averages) | +9.4% | no |

Six of the nine with hourly bars went back above the prior close (on an hourly close) in the first or second hourly
candle. META (his
"Study this Friday candle") needed the third on these bars. AMD on 2025-11-12 cannot be a prior-close Go Signal at all,
so his "hourly GO Signal" there must refer to an hourly undercut of some other level (the post names "the hourly low of
$235" and a "$248-$250 zone"). This is the clearest sign that the word covers more than the 2026-11-01 key.

**(b) The daily footprints he graded on 2026-10-27/28, on the vendor hourly bars he reviewed.** The bars in
`docs/study/setups/go_signal_hourly_bars.json` are clock-aligned (the first bar is 9:30-10:00). Bar = the first bar whose
close went back above the prior close.

| His grade | Back above by bar 2 (11:00) | Later or never |
|---|---|---|
| great | DOCN 2026-04-27 (bar 2) | MSFT 2022-11-17 (bar 3), MU 2024-03-19 (bar 4), ONON 2024-09-11 (bar 5) |
| good | AAPL 2022-09-01 (bar 1), MSFT 2022-11-22 (bar 2; opened +0.6% then dipped through), CCI 2021-11-15 (bar 2), DASH 2024-11-04 (bar 2) | COLM 2024-02-02 (never; gap -9.9%), SNOW 2022-03-24 (4), ANET 2022-02-16 (6), SMH 2026-04-15 (7), RKLB 2026-01-05 (5), HL 2025-11-21 (3), PHM 2023-11-30 (7), MDB 2023-06-01 (7), SOFI 2025-06-23 (5), TSLA 2023-05-31 (7) |
| good, no follow-through | INTC 2022-01-14 (bar 1) | ZM 2023-02-14 (6) |
| okay | CELH 2024-01-02 (bar 2) | AMZN 2022-08-18 (3), AAPL 2022-08-24 (3), TEAM 2024-11-05 (5) |
| hourly cuts (2026-11-01) | VGZ 2026-10-16 (bar 1; a $2.70 stock) | VST 2026-10-16 (never), MSFT 2022-07-14 (5; "more of a pivot") |

Of the 18 footprints he graded great or good, 5 turn green by the second clock-aligned bar. He graded them on daily
charts before his hourly key existed, so this is not a contradiction, but most of the current bank will not survive the
key as worded. SOFI 2025-06-23 shows the bar problem: on our session-aligned bars its first hour closed back above the
prior close ($15.21 against $15.20); on the clock-aligned bars he saw, it did not until 13:00.

### 4.6 Candidate model examples (for his review; bar facts, not rulings)

The owner asked for 10 examples per setup. These meet his 2026-11-01 key on our session-aligned bars, sit above the
50-day and 200-day with a rising 20-day EMA, and worked (his MUST WORK rule). Numbers are from the scripts above.

| # | Example | Why it is here | Gap | Hour | Low vs 20-day EMA | Stop | Best in 20 sessions |
|---|---|---|---|---|---|---|---|
| 1 | BIDU 2025-12-29 | his own call | -2.5% | 1 | -0.9% | 1.7% (on Yahoo's hourly low) | +30.4% |
| 2 | ZS 2025-09-25 | his own call | -1.0% | 2 | -1.4% | 1.9% | +11.6% |
| 3 | ZETA 2025-09-11 | his own call | -0.5% | 1 | -0.7% | 6.0% (A13 problem) | +6.9% |
| 4 | MSTR 2024-10-17 | his 65-minute example (KB) | -0.7% | 2 | +5.3% | 6.1% (A13 problem) | +98.2% |
| 5 | DOCN 2026-04-27 | his "great" footprint | -0.2% | 1 (bar 2 clock-aligned) | +4.3% | 5.4% (A13 problem) | +67.8% |
| 6 | DASH 2024-11-04 | graded good: "Decent example but some nuance" | -0.4% | 1 (bar 2 clock-aligned) | +1.2% | 2.0% | +15.3% |
| 7 | NVDA 2024-10-02 | scan, strict filters | -0.5% | 1 | -2.5% | 2.7% | +21.5% |
| 8 | NTNX 2024-01-05 | scan, strict filters | -0.7% | 1 | -2.5% | 1.9% | +28.5% |
| 9 | CLS 2024-05-14 | scan, strict filters | -0.6% | 1 | +1.3% | 1.9% | +27.2% |
| 10 | NET 2025-06-13 | scan, strict filters | -2.2% | 2 | +1.3% | 2.3% | +15.1% |

Alternates from the same scan: GH 2025-10-14, TPL 2024-10-01, COHR 2024-02-28, URI 2024-02-21, AMAT 2026-05-04.
Failures to teach (same rules, stopped the same day): TWLO 2026-10-14 (back above in hour 1, then closed at the low of
the day, -3.7%) and SITM 2026-10-08 (gap -1.9%, back above in hour 1, closed -3.0%). Two of his own that did little:
ASML 2025-07-02 and CELH 2024-01-02 (his words: "Okay but not much follow through"). Before any of these becomes a
lesson, each needs his grade on his own chart settings (section 10).

## 5. Our app

### 5.1 The scanner: `api/services/pattern_engine/detectors/uct/uct_go_signal.py` (pattern `uct_go_signal`)

It reads the **daily footprint only**; its docstring says the real trigger is on the 30 or 65-minute chart. It fires on
session i when all of these hold:
- **G0** the 20-day EMA is above its value 5 sessions earlier.
- **G1 location**, one of: a close-to-close gain of 13% or more over 5 sessions, ending within the last 20; or an open
  4% or more above the prior close on 2x the 50-day average volume within the last 30 sessions; or a 10-bar range of
  2.5 ATR or less with the prior close above the 50-day SMA.
- **G2** the open is below the prior close.
- **G3 sweep**, one of: the low under the prior low; under the 5-bar low; or under the 9 EMA, 20 EMA or 50 SMA when the
  prior close was above that average.
- **G4 buyers:** a lower wick of 40% or more of the range, or the low under the open with the close in the upper half.
- **G6** the close in the upper 40% of the range.
- Variants: `red_to_green` (also closes above the prior close) and `daily_proxy` (does not have to). A "no_location"
  label (the same shape without G1) is stored, not fired. The bearish mirror is not fired.
- **Entry:** the prior close if the session traded through it from below, otherwise the close. **Stop:** the session low,
  exactly (`make_levels` moves it 0.5% under the entry only when the low is not below the entry). **Targets:** 2R and 3R (`make_levels` in `uct_setups_common.py`).
- **Firing:** the newest of the last 3 sessions that qualifies and has not been stopped out since; confidence =
  0.40 geometry + 0.25 volume + 0.20 context + 0.15 history, at least 50. Geometry starts at 70 and adds points for red
  to green, a volume gap, a 40% wick and two levels swept.
- **Liquidity:** `liquidity_floor` with its defaults: price $2 or more and a 20-bar average of $10,000 a day or more.
- **Status:** internal (admin-only), in `registry.INTERNAL_PATTERN_IDS`; also in the team setup-tag set.

### 5.2 Where the scanner disagrees with the owner, the house rules or itself

1. **It cannot see the trigger.** The owner's key happens by the second hourly candle; the scanner needs the day's
   close (G6), so it fires after the fact. It cannot tell a Go Signal from a pivot that turned green at 14:00 (his
   2026-10-31 boundary).
2. **It demands an open below the prior close (G2).** His 2026-11-01 wording, "the first hourly candle should go green
   to red", describes an open above it. His MSFT 2022-11-22 ("Keep, good") and AAPL 2022-08-24 ("Keep, okay") are this
   scanner's **negative** test fixtures `neg_opened_above_*` (`tests/fixtures/uct_go_signal/`).
3. **Its rising-EMA gate cut one of his "good" charts:** AAPL 2022-09-01 is the negative fixture `neg_ema20_falling_AAPL_20220901`.
4. **Two of its positive fixtures are charts he cut:** `pos_5_META_20220809` ("Cut", downtrend under every average) and
   `pos_6_GOOGL_20221116` ("Cut").
5. **No 200-day gate (B26 is a hard rule).** `pos_2_MSFT_20221117` closed at $241.68 with the 200-day near $268 ($267.91 on our daily database; the fixture
   itself holds only 130 bars, so the scanner could not read a 200-day line from it even if it tried).
6. **It does not require red to green.** The `daily_proxy` variant fires without a close above the prior close; his
   2026-11-01 key requires the turn.
7. **The liquidity floor is far below B23** ($2 and $10,000 a day against $10 and $20 million).
8. **The stop sits exactly on the low,** not a few cents under (F62). **The targets are 2R and 3R,** not the house
   3R and 5R (B19, E51).
9. **The narrative makes claims no source supports,** for example "the strongest ones move away from the swept low
   within a day or two and never look back at it". Section 4.3 found no way to see that in advance.
10. **"92% precision"** is recognition of daily footprints by AI judges, not results (section 4.2).

### 5.3 The hourly finder and overlay (Study)

- `scripts/study/find_go_signal_hourly.py` reads the 2026-10-27 ruling: a flag of the tightest 2-5 sessions (range 10%
  or less) after an advance of 8% or more; the first hour undercuts the flag low; its "red to green" is the first hour's
  close above its own open and above the flag low (a candle colour, not the prior close). It does not test the
  2026-11-01 key; the verdict log says the redo is pending.
- `app/src/pages/study/goSignalOverlay.js` draws the flag low (gold, labelled) and the flag high (faint). The owner's
  chart rules (the first three hourly candles marked, colours visible) were built in PR #559.
- `scripts/study/find_go_signal_examples.py` (daily pass) uses the scanner as its gate plus the house's universal rules
  ($10, $20 million, MUST WORK).
- `docs/study/setups/go_signal_hourly_bars.json` holds the vendor bars he reviewed: clock-aligned, first bar 9:30-10:00
  (its header says "15-min base, 9:30-anchored").

### 5.4 Other places the app defines a Go Signal (they do not agree)

| Place | Its rule |
|---|---|
| `api/services/screener/base_catalog.py` (`GO_SIGNAL`, Auto Structures) and `tests/test_go_signal.py` | the Model Book card's pattern: a 3% catalyst gap, a pullback into the 9 EMA within 20 sessions, then one wide green candle (1.3x the 30-bar range) closing above the gap day's high and the pullback's high. Says "Ours, not a published pattern." |
| `api/services/chart_iq/engine/v2_setups.py` | "GO signal": in an uptrend, the low under the 5-day low by no more than 0.6 ATR, the close back above it, a lower wick of 40%+, DCR 0.6+, not extended above the 50-day |
| `api/services/pattern_engine/tag_textbook.py` (`go_signal_r2`) | close above the 50 above the 200 with a rising 50; open at least 0.2 ATR under the prior close; low at least 0.2 ATR under the 10-day swing low; close back above it, DCR 0.67+, a green candle |
| `api/services/setup_tags.py` | "In a rising stock, a session that opens weak, undercuts nearby support and closes in the upper part of its range." |
| `docs/agent/coach/VOCABULARY-MAP.md` | files "Go Signal" under market conditions and breadth, next to FTD |

### 5.5 Model Book card and journal tags

- **Card** (`app/src/pages/modelbook/setupCatalog.js`): family "Intraday", direction long, essence "A catalyst gap digests
  into the 9 EMA" then one wide candle "engulfs the pullback and closes above the catalyst high", a 9-period EMA on the
  glyph. A different setup from his rulings.
- **Journal tag** (`app/src/constants/setupGroups.js`): "Go Signal" sits in the **Swing** group; "Red to Green
  (Intraday)", "Green to Red" and "30min Pivot" sit in the Intraday group. The card says Intraday, the tag says Swing.

### 5.6 Study texts

- `docs/study/UNITS-method.md` SET.34 and `docs/curriculum/uct_method_course.json` / `uct_method_chapters.json`: the
  lesson "Go Signal: The Catalyst Gap That Digests into the 9 EMA, Then Engulfs", framed as the confirmation layer for EP
  and Power Earnings Gap entries.
- `docs/study/bank/recall.glossary.json`: items si_98dfe5951957 and si_eff45912f4a1 teach "A Go Signal follows a catalyst
  gap." (review status "draft" in the repo copy; I did not check the pod).
- `docs/study/TRADE_PLANS.md`: the scanner's daily footprint, entry and stop (accurate to the code).
- `docs/study/UNITS-foundations.md` F4.11 lists the Go Signal among the reclaims (with the Oops and U&R): consistent
  with his ruling.

### 5.7 Summary: what looks wrong

1. Two incompatible definitions carry the name; the card, curriculum and glossary teach the one he never described.
2. The scanner is a daily footprint with a weak-open gate the owner's newest wording contradicts, a $2 floor, no 200-day
   gate, and fixtures he graded the other way.
3. The hourly finder tests the 2026-10-27 flag reading, not the 2026-11-01 prior-close key.
4. Nothing in the app names which hourly bars to use; the bars he reviewed are clock-aligned, our measurement bars are
   session-aligned, and the answer changes in one session in seven.

## 6. UCT's own words

All Substack quotes are from UCT's public Substack (https://unchartedterritoryy.substack.com). I read all 103 posts in
the sitemap through Substack's post feed and searched every one for "go signal", "red to green", "UnR", "undercut",
"hourly", "first hour", "30 min", "65 min" and "gap down". One post (Sunday Scans, 18 Oct 2026) is for subscribers only
and was read as a preview. Dates are the post dates Substack stamps. All 24 "Go Signal" mentions (23 passages; one passage names it twice) sit in "TSDR's Weekly
Outlook & Watchlist", the "Charts Covered" and "Honorable Mention" lists that follow it, the unsigned intro of one post,
or a "TSDR Trading" section, so they are the owner's (the byline: "run by Patrick (TSDR), Bracco, EliteSwingTraders, &
Manrav"). Quotes keep the writers' spelling.

### 6.1 The owner's rulings (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`)

The definitions are in section 3.1. The grades, in short: 45 daily footprints graded 2026-10-27/28 (4 great, 14 good,
2 good setup but no follow-through, 4 okay, 12 need the hourly, 1 earlier day, 6 cut, and 2 answered with the definition or a process note instead of a grade
(AAPL 2023-02-17, MSFT 2022-11-14); "Okay let's do it all now"), then
hourly close-ups on 2026-10-31 and 2026-11-01 (VGZ 2026-09-28 kept as okay; VST 2026-10-16, VGZ 2026-10-16 and MSFT
2022-07-14 cut; five more pending because the white paint on the open bars hid the candle colours, so the open bars were
re-marked). The sitting was paused on 2026-11-02 when he asked to revisit the whole Study plan. On 2026-11-08,
on the trade rules and the Go Signal: "Those answers are out there." Patterns in his cuts (from the log's notes): downtrends (META 2022-08-09
under every average, MSFT and AAPL 2022-10-11 at new lows), stocks he would not trade (GIC), and an index he did
not care about (QQQ 2021-12-15, "Maybe a downside go signal but who cares").

### 6.2 The owner on the Go Signal (all 24 Substack mentions, in 23 passages)

1. ALAB, [8 Jun 2025](https://unchartedterritoryy.substack.com/p/sunday-scans): "This is pretty much my bread and
   butter. Setting up off the 20ema here. Any sort of GO SIGNAL would allow me entry with immediate full size." Then:
   "Anything in the $87-$90 range and reclaim of red to green spot, previous day’s low, or opening range and I am a
   buyer."
2. QQQ and the focus list, [22 Jun 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2): "Ideal scenario for
   next week is a gap down of 0.7% or more that gets bought up. There is nothing I like more than a gap down reversal
   to give me signal." And: "Especially in a strong trend that is pulling back to a key area or moving average." And:
   "If we get the gap down and GO SIGNAL then I will likely be aggressive Monday morning."
3. Same post: "If we see buying activity and opening ranges being taken out or strong hourly candles forming after the
   first 30 min then we can execute on our focus list." Then: "This would be considered a UnR (undercut and Rally), I
   call it a GO SIGNAL. But it is important to wait for signs and signals of strength instead of hoping we bounce at this
   random moving average".
4. INTU, same post: "Ideal would be tight entry off 20ema on a gap down and Go Signal."
5. NVTS, [29 Jun 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-d70): "A GO SIGNAL would be ideal to dip
   under the MAs and the $6.50 level with a fierce reclaim."
6. ASML, [6 Jul 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-df6): "GO SIGNAL on Wednesday followed by
   inside day Thursday."
7. RDDT, [20 Jul 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-c82): "The shakeout under $141 into $138
   held and gave a GO SIGNAL."
8. SOUN, [14 Sep 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-461): "bought the double inside days,
   usually wait for a GO SIGNAL, but wanted a chunk."
9. META, same post: "Study this Friday candle. The dip into bullish gap support and quick reclaim. This is a GO SIGNAL."
10. ZETA, same post: "Has taken some time to build out but got a good GO SIGNAL on Thursday and took out the HVC."
11. ZS, [The Rest of the Week, 1 Oct 2025](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week): "It has
    gotten tight below $294 and gave a GO SIGNAL on Thursday of last week with follow through on Friday."
12. FIG, [15 Oct 2025](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-39d): "Any sort of red to green GO
    SIGNAL and I will be getting pretty heavy in this via shares." And: "I want doo low tight risk on proof of buyers near
    support vs buying strength to the upside."
13. His approach, [9 Nov 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-720): "I am mostly a 20EMA kind of
    guy." And: "My ideal stocks and broad setups are seeing that exact style of upside reversal on individual names at
    the 20EMA. It is my GO SIGNAL."
14. AMD, [16 Nov 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-d6a): "I have positions in both AMD (Hourly
    GO Signal on Wed) & AMDL (OpenAI gap up day in early Oct)."
15. CRS, [30 Nov 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-422): "On the chart I am looking for a Go
    Signal near the 20EMA in the $310-$315 range."
16. BTU, [28 Dec 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-249): "Ideally allow an entry via hammer
    candle/Go Signal against the 20EMA early in the week."
17. BIDU and AMD, [4 Jan 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-153): "Made most of my buys on the
    gap down on Monday adding BIDU AMD on the GO SIGNAL."
18. Hindsight trading, unsigned intro, [18 Jan 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-2a1): "A
    higher low, a go signal, a gap on news to push the stock."
19. SOLS, [16 Feb 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-ccf): "Ideally let the hourly build out
    and we get a go signal and tap of the 9ema."
20. His week, [30 Aug 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-d40): "I posted entries or actionable
    go signals at those spots on each of these (except IBIT) but just wasn’t able to hang on or capture all of them."
21. SNDK and TEM, [6 Sep 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-fcd): "If you bought the go signal
    on SNDK you are up 20% in 5 sessions." And: "$61.25 the HVC. Keep an eye on the hourly for a GO SIGNAL."
22. SHOP, [27 Sep 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-09b): "I would love an hourly GO SIGNAL
    around the $140 mark on this."
23. REGN, [8 Nov 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-70f): "I strongly considered buying this
    on Friday at $900 with LOD stop." And: "I will be tracking the hourly chart for a GO SIGNAL."

### 6.3 The owner on the parts it is built from

- **Red to green as the A+ entry.** BE, [1 Mar 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-6a8): "A gap
  down red to green Monday would be an A+ setup in my book." The idea in one line (INTC example, [14 Jan 2026](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-305)):
  "Then break previous day’s high or hammer red to green on some weakness and lower wick."
- **Why he wants it.** "Preferably get a gap down red to green move to show presence of buyers and clear area to risk
  against." (APLD, 10 Aug 2025.) "If you buy right at support close to the invalidation spot when you get a candle to
  hold, a presence of buyers, and an area to risk against" ([5 Jul 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-dec)).
- **The hourly higher low.** YOU, [15 Mar 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-af4): "What I like
  to see is a hold, slight push higher, then hourly higher low to give a clear area to risk against and a presence of
  buyers."
- **The stop.** [22 Jun 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-0d2): "I always take 1-2% losses
  when trades do not show me positive results from the get go. That is usually how pure of entries I try to get with a
  stop at LOD (Low Of Day)."
- **The trail.** Same post: "My stops are now trailing at two consecutive closes below the 20ema on these."
- **A gap through the stop.** Same post: "I always use the first 30 min to let play out and establish the range." And:
  "Letting the first 30 min candle define your new stop is only applicable if you can afford the slight additional
  risk." Later ([2 Nov 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-b99)): "The only times these will be
  adjusted are on a gap down and will be replaced at the 15/30 min low and when moving my stop to breakeven".
- **A failure, in his words.** [1 Nov 2026](https://unchartedterritoryy.substack.com/p/sunday-scans-669): "This week I
  took CRM on the oops reversal and red to green move at the 20EMA and took a 4% loss on the gap down when ServiceNow
  dumped."
- **Holding period.** Same post: "I look for minimum 3-7 day burst swing trades that could potentially turn into strong
  positions."

### 6.4 Unsigned sections (Index & ETF, intros, closing comments)

- On hourly charts, Index & ETF section, [29 Jun 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-d70): "I am
  a big advocate of hourly/65 min charts and using them in confluence with the daily chart for spotting key pivots and
  levels that the daily chart might mask." And: "Additionally I visualize this through the lens of Oliver Kell’s cycle
  of price action that he applies to daily charts."
- Closing comments, [26 Oct 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-13e): "Higher lows will guide
  us. Use the hourly to look for shorter term structure and the cycle of price action playing out to find a way into the
  daily and weekly charts."

### 6.5 Bracco

- MAU&R, [26 Oct 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-13e): "These all staged MAU&R’s (moving
  average undercut and rallies) with most closing strong on Friday."
- In his parabolic-short write-up, the reverse case ([Sunday Scans, 28 Dec 2025](https://unchartedterritoryy.substack.com/p/sunday-scans-249)):
  "You will sometimes see a sharp bounce or undercut and rally of the 9/10 EMA following a sharp reversal off of the
  highs within a very strong trend."
- Knowledge base (paraphrased): on 2025-02-11 he called a possible TSDR Go Signal on SOXS if it undercut the prior
  day's low and defended $20 (row 10968). So inside the team the name is the owner's, and it is used on leveraged ETFs.

### 6.6 Other UCT writers (related setups, not the Go Signal)

- The Wiz, [The Rest of the Week, 7 Jan 2026](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-3f0), the
  "gap gotcha hammer": "Gap up, followed by an UnR of that gap candle low and closing back inside the bar with a hammer."
  And: "Stop being the low of the day."
- Manrav, TSLA, [5 Nov 2025](https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-9c9): "Want to see the 21 EMA
  hold or an undercut and reclaim is even better to get long/add to the position."
- Knowledge base (paraphrased): a trader named AtTheAsk wrote on 2026-03-18 that he was building a "Go Signal" indicator
  read as a 30-minute green candle that reclaims the 20 EMA, with a FIGS 30-minute chart as his example (row 12473). A
  member's reading, not the owner's.

### 6.7 What UCT's usage adds up to

1. It is the owner's personal name for an undercut-and-reclaim entry, said by him to be a UnR, read on the hourly (or
   65-minute) chart against a daily setup.
2. The daily setup is almost always a pullback in a strong stock: the 20-day EMA first, then the 9 EMA, a bullish gap,
   an HVC, a base top or a named level.
3. The trigger is weakness that gets bought: a gap down (0.7%+ for the index) or a dip under a nearby low, then red to
   green, a fierce reclaim, an opening range taken out, or strong hourly candles after the first 30 minutes.
4. The stop is the day's low, the size can be full at once, the trail is the 20-day EMA, and a gap through the stop is
   handled with the first 30 minutes.
5. He also uses the name for the index (the market's buy day) and once for an hourly turn that had nothing to do with the
   prior close (AMD, 12 Nov 2025).

## 7. How it fits the owner's account rulebook (`docs/study/sizing_rule.md` section 9)

| Rule | What it says | How the Go Signal fits | Conflict? |
|---|---|---|---|
| A3, F62 | stop first, a few cents under the day's low or the prior day's low | the natural stop is a few cents under the session low so far, which is exactly the house default | no |
| A13 | stops usually within about 3% | median 1.4% in our test; 14% of signals had a stop over 3%; three of his own examples were 5-6% (MSTR, DOCN, ZETA) | sometimes; A3 says skip or size down when the honest stop does not fit |
| A5 | size from the stop, capped (40%, A7) | a 1% stop at 1% risk would be a 100% position; the cap binds often on tight Go Signal stops | the cap, not the stop, sets size on the tightest ones |
| E57 | market orders | buy at market when the hourly candle closes back above the prior close (or as it crosses; question 5) | no |
| C28 | no more than 4% past the buy point | the buy point is the prior close; only 2.2% of signals closed their reclaim candle more than 4% above it | rarely |
| C29 | skip a long more than 10% above its 10-day average | 11.3% of signals in context were; most are pullbacks, so few | sometimes |
| B26 (hard) | no longs below the 200-day SMA | a pullback in an uptrend, so mostly fine; but his "great" MSFT 2022-11-17 and "good" MSFT 2022-11-22 and AAPL 2022-09-01 were below the 200-day | yes for those examples: the rule wins and they leave the bank (question 11) |
| B23 | $10 and $20 million a day | VGZ 2026-09-28 (a stock trading at about $2.60-2.70 that day) was kept as okay on 2026-11-01; GIC was cut as "not a stock I would trade"; the scanner's floor is $2 | yes for VGZ and the scanner |
| C31 | RS 80+ | his own calls were often under 80 on our proxy (ZETA 58, BIDU 68, META 69, ZS 77); the proxy is not IBD's rating | needs his reading (question 12) |
| B19, E51, E52 | breakeven at 2R-5R; a third at 3R and 5R; trail the 10-day (fast) or 21-day (steady) | he trails the 20-day EMA in his posts, which is close to the 21-day | no |
| B20 | gap through the stop: the first 30-minute low is the new stop, out past 2R | his own 22 Jun 2025 "GAP DOWN SELL STRATEGY" is the same rule | no |
| C33 | under 1R after 10 trading days, sell | fits his "3-7 day burst" aim | no |
| B22 | no new buys in the 3 days before earnings | his hourly entries often come in the weeks after a report (REGN, 8 Nov 2026, "Loved the earnings numbers"); a Go Signal in the 3 days before a report is barred | no, but the course must say so |
| C30 | no time-of-day rule | the Go Signal is itself a time rule (the first two hourly candles). It is part of the setup's definition, not an account rule | no |
| B18, F65 | the market reading decides | his index Go Signal (QQQ gap down bought at the 20-day line) is a market buy-day signal; the market proxy split in 4.3 was small | no |
| D47 | shorts are the long setups reversed | a "downside go signal" or green to red, below the 200-day only (B26) | he showed no interest (question 13) |
| E56 | at most 3 tries a week on one stock | fits: a failed Go Signal that sets up again is a new trade (B21) | no |

## 8. Proposed rules for our course

Each line is measurable and tagged. Where his words disagree, the options are given and one is recommended.

### 8.1 What it is (all must hold)

1. **A leader in an uptrend.** Price above the 200-day SMA [house rule B26] and the 50-day SMA [my proposal; his cuts of
   downtrend charts], the 20-day EMA higher than 5 sessions ago [code G0; his cuts], RS 80+ [house rule C31]. $10+ and
   $20 million+ a day [house rule B23].
2. **It has already moved.** Within the last 20 sessions a gain of 13%+ over 5 sessions, or within the last 30 a gap of
   4%+ on 2x average volume, or a tight 10-day base above the 50-day [code G1; KB row 10789's notable prior move,
   paraphrased]. Options for the owner: keep these, or ask only for a breakout, a catalyst gap or an HVC within the last
   6 weeks (simpler to teach).
3. **It is at support.** The session low reaches one of these, no more than about 3% under it: the rising 20-day EMA
   (first choice), the 9 EMA in a fast stock, the 50-day SMA, a bullish gap, an HVC, a base top or breakout level, or
   the prior day's low [UCT; my proposal for the 3%].
4. **A tight hourly flag before it.** The 2 to 5 sessions before hold a range of 10% or less on the hourly chart,
   ideally with a higher low than the swing before the move [owner ruling 2026-10-27, VEON; code: the hourly finder's
   numbers]. Optional for the course until he rules (question 8).
5. **The trigger.** The first hourly candle trades below the prior day's close, and an hourly candle closes back above
   the prior close by the end of the second hourly candle [owner ruling 2026-11-01]. The undercut of the support in 3
   happens in the same move [UCT; brain template].
   - **Options for the open** (question 1): (a) any open, as long as the first hour trades under the prior close; (b)
     an open at or above the prior close that dips through it ("green to red"); (c) a gap down, 0.7% or more for the
     index. **Recommend (a)** and teach (b) and (c) as its two shapes: his rulings and his posts use both, and our test
     found no reason to exclude either (gap downs did slightly better, section 4.3).
   - **Bars:** name them. **Recommend clock-aligned 60-minute bars** (9:30-10:00, then 10:00-11:00), the default on most
     platforms and the bars on his review screen, so "the first or second hourly candle" ends at 11:00 [my proposal;
     question 3].
   - **Close, not touch:** an hourly close back above the prior close [my proposal; it is what "go red to green in the
     first or second hourly candle" most plainly means, and META 2025-09-12 shows the difference; question 4].
6. **The reclaim candle is green** (closes above its open) [UCT, "strong hourly candles"; my proposal as a rule].
7. **Volume** is not a rule [originator: Morales "not a factor"; Williams' Oops as tested has no volume rule; no UCT number. Not a
   consensus: Wyckoff's school prefers a low-volume spring, section 3.9]. More volume on the reclaim than
   on the flag's first hours is a plus for grading [code: the hourly finder's volume ratio; my proposal].

### 8.2 The buy

- **Order:** a market order [house rule E57] at the close of the hourly candle that goes back above the prior close
  [my proposal]. The aggressive version buys as price crosses back through the prior close (the scanner's entry; his ALAB
  "reclaim of red to green spot"). **Recommend the hourly close for the course:** it is what his rulings describe ("strong
  hourly candles forming after the first 30 min"), and it gives a clean yes or no on the chart. My test did not measure
  the cross entry, so this is a judgment, not a measured result.
- **Not more than 4% above the prior close** [house rule C28]. **Not more than 10% above the 10-day average** [house rule C29].
- **Not in the 3 days before earnings** [house rule B22].
- **Full size at once** [house rule A5; his ALAB "immediate full size"].

### 8.3 The stop

- A few cents under the session's low at the time of entry [house rule A3, F62; UCT "LOD stop"; outside source:
  Qullamaggie "Stop is always lows of the day"].
- If that is more than about 3% from the entry, size down from the stop (A5) or skip it if it does not fit [house rule
  A3, A13]. Do not move the stop up to the reclaimed level to make it fit [my proposal; the level is where the
  shake-out happens].

### 8.4 Trims and trail (house defaults)

- Stop to breakeven at 2R to 5R [house rule B19]. A third at 3R [B19], a third at 5R [E51]; if it opens above a trim
  level, trim at the open [F63].
- Trail the last third under the 10-day average for a fast stock, the 21-day for a steady one; sell on a close below it
  [house rule E52]. His own trail is the 20-day EMA [UCT], which the 21-day matches.
- Under 1R after 10 trading days: sell [house rule C33]. A gap through the stop: the first 30-minute low is the new stop,
  out past 2R [house rule B20; UCT 22 Jun 2025].

### 8.5 What invalidates it

- **Before the entry:** no hourly close back above the prior close by the end of the second hourly candle. A later turn
  is a pivot (setup 41), not a Go Signal [owner ruling 2026-10-31, 2026-11-01].
- **After the entry:** a trade below the session low (the stop) [UCT; house rule]. A day that closes back under the
  prior close is a warning, not an exit [brain template: "Close below the reclaimed level or moving average (20 EMA) negates the GO SIGNAL."; measured: those
  averaged -0.47R, but selling them at the close did not improve the average].
- **Context breaks:** a close under the 20-day EMA after entry is a warning; a close under the 50-day ends the pullback
  thesis [my proposal; brain template names the 20 EMA].

### 8.6 The short mirror

- A "downside go signal": below the 200-day SMA only [house rule B26], RS 20 or less [C31 mirror], a stock that has
  fallen and bounced into resistance (a falling 20-day EMA, the 50-day, a bearish gap); the first hourly candle trades
  above the prior close and an hourly candle closes back under it by the second candle (green to red); short at market;
  stop a few cents over the session high [house rule D47, mirrored]. The journal already has a "Green to Red" tag.
- He was not interested ("Maybe a downside go signal but who cares"). **Recommend** teaching it only as the mirror in one
  lesson, or leaving it out, as he decides (question 13). Leveraged inverse ETFs (E54) are another way UCT expresses it
  (Bracco's SOXS).

### 8.7 Best market conditions

- A Green market reading [house rule B18, F65]. The best Go Signals come when the index itself is pulling back to its
  20-day line and gets bought (his 22 Jun 2025 plan: the index gap down bought is the signal to "execute on our focus
  list") [UCT].
- After a correction, start with a few [house rule F68]. In Orange, A+ only; in Red, none [F65].

### 8.8 Common mistakes

1. Buying the open before the turn (the blind open buy that gets stopped at the low).
2. Calling a 14:00 turn a Go Signal: it is a pivot [owner ruling].
3. Taking it in a downtrend, under the 50-day or 200-day [his cuts; B26].
4. Taking it on a cheap or thin stock [B23; GIC, VGZ].
5. A stop wider than about 3% with full size [A13, A5].
6. Grading from the daily chart: the daily footprint cannot show the turn [owner ruling 2026-10-27].
7. Mixing it up with the Model Book card's pattern (a catalyst gap, a dip to the 9 EMA, an engulfing day), which is a
   different setup.
8. Ignoring the bar setting: the same session can pass on one chart and fail on another (section 4.4).
9. Treating the turn itself as the edge: it happens in about a third of all liquid sessions; the stock and the level are
   the edge [measured].
10. Chasing past 4% (C28) or buying right before earnings (B22).

## 9. Grading: what makes an A+ and what makes a B-

E50 says grading is discretionary and he does not want a fixed checklist taught as his. These are observable signs drawn
from his grades and words, offered as a guide.

**A+ (his "great"; "A gap down red to green Monday would be an A+ setup in my book")**
- A true leader (RS 90+ on his rating), in a hot group, after a catalyst or a big move; the market Green. [house rules
  C31, F65; his posts on leaders and themes]
- A quiet, tight pullback into the rising 20-day EMA (or the 9 EMA in a fast leader), a tight hourly flag with a higher
  low. ["I am mostly a 20EMA kind of guy."; rulings 2026-10-27; Wyckoff's higher-low test]
- A gap down or a quick flush under the prior day's low or the flag low into the 20-day line, and a strong green hourly
  candle back above the prior close in the first candle, on rising volume. [his BE line above; ruling 2026-11-01;
  volume is my proposal]
- A stop of 2% or less under the day's low [A13; his "1-2% losses"]; the day closes in the top of its range [measured,
  section 4.3, after the fact]; it moves within days ["minimum 3-7 day burst"; ZS "follow through on Friday"].

**A / B (normal size)**
- The same, with one thing missing: the turn in the second candle, a looser flag, the 50-day instead of the 20-day, or
  a 2-3% stop.

**B- or lower (size down or skip)**
- The 20-day EMA flat, price near the 50-day or the 200-day, no prior move; a choppy flag; the turn only in the second
  candle and weak; a stop near or over 3%; a Yellow or Orange market; a thin or cheap stock; the day closes weak.

**Not a Go Signal at all:** a turn after the second hourly candle (a pivot), a stock in a downtrend, a gap up that never
trades under the prior close.

## 10. Questions for the owner

1. **The open.** Which counts? (a) any open, as long as the first hourly candle trades under the prior close; (b) only an
   open above the prior close that dips through it ("green to red", your 2026-11-01 words); (c) a gap down (your 22 Jun
   2025 "0.7% or more"). I recommend (a), teaching (b) and (c) as its two shapes.
2. **Red to green against what?** The prior day's close (your 2026-11-01 wording), or the hourly candle's own open (a red
   candle turning green), or a flag low? Your AMD call on 12 Nov 2025 never traded below the prior close.
3. **Which hourly bars?** (a) clock-aligned (9:30-10:00 first), the review screen's bars; (b) session-aligned
   (9:30-10:30); (c) 65-minute. What does your charting platform show?
4. **Close or touch?** Must an hourly candle close back above the prior close, or is trading back above it enough? (Your
   META example of 12 Sep 2025 traded above it in the second hour and closed above it in the third.)
5. **The entry.** At the reclaiming hourly close, as it crosses the prior close, or over the first hour's high (the
   opening range)?
6. **The stop.** A few cents under the day's low (the house default)? If that is over 3%, skip or size down?
7. **Levels.** Is the 20-day EMA the main level, and which others count (9 EMA, 50-day, bullish gap, HVC, base top, prior
   day's low)?
8. **The hourly flag.** Required, or a plus? How tight (10%? 5%?) and how many sessions (2 to 5)?
9. **Already moved.** Keep the scanner's test (13% in 5 days, a 4% gap on 2x volume, or a tight base above the 50), or
   use something simpler?
10. **The other definition.** Retire the Model Book card, curriculum lesson and glossary items that describe "a catalyst
    gap digests into the 9 EMA, then one wide candle engulfs the pullback", and replace them with your rulings?
11. **The 200-day.** Your "great" MSFT 2022-11-17 and "good" MSFT 2022-11-22 and AAPL 2022-09-01 were under the 200-day.
    B26 is a hard rule now; may those leave the bank?
12. **RS 80+.** ZETA, BIDU, META and ZS were under 80 on our rough proxy when you called them. Does C31 apply to the Go
    Signal as a hard filter?
13. **The short side.** Teach a "downside go signal" (green to red under the 200-day) or leave it out?
14. **The index version.** Teach the QQQ Go Signal (a gap down bought at the 20-day line) as the market's buy day inside
    this lesson, or as its own lesson?
15. **The bank.** 13 of your 18 great or good daily footprints turn green after the second hourly candle. Re-grade them
    on the hourly close-ups, or start a fresh gallery from your public calls (BIDU, ZS, ZETA, MSTR) and the scan in
    section 4.6?

## 11. Sources

Read on 2026-11-09 unless noted.

| # | Source | Publisher / author | URL or file | Reliability note |
|---|---|---|---|---|
| 1 | Uncharted Territory Substack, all 103 posts in the sitemap (24 Go Signal mentions in 19 posts) | Uncharted Territory: Patrick (TSDR), Bracco, contributors | https://unchartedterritoryy.substack.com/sitemap.xml (post links in section 6) | House source; outranks outside writers for how we trade it. One post subscriber-only (preview read). Authorship by section |
| 2 | Owner verdict log, Go Signal lines (228-309, 491) | the owner, recorded by the Study sessions | `docs/study/audits/2026-10-24/owner_verdicts.jsonl` | His exact words; the notes beside them are the sessions' readings |
| 3 | Account rulebook, section 9 | the owner, 2026-11-09 | `docs/study/sizing_rule.md` | House rules |
| 4 | Knowledge-base summaries (rows 10789, 10117, 10252, 10004, 10968, 12473, 6021) | machine summaries of UCT's private Discord | `docs/study/levels/brain_kb_2026-11-06.json`, `brain_kb_rules_2026-11-06.json`, `brain_kb_cycle_2026-11-06.json` | Not anyone's exact words; paraphrased only |
| 5 | Brain template "Go Signal (TSDR)" as quoted | firm brain, via the 2026 setup research | `docs/superpowers/research/setups/setup_criteria.json` | AI-built; one line matches his post word for word, one line I could not find in his posts |
| 6 | Scanner and its fixtures | UCT app | `api/services/pattern_engine/detectors/uct/uct_go_signal.py`, `uct_setups_common.py`, `primitives/liquidity.py`, `tests/fixtures/uct_go_signal/`, commit 8c7ba47b99 | Read directly |
| 7 | Study finders, overlay and vendor bars | UCT app | `scripts/study/find_go_signal_hourly.py`, `find_go_signal_examples.py`, `app/src/pages/study/goSignalOverlay.js`, `docs/study/setups/go_signal_hourly_bars.json` | Read directly |
| 8 | Other app definitions | UCT app | `api/services/screener/base_catalog.py`, `tests/test_go_signal.py`, `api/services/chart_iq/engine/v2_setups.py`, `api/services/pattern_engine/tag_textbook.py`, `api/services/setup_tags.py`, `api/services/pattern_engine/detectors/registry.py`, `docs/agent/coach/VOCABULARY-MAP.md` | Read directly |
| 9 | Model Book card, journal tags, Study texts | UCT app | `app/src/pages/modelbook/setupCatalog.js` (commit 1391900ba5), `app/src/constants/setupGroups.js`, `docs/curriculum/uct_method_course.json`, `uct_method_chapters.json`, `docs/study/UNITS-method.md`, `docs/study/bank/recall.glossary.json`, `docs/study/TRADE_PLANS.md` | Read directly |
| 10 | "Trading Innovation" page | Larry Williams | https://www.ireallytrade.com/innovation/ | Originator's own site; dates the Oops to 1981 |
| 11 | *Long-Term Secrets to Short-Term Trading*, front matter and contents | Larry Williams, Wiley, copyright 1999 | https://catalogimages.wiley.com/images/db/pdf/0471297224.pdf | Publisher's PDF; chapter not read |
| 12 | "Technical Patterns" knowledge-base page | Deepvue | https://docs.deepvue.com/articles/deepvue-custom-indicators-technical-patterns | Charting service and educator; short definitions |
| 13 | OWL Trader glossary (U&R, MAU&R) | Gil Morales | https://www.theowltrader.com/glossary/ | Originator of the U&R name; page undated (footer 2023) |
| 14 | "The Wyckoff Method: A Tutorial" | Roman Bogomazov and Michael Lipsett, StockCharts ChartSchool (same text on Wyckoff Analytics) | https://chartschool.stockcharts.com/table-of-contents/market-analysis/wyckoff-analysis-articles/the-wyckoff-method-a-tutorial ; https://www.wyckoffanalytics.com/wyckoff-method/ | Established educators of the Wyckoff school |
| 15 | "3 TIMELESS setups that have made me TENS OF MILLIONS!" | Kristjan Kullamägi (posted 8 Jan 2021, updated 28 Apr 2021) | https://qullamaggie.com/my-3-timeless-setups-that-have-made-me-tens-of-millions/ | Originator's own page; used for entry and stop mechanics only |
| 16 | "We Tested Larry Williams' Oops Pattern" | Unger Academy | https://ungeracademy.com/blog/we-tested-larry-williams-oops-pattern-the-results-might-surprise-you | A course seller's backtest on DAX futures; undated |
| 17 | Our own test (hourly bars 2023-12-12 to 2026-11-06, 968 names; 5-minute bars for 60 sessions) | this dossier | scratch scripts `tools/measure.py`, `summarize.py`, `summarize2.py`, `close_rule.py`, `bucket_check.py`, `examples.py` | Read-only; limits in section 4.3 |
| 18 | Not read | Crabel, Kell, Shannon, Aziz, Connors and Raschke books; TraderLion; investors.com; Bulkowski | none | Search budget ran out; nothing quoted from them |
| 19 | Web searches in checking: "go signal" as a trading setup; IBD "follow-through day" + "go signal" | the checker, 9 Nov 2026 | WebSearch | No outside writer or IBD page uses the name for this pattern or for the FTD; nothing quoted |

## 12. Removed or fixed in checking

Cold check of 9 Nov 2026. Nothing below changes a rule; the corrections are counts, one price, one figure and three
tags. Everything else in sections 1 to 11 was confirmed at its source (see the checking note at the top).

**Fixed**
1. **The owner's grade tally (6.1).** The dossier said "7 cut". The log lists six cuts (META 2022-08-09, MSFT and AAPL
   2022-10-11, GOOGL 2022-11-16, GIC 2026-10-21, QQQ 2021-12-15); the two other footprints of the 45 (AAPL 2023-02-17
   and MSFT 2022-11-14) got the definition and a process note instead of a grade. Now 4 + 14 + 2 + 4 + 12 + 1 + 6 + 2 = 45.
2. **The mention count (2, 3.2, 6, 6.2, 11).** "23 mentions in 19 posts" was 23 numbered passages; the posts carry the
   name 24 times (passage 21 names it twice: SNDK and TEM). Recounted on a fresh download of all 103 posts; the 19
   posts and the 8 Jun 2025 first use stand.
3. **MSFT 2022-11-17's 200-day line (5.2 item 5).** "$268.27" could not be reproduced; our daily database gives $267.91.
   Written as "near $268" with the measured figure. The point (below the 200-day, B26) stands, and so do MSFT 2022-11-22
   ($245.03 against $267.01) and AAPL 2022-09-01 ($157.96 against $161.06).
4. **VGZ's price (7, B23).** "VGZ ($2.70) was kept as okay on 2026-11-01" mixed two days: the day kept as okay was
   VGZ 2026-09-28 ($2.60-2.70 on the vendor bars); $2.70 was the prior close of VGZ 2026-10-16, which was cut.
5. **The volume tag (8.1 item 7).** "[source consensus]" needed two agreeing outside sources; Morales says volume is
   not a factor and Williams' Oops as tested has no volume rule, but Wyckoff's school prefers a low-volume spring, so it
   is not a consensus. Retagged.
6. **"originator-adjacent" (8.3).** Not a tag in the legend; Qullamaggie is not an originator of this family. Two tags
   added to the legend ([outside source], [brain template]) and the line retagged.
7. **The scanner's stop (5.1).** "The session low, exactly" is true except in the one case `make_levels` handles (a low
   not below the entry, nudged 0.5%); the exception is now stated.
8. **Row file names (3.3, 11).** Rows 10117, 10252 and 10004 are in `brain_kb_rules_2026-11-06.json`, not in
   `brain_kb_2026-11-06.json`; rows 10117 and 12473 also sit in `brain_kb_cycle_2026-11-06.json`. Named.
9. **The IBD question (2).** "I could not check" replaced with the result of a search: no IBD page or book calls a
   follow-through day a "go signal".

**Added**
- Deepvue dates the Oops to 1979; Williams' own site says 1981 (3.7). The originator's date is kept.
- The Wyckoff Analytics copy of the tutorial is unsigned (3.9); the authors' names are on the StockCharts copy.

**Removed:** nothing. No quote, attribution, statistic or criterion failed its source.

## 13. Examples (from our data)

Added 9 Nov 2026 from a scan of the sandbox's bars. (Numbered 13 because section 12 above is the cold-check record.)
Scan script and every hit with its outcome: `_study-resume/scratchpad/setups/42-go-signal/final/scan_go.py` and
`hits.json`; the charts and the three phone sheets (`sheet_1-4.png`, `sheet_5-7.png`, `sheet_8-10.png`) are in the
same folder. Each chart is the daily context on top and the hourly turn underneath, because the daily footprint
cannot show this setup (owner ruling 2026-10-27).

**The rule the scan used (section 8 plus the house rules), in one paragraph.** On the day before the signal the stock
closes above its 200-day and 50-day SMAs, the 20-day EMA is higher than 5 sessions earlier, the price is $10 or more
with $20 million or more traded a day (50-day averages), and its relative strength is 80 or better (our proxy: the
percentile, among the scanned names on that day, of the IBD-style weighted 3/6/9/12-month return; not IBD's own
rating). It has already moved: a 13%+ gain over 5 sessions within the last 20, or a 4%+ gap on twice average volume
within the last 30, or a 10-day range of 10% or less above the 50-day. The 3 sessions before hold a range of 10% or
less. On the signal day, on hourly bars, the first hourly candle trades below the prior close, and the first or second
hourly candle closes back above it and closes green; the session low up to that candle sits within 3% under (or 1%
over) one of the 20-day EMA, the 10-day EMA, the 50-day SMA or the prior day's low. Buy at market at the close of
that candle, not more than 4% above the prior close (C28) nor 10% above the 10-day average (C29), not in the 3
trading days before earnings (B22). Stop 3 cents under the session low so far; risk must be 3% or less (A13).
Outcome: the rest of the session on the hourly bars, then up to 60 daily bars, fixed stop, no trims; first of stop,
3R, 5R.

**Base rate.** 11,094 hits on 963 of 963 names scanned (the names that have hourly bars: the 1,000 most-traded names,
less ETFs and names without 320 daily bars), window 2023-12-12 to 2026-11-06 (679,518 sessions looked at; the scan
finished inside its budget). 26.0% reached 3R and 17.5% reached 5R before the fixed stop; 23% (2,557) were stopped
the same session; median risk 1.25%. Caveats: a fixed stop with no trims and no breakeven move, so the house exits
(B19, E51, E52) are not modelled; the hourly bars are Yahoo's 9:30-anchored bars (the second candle ends at 11:30,
not the 11:00 the dossier recommends in 8.1.5), so some sessions pass or fail differently from a clock-aligned
chart (section 4.4); the RS proxy is a rank among the scanned names only; the "tight base" option let in many weak
prior moves (6,184 of the hits; 3R rate 26.5%, no better than the 13%-in-5-days hits at 25.9%). Splits of the same
hits: gap-down opens 27.1% to 3R (3,308) against 25.0% for opens at or above the prior close (4,978); first-candle
reclaims 25.9% (8,451) against second-candle 26.4% (2,643); by level, 20-day EMA 27.3%, 10-day EMA 26.1%, prior
day's low 24.7%, 50-day SMA 30.9% (only 81). None of these gaps is large; as section 8.8 item 9 says, the turn is
common and the stock and the level are the edge.

**The 10 examples.** One per ticker, every one above its 200-day with RS 80+, every one reached 5R before the stop.
"Prior move" names the move that qualified it and whether it came from an earnings report (from `earnings()`:
Yahoo plus SEC 8-K dates) or from a gap on a day that was not an earnings reaction day (a news gap). Entry is the
close of the hourly candle named; stop is 3 cents under the session low at that point; best R is the 60-day high.

| # | Ticker | Signal day | Level | Prior move (and its cause) | Open vs prior close | Session low / prior close | Buy (candle) | Stop (risk) | Best R (days to 3R) | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | META | 2023-12-15 | 20-day EMA (328.52) | tight 10-day base above the 50-day, +5.4% best 5 days; no earnings or gap in the window | gap down -0.4% (331.80) | 331.66 / 333.17 | 336.42 (1st) | 331.63 (1.42%) | 39.1R (2) | A leader resting on its 20-day EMA; the open dips under the prior close, the first candle closes green above it, 3R in two days and a run to 470. |
| 2 | CEG | 2024-03-19 | 10-day EMA | +32.1% in 5 days to 03-04, started by the 02-27 earnings report | opened above (169.00), dipped through | 168.26 / 168.84 | 169.79 (1st) | 168.23 (0.92%) | 42.6R (1) | The classic "green to red to green": a shallow dip to the 10-day after a 30% earnings run, reclaimed within the first hour; 3R the next day. |
| 3 | NVDA | 2024-05-14 | 10-day EMA | +15.1% in 5 days to 04-26; no earnings (next report 05-22, 6 sessions after) | gap down -0.9% (89.60) | 88.94 / 90.40 | 90.69 (1st) | 88.91 (1.96%) | 28.2R (6) | A gap-down open bought back in the first hour, with the 10-day and 50-day lines just under the low; a 3.6% flag before it. Split-adjusted prices. |
| 4 | PLTR | 2024-10-02 | 10-day EMA | +17.3% in 5 days to 09-13 after the 09-09 gap of +7.8%, not an earnings reaction day (a news gap) | gap down -0.4% (36.30) | 36.15 / 36.46 | 37.18 (1st) | 36.12 (2.86%) | 44.7R (4) | A 4.2% flag on the 10-day, the morning dip reclaimed in candle one; risk 2.86% is near the A13 ceiling, size from the stop. |
| 5 | BE | 2025-07-18 | 20-day EMA (24.00) | +29.7% in 5 days to 07-09 after gaps of +11.1% (06-30) and +7.3% (07-09), neither an earnings reaction day (news gaps) | opened above (24.44), dipped through | 24.04 / 24.31 | 24.48 (1st) | 24.01 (1.92%) | 193.0R (1) | Deepest pullback of the ten (a 9.7% three-day range) to a rising 20-day EMA; the low prints 27 cents under the prior day's low and the first candle closes back over. 3R the next day. |
| 6 | WDC | 2025-08-22 | 20-day EMA (73.88) | +14.0% in 5 days to 07-31, the 07-30 earnings report | opened above (74.78), dipped through | 74.57 / 74.66 | 75.92 (1st) | 74.54 (1.81%) | 74.6R (2) | A 4.5% flag on the 20-day after an earnings move; a shallow undercut and a strong first candle, then a straight run from 76 to 130. |
| 7 | GOOGL | 2025-09-09 | prior day's low (233.67) | +12.0% in 5 days to 09-04 after the 09-03 gap of +7.0%, not an earnings reaction day (a news gap) | opened flat (234.15), dipped through | 233.23 / 234.04 | 236.31 (1st) | 233.20 (1.32%) | 29.7R (4) | The "bullish gap" level: three sessions after a 7% catalyst gap the stock dips under the prior low and close and is bought in the first hour. |
| 8 | VIAV | 2026-02-19 | 10-day EMA (within 3%) | +30.2% in 5 days to 01-30, the 01-28 earnings report and its +9.4% gap | gap down -1.4% (25.97) | 25.69 / 26.33 | 26.43 (2nd) | 25.66 (2.91%) | 44.2R (3) | The second-candle version: candle one is red and stays under the prior close, candle two closes green back above it. Risk 2.91%, at the A13 ceiling. |
| 9 | DELL | 2026-04-07 | prior day's low (172.79) | +23.3% in 5 days to 03-25, after the 02-26 earnings report (+13.1% gap) and a +4.3% gap on 03-20 | gap down -0.6% (172.24) | 172.22 / 173.18 | 175.49 (1st) | 172.19 (1.88%) | 89.1R (1) | Opens at the low, the first candle closes 1.3% above the prior close; 3R the next day and a move from 175 to 450 inside 60 days. |
| 10 | ILMN | 2026-09-11 | 50-day SMA (199.85) | +19.5% in 5 days to 08-25; the 07-30 earnings report is 29 sessions back | opened above (201.81), dipped through | 200.01 / 201.27 | 202.70 (1st) | 199.98 (1.34%) | 39.2R (2) | The 50-day version: a five-session slide to the 50-day, the low 16 cents above it, reclaimed in the first hour; 3R in two days (a 10x-volume day followed on 09-16, after the trade had already paid). |

Notes on the charts: the top panel is 110 sessions before and 40 after on daily bars with the 10- and 21-day EMAs and
the 50- and 200-day SMAs; the yellow box is the 3-session flag; the lines are the prior close, the stop, 3R and 5R.
The bottom panel is the hourly bars for the 4 sessions before and 3 after, the box the 3-session flag, the yellow
vertical line the entry candle. Numbers 2, 5, 6, 7 and 10 are the "opened at or above the prior close, dipped
through" shape; 1, 3, 4, 8 and 9 are gap-down opens (section 8.1.5, options b and c). Number 8 is the only
second-candle entry. Checked by eye on every chart: no ETFs, no reused tickers, no split breaks.

**Notable failures (in words).**
- **NVDA 2024-06-28**: everything qualified (10-day EMA, a 16% five-day move, a 7.4% flag, RS 98). It opened above the
  prior close (123.99), dipped to 123.42 and the first candle closed at 126.81, 2.3% up and already 2.7% from the
  stop. The reclaim was the high of the day: every later candle closed lower, the session closed at 123.54, under the
  prior close, and the stop (123.39) was hit the next morning. A big first candle widens the risk and leaves nothing
  to buy against; a close back under the prior close is the warning section 8.5 names.
- **TSLA 2025-05-30**: a 26% five-day move, a dip under the prior day's low (353.82 against a prior close of 358.43),
  a first candle closing green at 361.86. The third hourly candle broke back under the prior close and the fourth fell
  through the stop (353.79); the session closed at 346.46, 4.3% below the entry. The turn was real but the stock
  gave it back within three hours: the same-session stop that 23% of all hits took.
- **NVDA 2024-05-08**: a gap-down open (-1.2%) that reclaimed the prior close in the first candle (90.98), then spent
  the day drifting between 89.5 and 90.5, closed at 90.41 (under the prior close 90.55), and was stopped the next
  day at 89.39 for -1R. Best excursion 0.08R: a reclaim that does not follow through within the session is the
  "warning" of section 8.5 in practice, and the 10-day rule (C33) would never have been reached.

## 14. Failures and near-misses (from our data)

Added 2026-11-10 from the section 13 scan (`final/scan_go.py`, `final/hits.json`) and a one-gate-relaxed copy
(`final/near_scan.py`, `final/near_hits.json`: every session above the 200-day whose first hourly candle trades under
the prior close and that closes back above it by the third candle, with each gate recorded; kept when exactly one gate
fails; 963 of 963 names, 386 seconds). Same Yahoo hourly bars (9:30-anchored, so "candle 2" ends at 11:30). Charts in
`_study-resume/scratchpad/setups/42-go-signal/final/`: `fail_1..4_*.png` and `fail_1-4.png`, `near_1..4_*.png` and
`near_1-4.png` (daily context above the hourly turn, as in section 13), and the confusable pair
`pair_41-30-minute-pivot.png` (META above FTNT, the tell from the card). Buy = the close of the reclaiming candle; stop
= 3 cents under the session low so far; "where it stopped" is the hourly candle or the session.

**Failures: valid by every gate, stopped before 3R.** TSLA and NVDA 2024-06-28 are the dossier's own named failures.
A correction to section 13: on the hourly bars NVDA's stop (123.39) traded in the 12:30 candle of the signal day itself
(low 122.89), not the next morning; the next morning's low (118.83) came after.

| # | Ticker | Signal day | Buy (candle) | Stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|---|
| 1 | TSLA | 2025-05-30 | 361.86 (1st) | 353.79 (2.23%) | the same session, 12:30 candle (low 345.29), best 0.23R | A 26% five-day move, a 5.9% flag, RS 96; a dip under the prior day's low (353.82 against a prior close of 358.43) and a green first candle. The third candle broke back under the prior close, the fourth fell through the stop; the day closed 346.46. | go.after_entry_stop |
| 2 | NVDA | 2024-06-28 | 126.81 (1st) | 123.39 (2.69%) | the same session, 12:30 candle (low 122.89), best 0.11R | A 16% five-day move, a 7.4% flag, RS 99, the 10-day EMA; it opened above the prior close (123.99), dipped to 123.42 and the first candle closed at 126.81, 2.3% up. That candle was the high of the day; the session closed 123.54, under the prior close. | go.close_under_pc_warning |
| 3 | CRWD | 2023-12-29 | 64.04 (1st) | 63.39 (1.03%) | the same session, 10:30 candle (low 63.13), 0.0R | A 13% five-day move, a 2.3% flag, RS 97, the 10-day EMA; a gap-down open that reclaimed the prior close (64.03) by one cent at the close of the first candle. The next candle fell straight through the stop; the day closed 63.83 and the stock lost 6% in the next two sessions. | go.reclaim_close |
| 4 | GOOG | 2026-05-18 | 402.05 (1st) | 390.88 (2.78%) | the next session (2026-05-19, 9:30 candle, low 384.05), best 0.04R | A 14% five-day move, a 4.8% flag, RS 90; the first candle ran from 392.12 to 404.44, the high of the day, and every later candle closed lower; the day closed 393.15, under the prior close 393.32, and the open gapped through the stop. | go.close_under_pc_warning |

**Near-misses: look like a Go Signal, fail exactly one gate.**

| # | Ticker | Day | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | AXON | 2024-09-11 | go.reclaim_window | the close back above the prior close (359.35) came on the third hourly candle (361.39), after the two-candle window. Everything else passes: a 25% five-day move, a 6.6% flag, RS 94, the 20-day EMA, 1.94% risk. | A 30-minute pivot (setup 41), bought over the pivot candle's high, not at a candle close. It went on to 47.8R, which is the pivot's result. |
| 2 | SNOW | 2026-09-08 | go.hourly_flag | the 3 sessions before span 26.5%; the rule needs 10% or less. A gap-down open, a reclaim at the first candle at the 10-day EMA, 1.92% risk. | A red-to-green inside a wild post-earnings range, with no tight flag to buy against: a bare red to green (setup 43). Taken: 0.38R, then the stop. |
| 3 | CF | 2026-03-19 | go.at_support | the session low (126.55) sat 5.2% above the 10-day EMA, the nearest level; the rule allows 3% under to 1% over. A 23% five-day move, a 6.6% flag, RS 90. | A red-to-green in mid-air: no level was tested, so there is nothing to defend. Taken: stopped the same session at 0.0R. |
| 4 | CRS | 2025-11-14 | go.stop_width | the first candle ran from 315.73 to 329.02 after a 2.8% gap down, so the stop under its low is 4.96% from the entry; the rule says about 3%. The 10-day EMA, a 32% five-day move, RS 92. | A valid turn whose first candle was too big to buy at its close; size down from the stop (A5) or skip (A3). Taken: 0.53R, then the stop four sessions later. |

**What the failures have in common.** Three of the four were stopped inside the signal session, the same-session stop
that 23% of all hits take, and the fourth the next morning; none reached 0.25R. In three of them the reclaiming candle
was the high of the day (NVDA, GOOG) or a one-cent reclaim (CRWD): a big first candle widens the risk to the 2.7% to 2.8%
edge of the rule and leaves nothing to buy against, and a marginal one proves nothing. The context was as good as the
winners' (13% to 26% prior moves, RS 90 to 99, flags of 2% to 7%), so the chart before the open does not separate them;
what does is what the session did after the entry, which is why the card keeps a close back under the prior close as the
warning and the session low as the only exit.

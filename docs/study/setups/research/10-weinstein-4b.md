# Setup 10: the 4B Setup (Stan Weinstein), really the "4B-" (4B minus) (long)

Research dossier for the owner's setup-by-setup review. Written 2026-11-09. Every quote below was copied from the page,
PDF or file named next to it, and kept to 40 words or fewer. Nothing here is a ruling. Where I could not read a source,
I say so and give no wording from it. Numbers marked [my proposal] are mine, for the owner to accept or change.

**Cold check, 2026-11-09.** A second reader re-opened every source named here (the two GTA PDFs, both YouTube pages,
the archived TraderLion guide, the Deepvue post and its two images, the Deepvue pages, six stageanalysis.net pages, the
Trade2Win thread, both Bulkowski pages, all 103 UCT Substack posts, and the repo files), re-ran the app's stage code on
real prices, and tested the proposed rules on the two named examples (NFLX 2022, DXCM 2024). What was wrong is fixed in
place; what could not be confirmed is listed under "Removed in checking" at the end. Price checks use Yahoo Finance daily
bars (read with the `yfinance` library; NFLX prices multiplied by 10 to undo its 10-for-1 split of November 2025).

Tags used in section 8: **[originator]** Stan Weinstein's own words or his own newsletter; **[originator via
TraderLion]** TraderLion's description of what Weinstein says in its 2026 clip (their summary, not his quoted words);
**[vendor]** Deepvue or TraderLion speaking for themselves (both are Weinstein's commercial partners);
**[practitioner]** stageanalysis.net, an independent Stage Analysis site; **[source consensus]** at least two of the
above agree; **[UCT]** UCT's own writers or the owner; **[house rule]** the account rulebook,
`docs/study/sizing_rule.md` section 9; **[my proposal]** my recommendation.

**The short version.**
- "4B" is Weinstein's own code, but it is a stage rating, not a buy. In his newsletter's legend, plain 4B means "Late in
  downtrend. Much too soon to consider buying." The long setup is **4B-** ("4B minus"): late in the decline, but the
  bottom is probably in.
- The code comes from his institutional newsletter, the **Global Trend Alert** (GTA), not (as far as I could check) from
  his 1988 book. I did not have the book's text, so that last point is not verified against the book.
- Weinstein now teaches the 4B- as a trade in TraderLion interviews (recorded 2024-11-13). TraderLion (which sells his
  course and his newsletter) and Deepvue (a screener company co-founded by TraderLion's Nick Schmidt, whose stage tools
  it says were built with Weinstein) published the only criteria lists. They are short and partly second-hand.
- It collides with house hard rule **B26**: a 4B- stock nearly always sits below a falling 200-day line, and B26 allows
  no longs there except parabolic ones. Both named examples were far under it at the entry (checked on prices: NFLX on
  2022-07-18 about 54% under its 200-day, DXCM on 2024-11-13 about 30% under), and Deepvue's NFLX entry came one to two
  sessions before an earnings report, which B22 forbids. Section 8 proposes a house version that respects B26; 8.10
  shows how the proposed tests treat the two examples.
- No one has published statistics for the 4B- itself. The nearest measured evidence (Bulkowski) says buying in Stage 4
  was his worst result and buying in Stage 1 his best. A 4B- sits on the line between them.

---

## 1. What it is, and the psychology

**In two sentences.** A 4B- is a stock late in a long Stage 4 decline that has stopped making new lows, built a small
base with a higher low, and climbed back above its 50-day (10-week) average; Weinstein tags it 4B- to say he thinks the
bottom is in, even though it is not yet officially in a Stage 1 base. The trade buys that reclaim (or the break of a
short pause above the 50-day) for a fairly quick move, with the stop under the recent low.

**Weinstein's own words on what the minus means** (as quoted in TraderLion's video description, see 2 and 3.3): "When I
put a minus after the 4B, I'm saying that's my nomenclature to tell you that I think you've reached the bottom."

**Why it can work (the psychology).** These points are my reasoning from the sources, not measured facts.
- Sellers run out. After months of decline, most holders who wanted out have sold. The higher low says the next wave of
  sellers was smaller than the last. Deepvue's checklist names this: "Decreasing downside momentum/volume".
- Shorts are trapped. Late shorts pressed a stock everyone "knew" was broken. When price gets back over the 50-day, the
  short-term trend that justified the short is gone, and covering adds fuel. Deepvue: Weinstein caught NFLX "when
  sentiment was bearish".
- Early buyers return. Funds that want the stock start building a position in the base. A reclaim of the 50-day is the
  first public sign that buyers are now in charge of the short-term trend.

**Why it often fails (also reasoning).**
- Overhead supply. Everyone who bought on the way down is under water. They sell into rallies to get out near even,
  which is why the declining 30-week and 200-day lines, and old breakdown levels, act as ceilings.
- Stage 4 can simply resume. Weinstein's whole method says not to own Stage 4 stocks; TraderLion's guide quotes him: "As
  Stan Weinstein advises, “take the oath” never to hold a stock in Stage 4." A 4B- is a bet that the stock has just left
  Stage 4, before the usual proof (a Stage 2A breakout) exists.
- So the sources frame it as a short-term trade, not an investment (TraderLion: "short-term plays"; Deepvue: "capture
  quick momentum, sell, and move money elsewhere").

---

## 2. Origin and naming

**Stage Analysis.** Stan Weinstein's four stages (1 basing, 2 advancing, 3 topping, 4 declining) come from his 1988 book
*Secrets for Profiting in Bull and Bear Markets*. TraderLion's guide also names his earlier newsletter: "He shared these
insights through his newsletter, The Professional Tape Reader, and later in his 1988 book" (Nick Schmidt, TraderLion,
2024-10-18). I did not read the book itself.

**The A/B/+/- sub-stage codes are Weinstein's, from the Global Trend Alert.**
- The March 2005 GTA ("Volume 16, Issue 3"; a forum-posted copy, see section 11) prints a legend of twelve stages, 1A to
  4B, plus four modifiers: "(A) Early in that Stage.", "(B) Late in that Stage.", "(+) Outstanding pattern in that
  Stage." and, with a minus sign, "Unexciting pattern in that Stage." Its line for 4B reads "Late in downtrend. Much too
  soon to consider buying." It has no separate line for 4B-, but it rates four S&P 500 stocks "4B-" (ADI, CHIR, INTU,
  MEDI) in its S&P 500 stage table (pages 8 to 13; the issue's data stamp on page 7 reads "[2/25/05; DJI close:
  10,841.06]"). So in 2005, 4B- read literally as late in the decline, with an unexciting (less bearish) Stage 4 pattern
  (my reading of the legend).
- The specific 4B- sentence, "Although not yet 'officially' in Stage 1A, stock has now seen its low for the cycle.", is
  printed by stageanalysis.net (2019-10-01) under the heading "The four stages and sub-stages definitions from Stan
  Weinstein's Global Trend Alert". The earliest dated appearance I found is a Trade2Win forum post of 7 March 2012 (post
  #327, "Stage 4B- Examples"), written the day after the same poster said Weinstein had let him see "the most recent
  report" (post #326). The thread's first post carries the full sentence too, but that post was edited later, so its
  date proves nothing. Forum; a pointer, not a source I rely on.
- Weinstein's own explanation, recorded 2024-11-13 and clipped in 2026: the minus says "I think you've reached the
  bottom" (full quote in section 1).

**Is "4B" in the 1988 book?** Not verified. A Trade2Win member who had read the book and the 2005 GTA wrote on
2011-10-07 (post #19) that "the four stages now have extra definitions with A, B, + and - symbols", calling the GTA "an
important update to the book" (forum, low reliability). A search engine's summary of stageanalysis.net forum pages (which
I could not open) says the same; I do not rely on it.

**Who made it a "setup".** The step from rating to trade is recent and comes from the TraderLion and Deepvue circle.
TraderLion sells Weinstein's course (the "Stage Analysis Masterclass", announced 2022-07-12) and his newsletter (the sales
page's metadata says it was first published 2024-10-03; the archived copy lists $2,500 a quarter):
- TraderLion interview, published 2024-11-15 ("This was recorded the night of 11/13"), chapter titled "The 4B- trade
  setup: How to find bottoming stocks with big upside".
- TraderLion guide (Nick Schmidt, 2024-10-18): "For more advanced traders, Stage 4B offers a potential setup for
  short-term plays, which is covered in our Stage Analysis Masterclass with Stan."
- Ameet Rai on X, 2024-12-18 (his X bio: "Building @Deepvue • Co-Author The Trader's Handbook"): "A Stan Weinstein 4B-
  Setup goes into a Relative Strength Phase".
- Deepvue on X, 2025-04-23 (UTC): "The 4B- reversal setup is a powerful pattern that signals a stock's potential shift from
  downtrend to uptrend."
- TraderLion Clips video, uploaded 2026-04-03: "The 4B-Minus Setup", subtitled "Stan Weinstein Explains His Signature
  Bottoming Pattern".

**Other names.** "4B-minus", "4B minus", "4B- reversal" (Deepvue), "4B- Setup" (Ameet Rai), and UCT's journal tag
"4B Setup (Stan Weinstein)". Deepvue's 2024 page calls a stock that is "retaking key moving averages like the 50-day MA"
Stage **1B**, but in context that is a stock already basing in Stage 1 (whipsawing around the 30-week line), so it is a
later moment than the 4B-, which comes before Weinstein calls Stage 1 at all (see 3.13).

**Not to be confused with.** UCT's tag list also has "2B Reversal"; it is a different setup and the "B" letters are
unrelated. Deepvue also offers a "Stockbee 4% Breakouts" indicator; also unrelated.

**Naming problem for our tag.** Our tag says "4B", but plain 4B in Weinstein's legend is the stage where it is "Much too
soon to consider buying." The long setup is 4B-. See question 1 in section 10.

---

## 3. Every definition I could find, source by source

### 3.1 Stan Weinstein, Global Trend Alert, March 2005 (originator; primary; forum-posted copy)

- **What it is.** A rating, not a trade. Legend: "Stage 4B Late in downtrend. Much too soon to consider buying." The
  minus modifier: "Unexciting pattern in that Stage." Stage 4 itself: "The Declining Stage. Avoid on the long side."
  Stage 1A: "Start of a base. Needs much more time."
- **How often.** In the S&P 500 stage table (my count from a text extraction; a second count by the checker matched):
  500 ratings; 30 rated 4B; 4 rated 4B-. The issue's own overview box puts 16% of the S&P 500 in Stage 4. In the
  secondary-stocks table (pages 27 to 30, which the issue itself names as its Secondary Stage Ratings): DV, KCP, TOM and
  SNPS rated 4B-. (Netflix, NFLX, was plain 4B in that table.)
- **Buying in that issue.** None of the 4B- names is in the "Most Promising" buy list. The buys are of three kinds (the
  checker's rough tally of pages 14 to 17: about 14 pullback buys, 10 "close above" buys, 2 "crossing" buys). On a close
  above a level, sometimes the close that moves a stock into Stage 2A: "A close above 30.40 will move NVLS into Stage 2A
  and would be the signal to do buying." And: "Do additional buying on a close above 51.05 (as that will now complete a
  head-and-shoulder bottom formation, moving KLAC into Stage 2A)." Intraday: "Buy crossing 60" (Lowe's). And pullback
  buys in an existing Stage 2 uptrend ("Do additional buying on pullbacks").
- **Stops in that issue.** Usually two stops per buy, a "trading sell stop" and a wider "investing stop", mostly at x.99
  or x.49: e.g. Bank of America, "Do buying on a close above 47.50, and protect with a 44.99 trading sell stop and a
  43.99 investing stop." Some buys carry one "protective sell stop" (Centerpoint Energy, 10.49), and not every stop sits
  under a round number (Novellus, 27.79).
- Source: GTA, Vol. 16 Issue 3, March 2005, page 1 (masthead), page 7 (data stamp), page 8 (legend), pages 8 to 13 (S&P
  table), pages 14 to 17 (Most Promising S&P buys) and 27 to 30 (secondary table). Page numbers are the printed footers.
  PDF attached to Trade2Win post #2 of 2011-09-15; the file holds 30 printed pages (it is "Part 1").

### 3.2 Stan Weinstein, Global Trend Alert, 6 October 2024 sample (originator; primary; public sample)

- TraderLion posts this weekly report and its buy list as a public sample. The spreadsheet's first text string (after
  the sheet name) reads "From: Stan Weinstein".
- **Entries** are mostly on a close above a level (about 63 of the roughly 106 "Most Promising" entries, by the checker's
  count; the rest are buys on pullbacks toward support): AKRO "closing above 30 with a 25.99 trading sell stop and a 22.69
  investing stop".
- **Stops**: usually a tighter "trading" stop and a wider "investing" stop (some names get one "sell stop"), mostly just
  under whole or half numbers (x.99, x.49), sometimes not (AB 32.89, AUPH 6.69, ABEO 5.29).
- **Stage rule**: "you avoid (on the long side) the many Stage 3&4 issues that we remain bearish on."
- No 4B- wording in the sample text.
- Source: TraderLion-hosted PDF "10_06_24-Global-Trend-Alert-weekly-update.pdf" and "10_06_24-GTA-BUYS.xls".

### 3.3 Stan Weinstein in TraderLion's 2024 interview and 2026 clip (originator, through TraderLion's description)

- The clip's description (written by TraderLion) lists his criteria: "sharp decline, room to run, base formation, and
  recapture of the 50-day moving average". It says he walks through "a live Dexcom chart".
- His quoted words: "When I put a minus after the 4B, I'm saying that's my nomenclature to tell you that I think you've
  reached the bottom."
- The full interview's chapter list also has "Why he exits stocks faster today than in the 1980s".
- **Not read:** the video itself (the clip runs 3 min 59 s; in the full interview the 4B- chapter starts at 23:46). The
  page lists an auto-generated English caption track, but the caption request returned an empty file, so I quote only
  the description. No stop, trigger detail or target from Weinstein himself is recorded here.
- **The DXCM chart he used, checked on prices** (close of 2024-11-13, the recording night): 72.53, above the 50-day
  (69.77) for a third straight close; the 150-day at 94.82 and falling (103.51 twenty sessions earlier); the 200-day at
  103.12; the cycle low 62.34 on 2024-07-26 (a gap-down day); about 49% under the 52-week high. So
  Weinstein's own example was a 50-day reclaim far under falling 30-week and 200-day lines.
- Sources: YouTube, TraderLion Clips, uploaded 2026-04-03 (video dUFXdDm3njo); TraderLion, "+200% in 40 Days - Stage
  Analysis in Modern Markets - Exclusive Interview with Stan Weinstein", published 2024-11-15 (video Mef5ef9DbwM).
- A viewer's notes on X (Wey How, 2024-11-18) summarise the same segment as "A walkthrough on a 4B minus stock
  (Dexcom)" and "late stage 4, with some base formed, room to trot". The same notes report, as Weinstein's adaptation
  for today's markets, "get off quicker if a stock breaks 50-sma". Viewer notes; a pointer only, not his verified words.

### 3.4 TraderLion, "The Complete Guide to Stan Weinstein's Stage Analysis" (Nick Schmidt, 2024-10-18) (educator)

- 4B as a trade: "For more advanced traders, Stage 4B offers a potential setup for short-term plays, which is covered in
  our Stage Analysis Masterclass with Stan."
- The classic warnings in the same article: "Always wait for a clear Stage 1 base before considering buying again." And:
  "If the moving average is still sharply sloping downward and the stock is trading far below it, the stock has likely
  not yet entered a true Stage 1."
- Averages: "the 30-week (150-day) and 40-week (200-day) moving averages"; "the 10-week moving average (which is the same
  as the 50-day moving average)".
- Breakout volume (for the classic Stage 2 buy, not 4B-): "You want to see the stock trading at least twice its average
  volume over the past 30 days."
- The author's line: "Nick Schmidt is a co-founder of TraderLion and Deepvue".
- Read through the Internet Archive copy of 2025-11-13, because the live page refused the request (HTTP 403). A search
  engine's index shows the same 4B sentence.

### 3.5 Deepvue on X, 2025-04-23 (vendor; Weinstein's partner)

- Criteria, list one: "Stock must be in Stage 4 downtrend first"; "Form of a higher low (critical signal)"; "Relcaim
  [sic] of 50-day MA"; "Flattening 50-day MA slope"; "Consolidation above the 50-day".
- Criteria, list two: "Clear Stage 4 downtrend prior"; "Form of a higher low (critical indicator)"; "Reclaim of the 50-day
  moving average"; "Decreasing downside momentum/volume".
- Holding: "you can use the 4B- reversal setup to capture quick momentum, sell, and move money elsewhere."
- Example: "Stan captured $NFLX perfectly with this setup when sentiment was bearish." Then: "The stock surged from $189
  to $250 in only a couple of weeks following the 4B- entry." The attached chart (NFLX daily; the year is not printed,
  but the price path matches 2022 in the data) is labelled "Stage 4", "Higher low with consolidation above 50D" and
  "Break above 50DMA", with a measured box reading "62.19 (32.77%)", that is, from about $189.8 to about $252. The "Break
  above 50DMA" arrow points a few bars before an earnings ("E") marker. On prices: NFLX closed back over its 50-day on
  2022-07-15 (189.11) and 2022-07-18 (190.92); Netflix reported after the close on 2022-07-19 (its Form 8-K is dated
  that day); the big gap came on 2022-07-20. So the $189 "4B- entry" was bought one to two sessions before the report.
- When: "applicable in the current market (after most stocks have been downtrending)".
- Screen: "Price > $15", "Average 20D volume > 500,000", "Float < 150M shares", "Stage 4B-" (the screenshot showed 52
  results that day).
- No stop and no target given.

### 3.6 Deepvue, "Stan Weinstein Stage Analysis" page (last updated 2024-07-26) (vendor)

- "Stan Weinstein’s original strategy relied on weekly charts paired with the 30-week moving average which roughly
  correlates with the 150-day simple moving average."
- "As the markets have evolved, Stan has more recently noted the importance of using the 50-day moving average as a key
  reference point for any stock."
- "Once a stock shows signs of breaking out, such as large upward reversals or retaking key moving averages like the
  50-day MA, it enters Stage 1B, which precedes Stage 2." The sentence before it describes a stock already in Stage 1,
  whose price "will whipsaw up and down around the 30-week moving average", so this 1B is a later moment than a 4B-.
- "During a Stage 4 Decline there is no reason to be long the stock".
- On its tools: "Our screener and indicator were developed in close collaboration with Stan Weinstein himself." Deepvue's
  help page for the indicator does not say how it computes 4B-.

### 3.7 stageanalysis.net: the definitions page (2019-10-01) and the screener's mechanical stages (2025-01-25) (practitioner)

- Definitions page (GTA wording): "Stage 4B Late in downtrend. Much too soon to consider buying." and "Stage 4B-
  Although not yet 'officially' in Stage 1A, stock has now seen its low for the cycle."
- Screener rules (the site's own mechanical version, not Weinstein's): "Stage 4A (First breakdown week since previous
  Stage 2)"; "Stage 4- (above 10 week MA)"; "Stage 4B (in Stage 4 for 39 weeks or more)"; "Stage 4B- (and above 10 week
  MA)". So in this screener, 4B- = in Stage 4 for 39 weeks or more AND above the 10-week average.
- Mirror on the other side: "Stage 2B- (and below 10 week MA)".

### 3.8 stageanalysis.net, "Learn: How Stocks Transition From the Stage 4 Declining Phase to the Stage 1 Basing Phase" (2022-07-12) (practitioner)

- The common mistake: buyers "get in too early while the characteristics of the chart are still unfavourable. i.e. a
  small base following a large Stage 4 decline, price still under declining moving averages".
- Early Stage 1 relative strength: "Relative strength versus the S&P 500 will usually be still below a declining Zero
  Line (52 week RS MA)".
- Failure: "following a long Stage 4 decline, the majority will need a long time for a Stage 1 base to develop, which
  may even fail and drop back into Stage 4 once more."
- It is not about 4B- by name; it describes the same zone. Its worked example (LUV, early 2012) had a 200-day "still
  steeply declining and above the short and medium-term MAs".

### 3.9 Ameet Rai on X, 2024-12-18 (trader; Deepvue)

- "A Stan Weinstein 4B- Setup goes into a Relative Strength Phase, which turns into an early Stage 2A, which then leads to
  a Consolidation Pivot breakout & Stage 2, and eventually a traditional base breakout."
- "4B- has become a go-to to get in on fundamentally strong names earlier and add along the way."
- Note: "add along the way" conflicts with house rule A5 (no adding).

### 3.10 Weinstein's book rules for the classic buy, as reported by others (context, not 4B-)

These are the Stage 2A rules the 4B- trade is an early cousin of. I did not read the book; these are other people's
readings of it.
- Volume: stageanalysis.net Q&A (2019-10-01): "The book specifies two times the four week average".
- Bulkowski's reading ("Trading Weinstein", 2023-10-25): the stop at the lower of the 30-week average (below the
  closest minor low) or a penny below the closest minor low, and "Is the distance from the initial stop location more
  than 20%? If so, then don't trade it." Also: "Avoid round numbers like 10.00 or 20.00. Place a stop below (by 7 cents)
  the round number." The page introduces its rules with "Here's my interpretation of his setup." and cites no book page
  for the 7 cents, so treat it as Bulkowski's rule, not Weinstein's. (Read through a fetch tool.)
- The "forest to the trees" order (market, then group, then stock) is quoted by stageanalysis.net as from page 75 of the
  book: "Which few groups look the very best technically?" (page number not verified by me).

### 3.11 UCT's writers (details in section 6)

UCT never uses "4B" in its public posts. Its closest read in shape: RDDT (Sunday Scans, 2025-11-30, in the owner's own
TSDR section), "early to bottom having not made a new low", "surfing the 30wkMA (Stan Weinstein)", "remounted all MAs",
"two tight rest days above the 50SMA", stop at the 50-day. But on prices RDDT was not in Stage 4: it sat above a rising
30-week line and above its 200-day, about two months after an all-time high, so it reads as a Stage 2 pullback to the
30-week line rather than a 4B- (details in section 6).

### 3.12 Comparison table

| | Weinstein GTA (2005, 2012 wording) | Weinstein via TraderLion clip | TraderLion guide | Deepvue X post | Deepvue page | stageanalysis.net screener | Ameet Rai | UCT (RDDT, 2025-11-30) |
|---|---|---|---|---|---|---|---|---|
| Prior trend | Stage 4, late ("B") | "sharp decline" | Stage 4 | "Clear Stage 4 downtrend prior" | Stage 4 then base | Stage 4 for 39+ weeks | not stated | "one of the first leaders and growth stocks to decline" |
| Shape | low for the cycle is in | "base formation" | not stated | higher low ("critical"); consolidation above the 50-day | "large upward reversals" (for 1B) | none | not stated | no new low since a date; two tight days |
| Length | not stated | not stated | not stated | not stated | not stated | 39+ weeks in Stage 4 | not stated | about 3 weeks since the low (11/7 to 11/30) |
| Depth | not stated | "sharp" | not stated | not stated | not stated | none | not stated | not stated |
| Volume | not stated | not stated | not stated | decreasing on the way down | not stated | none | not stated | not stated |
| Averages | not stated (only "not yet 'officially' in Stage 1A") | "recapture of the 50-day" | 30-week, 10-week = 50-day | reclaim of the 50-day; 50-day flattening | 50-day retake (in Stage 1, as 1B) | above the 10-week | not stated | "surfing the 30wkMA" (a rising one, on prices); above all averages |
| Relative strength | not stated | not stated | not stated | not stated | not stated | none | followed by an "RS phase" | not stated |
| Trigger | none (a rating) | not recorded | not stated | "Break above 50DMA" (chart) | not stated | none | not stated | not stated |
| Entry style | GTA buys: on a close above a level, "crossing" it, or on pullbacks toward support | not recorded | not stated | not stated | not stated | n/a | early, then add | not stated |
| Stop | GTA style: usually a trading and an investing stop, mostly at x.99 / x.49 | not recorded | not stated | not stated | not stated | n/a | not stated | 50-day; $198 "worst case" |
| Target / hold | n/a | not recorded | "short-term plays" | "capture quick momentum, sell" | n/a | n/a | ride into Stage 2 | not stated |

### 3.13 Where the sources disagree

1. **Is it a buy at all?** In the 2005 GTA, 4B and 4B- are ratings and buys come later, in Stage 2 (often at the move
   into 2A). In 2024 to 2026
   Weinstein and TraderLion treat 4B- as a trade. The same TraderLion guide that offers "Stage 4B" as a setup also says
   "Always wait for a clear Stage 1 base". Deepvue's page says there is "no reason to be long" in Stage 4. Read
   together: it is an exception for advanced, short-term trading, outside the classic investor method.
2. **"4B" or "4B-"?** TraderLion's guide writes "Stage 4B"; Weinstein, Deepvue and Ameet Rai write "4B-". Weinstein's
   own legend says plain 4B is "Much too soon to consider buying". The minus is what makes it a buy candidate.
3. **What label for a 50-day retake after a decline?** Deepvue's 2024 page calls a 50-day retake by a stock already
   basing in Stage 1 "Stage 1B". Deepvue's 2025 post calls a 50-day reclaim straight out of Stage 4 a 4B-.
   stageanalysis.net's screener calls a stock above its 10-week line 4B- only if it has been in Stage 4 for 39+ weeks,
   otherwise 4-. The difference is where the stock sits: before a Stage 1 base (4B-) or late in one (1B).
4. **What qualifies as the decline?** Depth ("sharp decline", Weinstein via TraderLion) versus time (39+ weeks,
   stageanalysis.net). No source gives a number for depth.
5. **Must there be a higher low?** Deepvue says yes ("critical"). stageanalysis.net's mechanical 4B- does not test one.
   TraderLion's summary of his criteria says "base formation", which usually means one, but he is not quoted on it.
6. **Weekly or daily?** Classic Stage Analysis is weekly (30-week line). The 4B- trigger in every modern source is the
   daily 50-day (or its weekly twin, the 10-week).
7. **Hold short or long?** TraderLion and Deepvue: a short-term play. Ameet Rai: the first step of a ride into Stage 2,
   adding along the way.
8. **Where is the stop?** No source on the 4B- gives one. GTA practice is usually two stops, mostly at x.99 / x.49.
   The owner's RDDT note uses the 50-day.

---

## 4. Measured evidence

**For the 4B- itself: none found.** I looked on Bulkowski's thepatternsite.com, stageanalysis.net, Deepvue, TraderLion,
UCT's Substack and the web at large. No success rate, average move or failure rate for a 4B- has been published that I
could find. The writer ran no test (no price data in that session). The checker did not run a statistical test either;
it only checked the two named examples on Yahoo Finance daily bars (section 8.10). Two examples are not evidence of an
edge.

**Nearest evidence 1: Thomas Bulkowski, "Four Stages of Price Movement" (thepatternsite.com/Stages.html).**
- Notice: the site states "This website, in whole or in part, shall not be used to train artificial intelligence (AI)
  systems". Read and cited here for research with a link and short quotes.
- Method: "I logged 440 buys and 444 sales from April 1987 until February 2010." He mapped each of his own trades to the
  stage it happened in.
- Results (text, exact): "For example, I found that buys occurring in stage 1 made 13.2%." And: "For example, 69.3% of
  the stage 1 buys were profitable while just 24.41% of those stocks bought in stage 4 made money."
- Results (his table, as returned by the fetch tool, not copied by me from the page): buys in Stage 1, +13.2% average,
  127 trades; Stage 2, +4.1%, 116, 56.9% profitable; Stage 3, -5.9%, 69, 14.5%; Stage 4, -8.3%, 127, 24.4%. Best pair:
  buy in Stage 1 and sell in Stage 2, +25.9% from 62 trades.
- Limits: one trader's own discretionary trades; he assigned the stages himself, after the fact; no split for 4B- or
  for a call that the low is in; the period ends in 2010. It does say the stage a buy happens in matters a lot, and that Stage 4
  buys were his worst. A 4B- buy is technically still Stage 4, so the burden of proof is on the setup.

**Nearest evidence 2: Bulkowski, "Trading Weinstein" (2023-10-25).** A test of the classic Stage 2A breakout buy, not
the 4B-.
- Same AI notice: "shall not be used to train artificial intelligence (AI) systems, technologies, large language models,
  or similar systems."
- Table 1 (as returned by the fetch tool): in sample (2000 to 2011), average gain 6%, median 6%, win/loss ratio 75%,
  maximum loss -22%, 448 trades; out of sample (2011 to 2023-10-24), 5%, 6%, 74%, -20%, 330 trades; about 451 stocks.
- His own caution on the win rate: "Waiting for a profit before selling allows the setup to have a high win/loss ratio
  but it pulls down the average gain."
- On the market filter (as returned by the fetch tool): "I tested each rule individually and found that they add value
  except for the market trend." One tester, one setup; our market filter (B18) stays a house rule regardless.
- Limits: a different setup; his own coding of Weinstein's rules.

**Anecdote, not a statistic: Deepvue's NFLX example** ("from $189 to $250 in only a couple of weeks"). One example, picked
after the fact, by a vendor that sells the screen. Checked on prices: closes of 189.11 (2022-07-15) and 190.92
(2022-07-18) back over the 50-day; first trade at $250 on 2022-08-11 (high 251.62), 18 to 19 sessions (about four
weeks) later, not "a couple of weeks"; no close reached $250 until 2022-10-19. Most of the move came from the earnings
gap of 2022-07-20 (close 216.44, from 201.63).

**Descriptive only: the 2005 GTA.** Under 1% of the S&P 500 (4 of 500) carried a 4B- rating that month (my count,
re-counted by the checker). It shows the rating was rare, not how those stocks did.

**Qualitative: stageanalysis.net, "40 Years of Stage 4 Lows in the Nasdaq Composite" (2022-06-16).** Charts of index
lows, with the claim that "capitulation is not how most have ended". About indexes, not single stocks; no numbers.

---

## 5. Our app: what exists, and what looks wrong

### 5.1 There is no 4B scanner

- No detector for 4B or 4B- exists in `api/services/pattern_engine/detectors/` (searched for "4B" and "Weinstein"; the
  name Weinstein appears only in other detectors' text: stage analysis, golden cross, death cross, bull flag and
  higher-low continuation).
- No Model Book card: `app/src/pages/modelbook/setupCatalog.js` has no 4B, Weinstein or stage entry.
- The journal tag: `app/src/constants/setupGroups.js` lists `'4B Setup (Stan Weinstein)'` in the Swing group, between
  'News Gappers' and 'Failed H&S/Rounded Top'. No definition goes with it.
- Family: `app/src/pages/journal-2-0/lib/setupTagMap.js` puts it in **'Bases & Breakouts'** (`TAXONOMY_ONLY_FAMILY`).
  Every source treats it as a bottoming reversal, so 'Reversals & Reclaims' fits better (question 7).
- Course plan: `docs/study/UNITS-method.md` lists it among names with "no unit; owner may add later".
- Vocabulary: `docs/wisdom/vocabulary/setup-vocabulary-v1.json` has no entry ("the authors did not name it").
- Trade plan: not in `docs/study/TRADE_PLANS.md`. Owner rulings: none in
  `docs/study/audits/2026-10-24/owner_verdicts.jsonl`.
- The screen builder's note (`app/src/components/chart/engine/ast/starterScans.json`, `_ungrounded`) explains why no
  starter scan exists: it is "a STAGE call", the screener's `stage2`/`stage4` flags are excluded from the formula table,
  and "nothing anywhere measures the 30-week line". That last part is too strong: the pattern engine does compute a
  150-day line (the 30-week stand-in) in `_trend_stage` (5.2). The rest of the note is right.

### 5.2 The app's stage code, and why it cannot see a 4B-

**`api/services/pattern_engine/detectors/structure/stage_analysis.py`** wraps `_trend_stage()` in
`api/services/pattern_engine/primitives/context.py`. The rule, faithfully:
- With 200+ bars: the long line is the **150-day SMA**; the slope compares the last close with the close 49 bars earlier
  (the first of a 50-bar window): "rising" if more than 2% higher, "falling" if more than 2% lower (`_slope_sign`). With 50 to 199 bars it uses a 50-day SMA and a
  20-bar slope.
- Rising and price above: Stage 2. Falling and price below: Stage 4. **Rising and price below: Stage 1. Falling and
  price above: Stage 3.** Flat: Stage 1.
- No sub-stages (no A, B, + or -).

What looks wrong for this setup (checked by running `_trend_stage()` itself on real daily bars):
- **The slope test compares two closes, so it measures price change, not the slope of the average.** "Rising" and
  "falling" in the branches below mean the close versus the close 49 bars earlier, never the 150-day line's slope.
- **A 4B- reads as Stage 4, then flips to Stage 1, with nothing in between.** A real 4B- sits far under the 150-day,
  so the code's choice is only Stage 4 (close more than 2% under the close 49 bars back) or Stage 1 (anything else).
  Dates checked: NFLX is Stage 4 on 2022-05-12, 06-14, 07-07 and 07-15 (close 189.11, 150-day 340.40), and Stage 1 on
  07-18 (close 190.92, 150-day 337.60), 07-19, 07-20 and 08-15. DXCM is Stage 4 on 2024-08-05 and 10-01, and Stage 1 on
  10-25, on the recording night 11-13 (close 72.53, 150-day 94.82, falling), 11-14 and 12-31. So the app calls these
  stocks Stage 1 earlier than Weinstein would ("not yet 'officially' in Stage 1A") and cannot tell a 4B- from a real
  Stage 1 base. It does not label them Stage 3 (an earlier draft of this dossier
  said it did; that was wrong).
- The Stage 3 branch needs price above the 150-day while the close is more than 2% under the close 49 bars back. That
  catches a Stage 2 stock in a sharp pullback above its 30-week line, not only a top.
- TraderLion's Stage 1 is a "flattening 30-week moving average" after a decline; the code never measures that line's
  slope, despite its docstring ("flat 30-week SMA, price near it").

**The screener and breadth "Weinstein Stage 2" and "Weinstein Stage 4" flags** (`api/services/breadth_live.py`;
descriptions in `api/services/breadth_metrics.py`; filters in `api/services/screener/filters.py` lines 833 to 834):
- Stage 2 = price above the 50-day, 50 above 150, 150 above 200, and the 200-day higher than 21 sessions ago. Stage 4 =
  the mirror.
- This stacked test is not how any Weinstein source I read defines a stage (they read one 30-week line, its slope and
  price against it), yet the filters are labelled "Weinstein Stage 2" and "Weinstein Stage 4".
- A 4B- (back above its 50-day) fails the Stage 4 test by construction, so a scan for Stage 4 plus a 50-day
  reclaim cannot be built from these flags. Checked: the same test reads NFLX as Stage 4 on 2022-05-12 and 06-14, and
  not Stage 4 on 07-07 (its first close over the 50-day) or on the entry days 07-15 and 07-18; DXCM is Stage 4 on
  2024-10-01 and not on 2024-11-13.

### 5.3 Other "Weinstein" claims in the app that I could not verify, or that disagree with the sources

Not about the 4B-, but the course should not reuse them until checked:
- `app/src/constants/quotes.json` lines 128 to 132 carry five "Stan Weinstein" quotes credited to the 1988 book (for
  example "Stage 2 is the only place to be long. In Stage 1 you wait. In Stage 3 you exit."). I found none of them in
  any source I read. I could not check the book. Treat them as unverified.
- `api/services/pattern_engine/detectors/classical/golden_cross.py` calls the 30-week average "the daily-bar equivalent
  of the 200-day MA". Deepvue and TraderLion both say 30 weeks is about 150 days and 40 weeks about 200. The same file
  says "Weinstein empirically found the highest-edge entry comes within the first 5 bars of the confirmed cross" and
  that Stage 2 "historically produces 80% of a stock's long-side gains". I found no source for either.
- `api/routers/patterns.py` describes "Pullback to 200-SMA (Weinstein Stage 2 Retest)" as "Weinstein's institutional
  reentry zone after ≥40% prior gain". I found no source for the 40%.
- `api/services/pattern_engine/detectors/classical/death_cross.py` (missed in the first draft; it touches this setup)
  says the book "identifies this as the archetypal Stage 4 transition signal", that "Weinstein documented" that Stage 4
  declines after a death cross "produce the most sustained and largest drawdowns", and that "a close above the 50-day MA
  after a confirmed Death Cross re-invalidates the Stage 4 thesis". I found no source for any of the three. The last one
  is close in spirit to the 4B- (a 50-day reclaim), but it is the app's text, not Weinstein's.

---

## 6. UCT's own words

**No UCT post uses "4B" or "4B-".** I read all 103 posts in https://unchartedterritoryy.substack.com/sitemap.xml
(Sunday Scans, The Rest of the Week, The Parabolic Short and others) on 2026-11-09. Bracco's "The Parabolic Short" has
nothing on stages. What UCT has written that touches the same ground:

**Sunday Scans, 2025-11-30, RDDT** (byline "Uncharted Territory";
https://unchartedterritoryy.substack.com/p/sunday-scans-422). The note sits under the heading "TSDR's Weekly Outlook &
Watchlist", so these are the owner's own words. The closest thing in shape to a 4B- read in UCT's writing:
- "Now, it is early to bottom having not made a new low since 11/7. If you pull up the weekly (not pictured) it is just
  surfing the 30wkMA (Stan Weinstein)."
- "On the daily here it notably remounted all MAs and put in two tight rest days above the 50SMA. $198 should hold in a
  worst case scenario but ideally we use the 50SMA as a stop."
- He traded it: "RDDT bought smaller than I would have liked on Friday as I was posting the idea and thesis." The same
  paragraph plans to add to full size, which the later rulebook's A5 (no adding) would not allow.
- Note "remounted all MAs": the stock was back above every average, which fits house rule B26.
- **Checked on prices, it was not a Stage 4 stock.** Close 216.47 on 2025-11-28, over the 50-day (207.26), 150-day
  (177.97) and 200-day (165.49). The 30-week line was rising (weekly 30-week average about 173 on 11/7, 182 on 11/28).
  The 11/7 low (173.56) was about 39% under the 2025 high of 282.95 (2025-09-18). So this is a pullback to a rising
  30-week line, closer to a Stage 2 pullback than a 4B-; its value here is the owner's trigger, stop and "remounted all
  MAs" test, not the stage.

**Sunday Scans, 2025-11-23** (https://unchartedterritoryy.substack.com/p/sunday-scans-56d). This issue says it is by
"Bracco and I, Patrick (TSDR Trading)".
- ARKK: "Also I simply just mapped out the 30WK moving average. A classic Stan Weinstein spot for weekly charts coming out
  of bases to find support."
- CVNA (in TSDR's section, so the owner's words): "Stage 3 topping action and if the 200SMA is lost and sustains then
  stage 4 downtrend potential." (UCT ties Stage 4 to life under the 200-day.)

**Sunday Scans, 2026-11-08** (https://unchartedterritoryy.substack.com/p/sunday-scans-70f; missed in the first draft),
under "Patrick (TSDR)'s Weekly Outlook & Watchlist", so the owner's words: "I will gladly short stage 4 downtrends ap
they reject the 200SMA from below. AVGO on 10/8 and GEV on 11/3 are prime examples of this." ("ap" as printed.) This is
the owner's own stage-based short, and it matches B26 (shorts only below the 200-day). See 8.6.

**Sunday Scans, 2025-11-09, ARKG** (https://unchartedterritoryy.substack.com/p/sunday-scans-720):
- "Threw on the classic Stan Weinstein Weekly Chart here. If this in fact something to pay attention to we should see a
  strong reaction near the 30 Week Moving Average."
- "I was looking for a higher low to form but it was pretty gnarly this week so would like it to slow down and build
  healthier here."

**Other stage language in Sunday Scans:**
- SNOW, 2025-09-01 (https://unchartedterritoryy.substack.com/p/sunday-scans-4d1): "Highest weekly close since Feb 2022 and
  looking like beginning of Stage 2 uptrend now."
- SNOW, 2025-09-21 (https://unchartedterritoryy.substack.com/p/sunday-scans-88a): "Weekly (Not Pictured) shows major
  potential of moving out of stage 1 base into stage 2 uptrend."
- TWLO, 2026-06-28 (https://unchartedterritoryy.substack.com/p/sunday-scans-ae1): "Big stage 1 base and possible uptrend
  here."
- RIVN, 2025-12-14 (https://unchartedterritoryy.substack.com/p/sunday-scans-f2f; Bracco's section): "Huge shakeout /
  news failure on Thursday following the conference and displaying characteristics that you typically see at the turning
  point of a stage 1 base."
- A keyword scan of all 103 posts for "4B", "Weinstein", "stage 4", "stage 1" and "30 week" found nothing else on the
  4B- (the one "4B" hit is a "$4B market cap").

**The Rest of the Week, 2025-11-25** (US evening; stamped 2025-11-26 UTC;
https://unchartedterritoryy.substack.com/p/the-rest-of-the-week-22a). Contributors from the Discord, not the owner:
- "Tiny Trades" on LULU: "Three month long bottoming formation here with retail names catching a bid on consumer maybe
  not as bad as feared. Pop today over the 50 day." And: "Look for any type of pull back into the 9/20/50 as they start
  to curl up below."
- Manrav on CRWV: "Bottom fishing/Snap back trade idea." With "Trade Idea: Long with 65 stop".

**The owner's recorded entry ruling** (`docs/study/audits/2026-10-24/owner_verdicts.jsonl`, 2026-11-02, piece
`b5-answer-one-chart`, which `docs/study/workbench/walkthrough/pieces.json` shows was a Kicker lesson): "The entry is
supposed to trigger OVER previous day high not at mkt close!" He said it about the Kicker; he has not ruled on the 4B-.
Section 8.2 borrows it for the 4B- trigger by analogy, which is the owner's call to confirm.

**Not quoted here, on purpose.** The repo's brain files (`docs/study/levels/brain_kb_cycle_2026-11-06.json` and
`brain_kb_rules_2026-11-06.json`) hold Discord-derived notes from the owner, Bracco and Manrav on bottom-buying, higher
lows and 50-day reclaims, and the team's launch-pad playbook text on adding at a 50-day reclaim. The Discord and the
playbook are member-only material, and this repo is public, so I do not copy their wording into this file. The owner can
read them there. A keyword check by the checker found notes on bottoming action, remounts and a 50-day stop, and none
that names a 4B-; whether they back the higher-low stop in section 8 was not confirmed.

---

## 7. How it fits the account rulebook (section 9 of `docs/study/sizing_rule.md`)

| Rule | What it says | Fit with the 4B- |
|---|---|---|
| **B26** (hard) | No longs below the 200-day SMA unless parabolic | **Main conflict.** A 4B- is late Stage 4; the 200-day is normally far above and falling. Both named examples fail it at the entry: NFLX 190.92 vs a 200-day of 415.34 (2022-07-18), DXCM 72.53 vs 103.12 (2024-11-13). UCT itself links Stage 4 to life under the 200-day (CVNA quote, and the owner's 2026-11-08 short note). A 4B- base is not Bracco's parabolic burst down (three straight down days, gaps, range expansion), so the exception does not apply. |
| **C31** | RS 80+ leaders, except parabolic and mean-reversion trades | **Conflict.** After a long decline the 12-month RS rating is low. Either the 4B- counts as a mean-reversion trade (owner's call) or it cannot pass. |
| **A13** | Stop usually within about 3% | **Tension.** The natural structural stops (under the higher low, under the 50-day) are often wider. GTA stops in the 2024 sample run well past 3% (AKRO: 30 entry, 25.99 trading stop). |
| **A3 / F62** | Stop first, a few cents under the day's low or prior day's low; skip if the honest stop does not fit | Applies. If the honest stop is under the higher low and too wide, skip. |
| **A5** | One price, one stop, no adding | Conflicts with Ameet Rai's "add along the way". Ours: no adding. |
| **E57** | Market orders | Applies. GTA buys "on a close above"; ours is a market order once the trigger trades. |
| **C28 / C29** | No more than 4% past the buy point; skip if more than 10% above the 10-day | Applies. A 50-day reclaim on an earnings gap can be stretched. |
| **B22** | No new buys in the 3 days before earnings | Applies, and it would have blocked Deepvue's own example: the NFLX "4B- entry" near $189 came on 2022-07-15 / 07-18, one to two sessions before the report (after the close on 2022-07-19). Check the report date on every 4B-. (An earlier draft said the NFLX entry came after the report; that was wrong.) |
| **B23 / D42** | $10+ and $20M+ a day; never more than 1% of ADV | Applies. Stricter than Deepvue's screen on dollar volume (500K shares at $15 is only $7.5M a day), looser on price ($10 against Deepvue's $15). |
| **B19, E51, E52, F63** | Breakeven at 2R to 5R; a third at 3R, a third at 5R, trail under the 10-day or 21-day | Applies. Fits the sources' "short-term play". |
| **B20** | Gap through the stop: first 30-minute low is the new stop; out past 2R | Applies. |
| **C33** | Under 1R after 10 trading days: sell | Applies; fits "capture quick momentum". Bases after declines can be slow, so this will cut some. |
| **B18 / F65 / F68** | Market filter; after a correction start with a few | Applies. Deepvue: the setup suits a market where "most stocks have been downtrending". |
| **D47** | Shorts are our longs reversed | The mirror (a "2B-": late Stage 2 that lost its 10-week line) lives above a rising 200-day, which B26 forbids shorting. See 8.6. |
| **D38 / E49 / E50** | Grade sets size; grading is his judgment | Applies. Section 9 gives cues only. |

---

## 8. Proposed rules for our course

Two versions. **Version H (house)** is the one I recommend we teach as a trade, because it respects B26. **Version W
(Weinstein's)** is taught as a chart-reading skill and a watchlist trigger, not a trade, unless the owner makes an
exception (question 2).

### 8.1 What it is (both versions)

| Item | Rule | Basis |
|---|---|---|
| Cycle low (definition) | The lowest low of the 252 sessions before the trigger; the 52-week high is the highest high of the 252 sessions before the cycle low | [my proposal] (the first draft used "cycle low" without defining it) |
| Prior trend | A Stage 4 decline: on the cycle low's date the 150-day SMA (30-week line) was lower than 20 sessions earlier, and price was under it | Stage 4 = price under a declining 30-week line: TraderLion guide and Deepvue page [source consensus]; 20 sessions [my proposal] |
| Depth | The cycle low is at least 30% under the 52-week high | "sharp decline" [originator via TraderLion]; 30% [my proposal]; no source gives a number. Both named examples pass easily (NFLX 77%, DXCM 56%) |
| Time in decline (option) | Price under a falling 150-day SMA for at least 26 of the 39 weeks before the cycle low | stageanalysis.net uses 39+ weeks [practitioner]; 26 of 39 [my proposal]; **fails both named examples** (NFLX about 17 weeks, DXCM about 8; 8.10); see question 6 |
| Low for the cycle | No close under the cycle low since it was set | the idea: "has now seen its low for the cycle" [originator, GTA wording]; UCT: "not made a new low" [UCT]; the test [my proposal] |
| Higher low | A pullback low at least 3% above the cycle low, set at least 10 sessions after it | "Form of a higher low (critical signal)" [vendor: Deepvue]; numbers [my proposal] |
| Base length | At least 15 sessions from the cycle low to the trigger | "base formation" [originator via TraderLion]; Stage Analysis warns about small bases [practitioner]; 15 [my proposal] |
| Volume into the higher low | Average volume on the down days of the higher-low pullback below the 50-day average volume | "Decreasing downside momentum/volume" [vendor: Deepvue]; TraderLion's Stage 1 text names "declining volume" [vendor]; the test [my proposal] |
| 50-day | Close above the 50-day SMA, and the 50-day no more than 1% lower than 10 sessions ago (flattening) | "recapture of the 50-day" [originator via TraderLion]; "Flattening 50-day MA slope" [vendor: Deepvue]; 1% and 10 [my proposal]. **NFLX fails the 1% at its entry** (the 50-day was 2.1% lower than 10 sessions earlier on 2022-07-18; it first passed on 2022-07-20, after the report). DXCM passes (-0.4%) |
| Pause above the 50-day | At least 2 sessions closing above the 50-day before the trigger | "Consolidation above the 50-day" [vendor: Deepvue]; the owner's "two tight rest days above the 50SMA" (said of RDDT, not a 4B-) [UCT]; 2 [my proposal] |
| Room to run | At least 3R from entry to the nearest overhead level among: the 150-day SMA, the 200-day SMA, and the highest close of the 60 sessions before the cycle low (each only if above the entry) | "room to run" [originator via TraderLion]; the levels and 3R (matching the first trim, B19) [my proposal] |
| **Version H only: the 200-day** | Close above the 200-day SMA (so above every average, the "remounted all MAs" read) | B26 [house rule]; RDDT note [UCT]. Fails both named examples |
| Liquidity | Price $10+; $20M+ traded a day; position under 1% of average daily volume | B23, D42 [house rule] |
| Relative strength | RS line (stock divided by SPY) has made a higher low with price, or is above its own 50-day average | Weinstein's method reads RS: GTA buy notes ("excellent relative strength"), stageanalysis.net's RS Zero Line, Bulkowski's coded test [source consensus]; this test [my proposal]; RS 80 waived only if the owner rules (question 3). NFLX passes; DXCM fails (its RS line made a lower low on 2024-10-03 and sat just under its 50-day average on 2024-11-13) |
| Group and market | The stock's industry-group ETF or index closes above its own 50-day SMA; the market reading is Green or Yellow (Orange: A+ only, F65) | "forest to the trees" [originator: book page 75 as quoted by stageanalysis.net, not checked against the book]; the GTA 2005 stresses "stock and group selection" [originator]; the group test [my proposal]; B18, F65 [house rule] |

### 8.2 The buy

| Item | Rule | Basis |
|---|---|---|
| Trigger | Price trades above the highest high of the pause above the 50-day (with the 2-session minimum pause of 8.1, that is the higher of the last two highs) | Deepvue chart "Break above 50DMA" [vendor]; the owner's Kicker ruling "The entry is supposed to trigger OVER previous day high not at mkt close!" [UCT], borrowed here by analogy (he has not ruled on the 4B-) |
| Order | Market order once the trigger trades | E57 [house rule] |
| Not too late | Skip if already more than 4% above the trigger, or more than 10% above the 10-day average | C28, C29 [house rule] |
| Earnings | No new buy in the 3 days before a report | B22 [house rule] |
| Size | From the stop (A5); B- or lower grades sized down (D38, E49) | [house rule] |
| Option (closer to GTA) | Buy only if the day closes above the trigger level | GTA buys "on a close above" [originator]; not recommended with E57, offered for question 5 |

### 8.3 The stop

| Item | Rule | Basis |
|---|---|---|
| Default | A few cents under the lowest low of the pause above the 50-day; if the owner prefers the house default, a few cents under the trigger day's low or the prior day's low (A3, F62) | A3, F62 [house rule]; the pause low [my proposal]; which one is question 4 |
| Structural alternatives | (a) under the 50-day (UCT's RDDT note); (b) under the higher low (the "investing stop" style). Use only if inside the owner's maximum | [UCT]; GTA two-stop practice [originator] |
| Maximum | If the honest stop is more than X% under the entry, skip the trade. Options for X: 3% (A13), 5%, 8% | A13 [house rule]; X is question 4 |
| Placement | Not on a round number: a few cents under it | GTA stops mostly at x.99 / x.49 [originator]; Bulkowski's own rule: "Place a stop below (by 7 cents) the round number." |
| Gap through the stop | First 30-minute low is the new stop; out if past 2R | B20 [house rule] |

### 8.4 Trims and trail (house defaults)

- Breakeven between 2R and 5R; a third at 3R (hard rule), a third at 5R; trail the rest under the 10-day (fast movers) or
  21-day (steadier) on a close below it; trim at the open if it gaps past a trim level. [house rule: B19, E51, E52, F63]
- Time stop: under 1R after 10 trading days, sell. [house rule: C33] This matches the sources' "short-term plays" and
  "capture quick momentum, sell".
- A climax run: sell a big part into it. [house rule: C34]
- Version W (if ever allowed): a first trim at the falling 200-day line when it sits under 3R. [my proposal]

### 8.5 What invalidates it

- Before entry: a close under the cycle low (the "low for the cycle" call was wrong; it is still 4B or 4); a close back
  under the 50-day before the trigger (the setup re-arms only after a new 2-session pause above it); a close under the
  higher low. [the GTA definition read in reverse (originator); the tests are my proposal] Note: NFLX did exactly this
  once, closing over the 50-day on 2022-07-07 and 07-08, back under on 07-11, then over again on 07-15.
- After entry: the stop; a close under the 50-day (the owner's stop line in the RDDT note) [UCT]; the market reading
  turns Red (B18, F65) [house rule]; the time stop (C33). A viewer's notes of the 2024 interview report Weinstein saying
  "below 50sma you gotta be gone" (viewer transcription, not verified).
- Never: a 4B without the minus. Weinstein's legend: "Much too soon to consider buying." [originator]

### 8.6 The short mirror: none for our course

- The mirror is a late Stage 2 stock that has lost its 10-week line: stageanalysis.net's "Stage 2B- (and below 10 week
  MA)", or Weinstein's 3A, "Looks as if a top is starting to form" (GTA legend, which tells holders to "protect holdings
  with a close stop", not to short).
- Such a stock is nearly always above a rising 200-day. B26 forbids shorts above the 200-day except parabolic ones.
- So D47's "reversed" rule does not give a usable short here. Our short side for stages lives in the Stage 4A breakdown
  and the Bear gap, which are separate setups. [house rule; my proposal] The owner's own words point the same way
  (Sunday Scans, 2026-11-08): "I will gladly short stage 4 downtrends ap they reject the 200SMA from below." [UCT]

### 8.7 Best conditions

- After a broad market decline, once the market itself is turning back up. Deepvue: "applicable in the current market
  (after most stocks have been downtrending)". [vendor]
- Market reading Green, or Yellow at smaller size; after a correction, start with a few positions (F68). [house rule]
- The group is basing too, and the stock is among the first in it to reclaim its 50-day. [originator: Weinstein's
  group-first order (book page 75 via stageanalysis.net; the GTA's group pages); "first in the group" adapted from
  stageanalysis.net's Stage 2A checklist ("first to move into Stage 2") [practitioner]]
- A fresh reason for the turn can help (for example a strong earnings reaction), as on Deepvue's NFLX chart, but there
  the report came after the entry, so the buy was a bet into earnings that B22 forbids. [vendor; one example]

### 8.8 Common mistakes

1. Buying plain 4B, a stock still falling, because it seems cheap. GTA: "Much too soon to consider buying." TraderLion
   guide: do not "catch the bottom".
2. Buying too early: "a small base following a large Stage 4 decline, price still under declining moving averages"
   (stageanalysis.net).
3. No higher low. Deepvue calls the higher low "critical".
4. Treating a short-term trade as an investment, and holding it back down into Stage 4 ("take the oath" never to hold
   Stage 4).
5. Adding to it on the way up (A5 forbids it).
6. Ignoring overhead supply: buying right under the falling 30-week or 200-day line with less than 3R of room.
7. Chasing the reclaim day after an earnings gap (C28, C29), or buying the reclaim in the days before a report (B22),
   as Deepvue's NFLX example did.
8. Buying against the market or a weak group (forest to the trees).
9. Mixing up labels: a 4B- is not yet a Stage 1 base, although our app's stage code already calls it Stage 1 (5.2).

### 8.9 Example candidates named by the sources (only rows 1, 2 and 18 checked on prices)

The owner asked for 10 examples per setup. These are the ones the sources name. Rows 1, 2 and 18 were checked on Yahoo
Finance daily bars by the checker (8.10 and section 6); the rest were not, and some tickers no longer trade.

| # | Ticker | When | Who named it | What it is |
|---|---|---|---|---|
| 1 | NFLX | July 2022 (closes back over the 50-day on 2022-07-15 and 07-18; report after the close on 07-19) | Deepvue X post | "4B- entry"; chart labels Stage 4, higher low, break above the 50-day. Bought before earnings (B22) and far under the 200-day (B26) |
| 2 | DXCM | discussed in the interview recorded 2024-11-13 | Weinstein (TraderLion clip description) | his live 4B- walkthrough; on 2024-11-13 above the 50-day, far under the falling 150-day and 200-day (B26) |
| 3 to 9 | HSP, HAL, FLIR, BMC, AA, NFLX, QEP | early March 2012 (chart files named "_2-3-12"; the poster's previous batch, same naming, was "from 3rd March 2012") | Trade2Win post #327 (7 March 2012), from the then-current GTA the poster had been shown (#326) (forum) | "examples of Stage 4B-" |
| 10 to 13 | ADI, CHIR, INTU, MEDI | March 2005 issue (data as of 2/25/05) | GTA March 2005 (S&P 500 table) | rated 4B- |
| 14 to 17 | DV, KCP, TOM, SNPS | same issue | GTA March 2005 (secondary table) | rated 4B- |
| 18 | RDDT | 2025-11-30 | UCT Sunday Scans (the owner's TSDR section; he bought it) | "early to bottom", back above all averages; not labelled 4B-, and on prices not a Stage 4 stock (above a rising 30-week line) |
| 19 | LULU | 2025-11-25 | UCT Rest of the Week (Tiny Trades) | "bottoming formation", "Pop today over the 50 day"; not labelled 4B-; not checked |

### 8.10 The proposed tests on the two named examples (checked 2026-11-09)

Yahoo Finance daily bars; NFLX prices multiplied by 10 for its 2025 split. Entry day for NFLX = 2022-07-18 (the second
close over the 50-day, the bar the Deepvue arrow points near); for DXCM = 2024-11-13 (the recording night).

| Test (8.1) | NFLX 2022 | DXCM 2024 |
|---|---|---|
| Cycle low | 162.71 on 2022-05-12 | 62.34 on 2024-07-26 |
| Prior trend (150-day falling, price under, at the low) | pass (150-day 474.62 vs 525.41) | pass (123.81 vs 124.83) |
| Depth 30%+ | pass (77% under 700.99) | pass (56% under 142.00) |
| Time option, 26 of 39 weeks | **fail** (about 17 weeks) | **fail** (about 8 weeks) |
| No close under the cycle low | pass | pass |
| Higher low 3%+, 10+ sessions later | pass (170.30 on 2022-06-30, +4.7%, and 169.70 on 07-13, +4.3%; the 06-14 low, 164.28, was only +1.0%) | pass (several; 64.76 on 2024-10-02, +3.9%) |
| Base length 15+ sessions | pass (44) | pass (77) |
| 50-day flattening (no more than 1% lower over 10 sessions) | **fail** (-2.1%; passes from 2022-07-20) | pass (-0.4%) |
| 2+ closes above the 50-day | pass (07-15, 07-18) | pass (11-11, 11-12, 11-13) |
| Version H: above the 200-day | **fail** (190.92 vs 415.34) | **fail** (72.53 vs 103.12) |
| RS line test | pass | **fail** (lower RS low on 2024-10-03; just under its 50-day average) |
| Earnings (B22) | **fail** (report after the close on 2022-07-19) | pass (last report 2024-10-24) |

What this says: Version H would have taken neither of the two examples the sources hold up. The 1% flattening and the
26-of-39-weeks option each reject one or both of them, so the owner should set those numbers knowing that (questions 2
and 6). Two examples are not a test of the edge.

---

## 9. Grading (cues, not a checklist; E50 says grading is his judgment)

No source grades a 4B-. These cues come from the sources' criteria and from Stage Analysis's "A+ candidate" language
for breakouts (stageanalysis.net checklist). Use them to decide size (D38, E49), not as a pass test.

**Toward A+**
- A deep, long decline (well past 30%, many months under a falling 30-week line) that has clearly stopped: no new low for
  weeks.
- A clean higher low on light volume; the down days dry up.
- A tight pause right on top of a 50-day that has gone flat; the trigger day on clearly higher volume.
- Already back above the 200-day (Version H), with plenty of room to the next ceiling.
- RS line making higher lows before price does.
- The group turning up too, and the market turning up from a broad decline.
- A fresh reason (an earnings reaction, a guidance change) behind the turn.

**Toward B- (or a pass)**
- A shallow or short decline, so there is little fuel and little "bottom" to call.
- No higher low; a V straight up into the 50-day.
- A loose, wide pause; the 50-day still falling steeply.
- The falling 200-day or an old breakdown level just overhead.
- RS still making new lows.
- A weak group, or a Red or Orange market.
- A trigger right before earnings.

---

## 10. Questions for the owner

1. **The name.** Weinstein's plain "4B" means "Much too soon to consider buying"; the buy is "4B-". Options: (a) rename the
   tag `4B- (Stan Weinstein)`; (b) keep "4B Setup (Stan Weinstein)" and explain the minus in the lesson; (c) drop the tag.
   I recommend (a).
2. **The 200-day (B26).** Options: (a) Version H only: trade it only once price is back above the 200-day; (b) add the
   4B- as a second named exception to B26, at B- size and with a tight stop; (c) teach the 4B- only as a reading skill
   that puts a stock on the watchlist for its later Stage 2A breakout. I recommend (a) plus (c): it keeps the hard rule
   and still teaches the read. Know that (a) would have skipped both examples the sources hold up (NFLX and DXCM were
   30% to 54% under their 200-day lines at the entry, 8.10). Your RDDT note ("remounted all MAs") fits (a), but RDDT was
   a pullback in an uptrend, not a 4B-.
3. **RS 80 (C31).** Is the 4B- a "mean-reversion" trade, exempt from RS 80? Options: (a) yes, exempt, with the RS-line
   test in 8.1; (b) no, it must meet RS 80 (very few will); (c) exempt only in Version W.
4. **The widest stop.** Options: 3% (A13 as written), 5%, 8%, or no fixed maximum (the structural stop, whatever its
   width, at smaller size). Which stop line is the default: the pause low, the 50-day, or the higher low?
5. **The trigger.** Options: (a) trades above the pause high (or the prior day's high), market order (my recommendation,
   matches E57 and what you ruled for the Kicker on 2026-11-02, "trigger OVER previous day high not at mkt close"; does
   that ruling apply to every setup?); (b) a close above the 50-day; (c) GTA style, a close above a set level.
6. **What counts as the decline.** Options: depth only (30%? 40%? 50%?), time only (stageanalysis.net's 39 weeks), or
   both. On the two named examples, depth is easy (77% and 56%) but time is short (about 17 and 8 weeks under a falling
   30-week line before the low), so a time rule would drop both. Also: the 50-day "flattening" number (1% in 8.1)
   rejects the NFLX entry; keep it, loosen it, or drop it?
7. **Family in the journal.** 'Bases & Breakouts' (now) or 'Reversals & Reclaims'? I recommend Reversals & Reclaims.
8. **Holding style.** A short-term trade on the house trims (TraderLion and Deepvue), or a position meant to ride into
   Stage 2 (Ameet Rai)? The house rules already lean short-term (C33).
9. **A scanner.** Do you want one built? If yes, which version (H or W), and on daily or weekly bars? Note that the
   app's stage code (5.2) cannot tell a 4B- from a Stage 1 base (it reads these stocks as Stage 4, then Stage 1, from
   price change alone), and the screener's Stage 4 flag drops them the day they reclaim the 50-day, so both would need
   work first.
10. **Your own trades.** Which of your journal trades did you tag "4B Setup"? Three to five of them would let the course
    model your version instead of Deepvue's.

---

## 11. Sources (all read on 2026-11-09 unless marked)

| # | Source | Publisher / author | Published | Reliability note |
|---|---|---|---|---|
| 1 | Global Trend Alert, Vol. 16 Issue 3, March 2005 (PDF "MarGTA_Part1.pdf"), https://www.trade2win.com/attachments/margta_part1-pdf.122300/ | Stan Weinstein's Global Trend Alert; posted by a Trade2Win member (post #2, 2011-09-15) | March 2005 (data stamp "2/25/05") | Originator, primary. A forum-posted copy of a paid, copyrighted newsletter; short quotes only. Text read by machine extraction. |
| 2 | Global Trend Alert weekly update, 6 Oct 2024 (PDF) and buy list (XLS), https://traderlionmedia.s3.us-east-2.amazonaws.com/wp-content/uploads/2024/10/09080721/10_06_24-Global-Trend-Alert-weekly-update.pdf and https://traderlionmedia.s3.us-east-2.amazonaws.com/wp-content/uploads/2024/10/09081451/10_06_24-GTA-BUYS.xls | Stan Weinstein's Global Trend Alert, hosted by TraderLion as a sample | 2024-10-06 | Originator, primary, public sample. |
| 3 | "The 4B-Minus Setup" (video description), https://www.youtube.com/watch?v=dUFXdDm3njo | TraderLion Clips (YouTube) | 2026-04-03 | Weinstein's quoted words plus TraderLion's summary. Video and captions not read (the caption request came back empty). |
| 4 | "+200% in 40 Days - Stage Analysis in Modern Markets - Exclusive Interview with Stan Weinstein" (description and chapter list), https://www.youtube.com/watch?v=Mef5ef9DbwM | TraderLion (YouTube); description signed "-Richard" (the viewer notes in row 18 name Richard Moglen) | 2024-11-15 (recorded 11/13) | Chapter titles written by TraderLion. Video not read. |
| 5 | "The Complete Guide to Stan Weinstein's Stage Analysis", https://traderlion.com/trading-strategies/stage-analysis/ | TraderLion, Nick Schmidt | 2024-10-18 | Educator; commercial partner of Weinstein. Live page refused the request (403); read the Internet Archive copy of 2025-11-13. |
| 6 | Deepvue post on X, https://x.com/Deepvue/status/1914841517459694084 (text and images read through the public fxtwitter API) | Deepvue | 2025-04-23 (UTC) | Vendor marketing; Weinstein's partner. Criteria list useful; NFLX numbers checked on prices by the checker (section 4, 8.10): the move is real, the "couple of weeks" is about four. |
| 7 | "Stan Weinstein Stage Analysis: Identify The Best Time To Buy And Sell Stocks", https://deepvue.com/indicators/stan-weinstein-stage-analysis-when-to-buy/ | Deepvue | page shows "Last Updated: July 26, 2024" (its metadata says modified 2025-08-27) | Vendor education; says its tools were built with Weinstein. |
| 8 | "Stage Analysis Screener: A Smarter Way to Trade Market Cycles", https://deepvue.com/screener/stage-analysis-screener/ | Deepvue | not shown | Vendor; general stage text, nothing on 4B-. |
| 9 | Deepvue help, "Stage Analysis" indicator, https://docs.deepvue.com/articles/deepvue-custom-indicators-stage-analysis | Deepvue | not shown | Vendor docs; does not define 4B-. |
| 10 | "Stan Weinstein's Stage Analysis - Definitions of the Stages and Sub-stages", https://www.stageanalysis.net/blog/4222/stan-weinsteins-stage-analysis-definitions-of-the-stages-and-sub-stages | stageanalysis.net | 2019-10-01 | Independent practitioner site; transcribes GTA wording. Good, but secondary. |
| 11 | "Stan Weinstein's Stages Now Available in Stage Analysis Screener", https://www.stageanalysis.net/blog/1248342/stan-weinsteins-stages-now-available-in-stage-analysis-screener | stageanalysis.net | 2025-01-25 | The site's own mechanical rules, not Weinstein's. |
| 12 | "Learn: How Stocks Transition From the Stage 4 Declining Phase to the Stage 1 Basing Phase", https://www.stageanalysis.net/blog/366029/learn-how-stage-4-transitions-to-stage-1 | stageanalysis.net | 2022-07-12 | Practitioner; only the public part read (members-only remainder). |
| 13 | "Stage Analysis Study Guide - Questions and Answers", https://www.stageanalysis.net/blog/2733/stage-analysis-study-guide-questions-and-answers | stageanalysis.net | 2019-10-01 | Practitioner; cites book pages I did not verify. |
| 14 | "Stage Analysis Breakout Quality Checklist", https://www.stageanalysis.net/blog/4372/stage-analysis-breakout-quality-checklist | stageanalysis.net | 2019-10-01 | Practitioner; quotes page 75 of the book (not verified). |
| 15 | "Stock Market Studies: How the Market Bottoms - 40 Years of Stage 4 Lows in the Nasdaq Composite", https://www.stageanalysis.net/blog/332746/stockmarket-studies-how-the-market-bottoms-40-years-of-stage-4-lows-in-the-nasdaq-composite | stageanalysis.net | 2022-06-16 | Qualitative; public part only. |
| 16 | "Stan Weinstein's Stage Analysis" thread, https://www.trade2win.com/threads/stan-weinsteins-stage-analysis.134944/ : posts #2 (the 2005 PDF), #19 (2011-10-07, "extra definitions"), #326 (post id 1804190, 2012-03-06, the poster shown the current GTA) and #327 (post id 1804960, 2012-03-07, the 4B- examples) | Trade2Win forum (all four by the member "isatrader") | 2011 to 2012 | Forum: pointers only (dates of the definitions, the 2012 example list). Not relied on for rules. |
| 17 | Ameet Rai post on X, https://x.com/AmeetRai/status/1869462676134416879 (read through fxtwitter; the account's handle is AmeetRai) | Ameet Rai (bio: building Deepvue) | 2024-12-18 | One trader's workflow; commercially linked. |
| 18 | Wey How post on X, https://x.com/wey_how12640/status/1858423599088160891 (read through fxtwitter) | a viewer | 2024-11-18 | Viewer's notes of the interview; pointer only. |
| 19 | "Four Stages of Price Movement", https://www.thepatternsite.com/Stages.html | Thomas Bulkowski | page shows "As of 11/06/2026" | Measured (his own trades). **States a notice against use for AI training.** Read through a fetch tool; table values not copied by me. |
| 20 | "Trading Weinstein", https://www.thepatternsite.com/TradingWeinstein.html | Thomas Bulkowski | 2023-10-25 | Measured test of the classic buy. **Same AI-training notice.** Read through a fetch tool (direct requests were refused, HTTP 406). |
| 21 | "Stage Analysis and Stan Weinstein's Masterclass", https://tradingengineered.substack.com/p/stage-analysis-and-stan-weinsteins and "Key Lessons from my Interviews with Stan Weinstein", https://tradingengineered.substack.com/p/key-lessons-from-my-interviews-with | Richard Moglen (TraderLion) | 2022-07-12 and 2022-07-26 | Course marketing; dates the TraderLion partnership. Nothing on 4B-. |
| 22 | Global Trend Alert sales page (archived), https://traderlion.com/global-trend-alert/ | TraderLion | first published 2024-10-03 (page metadata); archived 2025-12-04 | Used to find the public sample in row 2 and the price. |
| 23 | UCT Substack, all 103 posts in https://unchartedterritoryy.substack.com/sitemap.xml; quoted: sunday-scans-422, -56d, -720, -4d1, -88a, -ae1, -f2f, -70f, the-rest-of-the-week-22a | Uncharted Territory (Patrick, TSDR Trading; Bracco; contributors) | 2025-09-01 to 2026-11-08 for the quoted posts | House source; quoted exactly. Section headings checked for who wrote each note. |
| 25 | Netflix Form 8-K with the Q2 2022 shareholder letter, https://www.sec.gov/Archives/edgar/data/1065280/000106528022000256/nflx-20220719.htm (found by search; date only) and DexCom Form 8-K, Q3 2024 results, https://www.sec.gov/Archives/edgar/data/1093557/000109355724000179/dxcmq3202499-1_9302024.htm (date only) | Netflix; DexCom | 2022-07-19; 2024-10-24 | Used only for the report dates (B22 check). |
| 26 | Yahoo Finance daily bars for NFLX, DXCM, RDDT and SPY, read with the `yfinance` Python library | Yahoo Finance | read 2026-11-09 | Split-adjusted (NFLX multiplied by 10 for its November 2025 10-for-1 split); used for the price checks in sections 3.3, 3.5, 4, 5.2, 6 and 8.10. A free data feed: good for these checks, not for a published statistic. |
| 24 | Repo files: `app/src/constants/setupGroups.js`, `app/src/pages/journal-2-0/lib/setupTagMap.js`, `app/src/pages/modelbook/setupCatalog.js`, `app/src/components/chart/engine/ast/starterScans.json`, `api/services/pattern_engine/detectors/structure/stage_analysis.py`, `api/services/pattern_engine/primitives/context.py`, `api/services/breadth_live.py`, `api/services/breadth_metrics.py`, `api/services/screener/filters.py`, `api/services/screener/context_joins.py`, `app/src/constants/quotes.json`, `api/services/pattern_engine/detectors/classical/golden_cross.py`, `api/services/pattern_engine/detectors/classical/death_cross.py`, `api/routers/patterns.py`, `docs/study/workbench/walkthrough/pieces.json`, `docs/study/UNITS-method.md`, `docs/study/TRADE_PLANS.md`, `docs/study/sizing_rule.md`, `docs/study/audits/2026-10-24/owner_verdicts.jsonl`, `docs/study/levels/brain_kb_cycle_2026-11-06.json`, `docs/study/levels/brain_kb_rules_2026-11-06.json`, `docs/wisdom/vocabulary/setup-vocabulary-v1.json` | this repo, branch feat/study-content | as of 2026-11-09 | Read directly. The two brain files hold member-only Discord material: read, wording not copied here. |

**Not read, and why.**
- Weinstein's 1988 book: no copy available in this session; only other people's readings of it are used, and marked so.
- The two TraderLion videos (rows 3 and 4): the captions could not be fetched; only the descriptions are quoted.
- The TraderLion Stage Analysis Masterclass and Model Book: paid or sign-up content.
- stageanalysis.net's forum thread "Stage 4B- Examples": the live page is gone (HTTP 410); I did not read a copy. A search
  engine's snippet of it is not quoted here.
- Deepvue's glossary entry on "Stan Weinstein Stages": the page did not open.
- Several sites from searches that read as AI-written or are anonymous (snappchart.app, trendsandbreakouts.com,
  completetradersedge.com, trendspider.com's "AI-powered" post, TradingView community scripts): not used. Pirated PDFs of
  the book that appeared in search results: not opened.
- The checker's extra searches (for any Weinstein or TraderLion text on the 4B- beyond the sources above, and for
  StageAnalysis.net's 2020 X thread of stage examples) found nothing new on the 4B-; that thread stops at plain 4B.

---

## Removed in checking (cold check, 2026-11-09)

Each item below was in the first draft and was wrong, or could not be confirmed. Corrections are made in place above.

1. **"The app labels a 4B- Stage 3."** Wrong. Running `_trend_stage()` on NFLX 2022 and DXCM 2024 gives Stage 4, then
   Stage 1; the Stage 3 branch needs price above the 150-day, which a 4B- is not. Fixed in 5.2, 8.8 (item 9) and 10
   (question 9).
2. **"Deepvue's NFLX trigger bar sits at an earnings marker (bought after the report, so allowed)" (section 7, B22).**
   Wrong. The $189 entry came on 2022-07-15 / 07-18; Netflix reported after the close on 2022-07-19. B22 would have
   blocked it. Fixed in 3.5, 7, 8.7, 8.8 and 8.9.
3. **The owner's "OVER previous day high" ruling "stated as a general rule".** Not supported: the workbench piece it was
   said on was a Kicker lesson, and the words do not say "all setups". Now described as a Kicker ruling borrowed by
   analogy (section 6, 8.2, question 5).
4. **"The specific 4B- sentence first appears in March 2012."** Not confirmed as worded: the full sentence also stands in
   the thread's first post (edited at an unknown date). Now: the earliest dated appearance found is 2012-03-07.
5. **"Stage table dated 2/25/05."** The table carries no date in the text; the 2/25/05 stamp is on page 7. Reworded.
6. **"Buys start at the move into Stage 2A, on closing levels" and "two stops per buy, just under round numbers" (2005
   GTA).** Over-general: the issue also has intraday "crossing" buys, pullback buys, single stops and stops not under a
   round number. Reworded in 3.1.
7. **RDDT as "the closest thing to a 4B- read".** On prices RDDT was above a rising 30-week line and its 200-day, not in
   Stage 4. Kept as the owner's closest note in shape, with that caveat; also now credited to the owner (TSDR section),
   with his trade.
8. **"Deepvue's 2024 page calls [a 50-day retake after a decline] Stage 1B, close to the same moment."** The page's 1B
   is a 50-day retake by a stock already basing in Stage 1; a later moment. Fixed in 2 and 3.13.
9. **"Stricter than Deepvue's screen" (B23).** Half true: stricter on dollar volume, looser on price. Fixed.
10. **"TraderLion and Deepvue, which sell his course and newsletter."** Only TraderLion was shown to sell them. Fixed.
11. **"The brain files agree in substance with ... the higher-low stop."** Not confirmed; softened.
12. **Comparison table, GTA column, "30-week still falling".** The GTA wording does not mention the 30-week line; now
    "not stated".
13. **Source row 16, "post 1804190 (March 2012 GTA examples)".** Post 1804190 is #326 (1B examples); the 4B- examples
    are #327, post id 1804960. Row 17's handle "AmeetRai_" is "AmeetRai". Row 4's "host Richard Moglen" is not on the
    page itself (signed "-Richard"). Fixed.
14. **Proposed-rule tags.** "[originator]" was used for TraderLion's summary of the clip; "[Deepvue]" and "[vendor]"
    were used without being defined. Now "[originator via TraderLion]", "[vendor]" and "[practitioner]", defined at the
    top. Two rows were not measurable as written ("still honest" stop, "wide-range break"; "first overhead resistance";
    "group is basing") and now have tests; "cycle low" is now defined.
15. **"None was checked against price data" for the examples.** Rows 1, 2 and 18 now are (8.10).

---

## 12. Examples (from our data)

Added 2026-11-09 from the local sandbox's daily bars (3,897 names, 1984 to 2026; the scan covered the 2,630 names that
ever met the house liquidity rule, all of them, in 176 seconds). Scripts and the pictures sit outside the repo in the
helper's scratchpad (`setups/10-weinstein-4b/`: `scan4b.py`, `chart4b.py`, `final/hits.json`, `final/sheet_*.png`).

**The rule the scan ran (section 8.1 and 8.2 made mechanical, plus the house rules).** Trigger day t: the stock has
closed above its 50-day SMA for 2 to 40 sessions in a row (the "pause"), and on day t trades above the highest high of
that pause; market order at the pause high plus a cent, or the open if it gapped over it (E57), skipped if that is more
than 4% past the pause high (C28) or more than 10% above the 10-day average (C29). The cycle low is the lowest low of the
252 sessions before t, 15 to 130 sessions back (an early turn, not a late Stage 2), at least 30% under the highest high
of the 252 sessions before it; on the cycle low's date the 150-day SMA was lower than 20 sessions earlier and the close
was under it (Stage 4). Between the low and the pause, fewer than half the closes were above the 50-day. A higher low:
the lowest low from 10 sessions after the cycle low to t is at least 3% above it, with a rally of 5%+ before it; the
down days of the week into that higher low averaged less volume than the 50-day average. The 50-day is no more than 1%
lower than 10 sessions earlier. RS line (stock / SPY) higher at the higher low than at the cycle low, or above its own
50-day average. Room: at least 3R to the nearest of the 150-day, the 200-day and the highest close of the 60 sessions
before the cycle low, counting only levels above the entry. No report in the next 3 sessions (B22, from the earnings
table; thin before 2005). Liquidity: prior close $10+, $20M+ a day (B23). Stop: a few cents under the pause low if that
is within 5% of entry, else the house default, a few cents under the lower of the trigger day's and the prior day's lows;
over 5%, no trade. The pause-low stop fitted only 104 of 2,016 hits; 1,912 used the day-low stop (median stop 3.3%,
A13's "about 3%"). Each hit is tagged Version H (prior close above the 200-day, B26) or Version W (under it); one hit
per name per 20 sessions. Not tested: the group and market readings (no group data in the sandbox) and the time option
of 26 of 39 weeks. The outcome is a fixed stop with no trims, no breakeven move, no time stop, 60 sessions forward: the
first of the stop, 3R and 5R reached.

**Base rate (1997-05-30 to 2026-11-05, 2,630 of 2,630 liquid names).** 2,016 hits; 25.7% reached 3R before the stop
and 15.1% reached 5R; 85.8% were eventually stopped inside 60 sessions (a fixed stop with no trims, so a trade that hit
5R and then came back to the stop counts in both). Version H (above the 200-day, the one we teach as a trade): 1,110
hits, 22.2% to 3R, 13.9% to 5R, median 11 sessions to 3R for those that got there. Version W (Weinstein's, under the
200-day, B26 forbids it): 906 hits, 30.1% to 3R, 16.7% to 5R, better than H on this fixed-stop test, which is worth
knowing when the owner answers question 2. Splits inside H: a 5-to-10-day pause 25.9% / 15.4%, 11 to 20 days 23.1% /
16.2%, 21 to 40 days 21.3% / 12.4%, a bare 2-to-4-day pause 15.7% / 11.8%; stops of 3% or less 24.4% / 15.0% against
20.4% / 13.0% for wider ones. The hit count is high because the rule fires on most 50-day-pause breakouts after any
30% decline; the 10 below were picked from the 5R winners by eye, so they say what a textbook one looks like, not
how often it comes. The named examples: DXCM 2024-11-12 fired as Version W (best 5.2R; the dossier's 8.10 entry was
the next day); NFLX 2022-07 did not fire (the 1% flattening and B22, as 8.10 says); RDDT 2025-11 did not fire (not a
Stage 4 stock, section 6).

**The 10 examples (all Version H: prior close above the 200-day).** Pictures: `final/sheet_1-4.png`, `sheet_5-7.png`,
`sheet_8-10.png`. "Best R" is the best excursion before the stop within 60 sessions, fixed stop, no trims.

| # | Ticker | Trigger | Cycle low, % under 52-wk high | Higher low | Sessions off the low / pause over 50-day | Buy point / entry | Stop (%) | Best R | Why it is textbook |
|---|---|---|---|---|---|---|---|---|---|
| 1 | SNPS | 1998-10-28 | 12.25, 48% | +9.9% | 41 / 9 | 19.53 / 19.54 | 18.76 (4.0%) | 14.2 | A sharp autumn-1998 Stage 4, a higher low in October, then the pause sits right on the 150- and 200-day lines and the break clears all three averages at once; 3R in 2 sessions. (SNPS is also on the GTA's March 2005 4B- list, 8.9, a different year.) |
| 2 | FDX | 2001-11-06 | 26.71, 34% | +10.1% | 33 / 8 | 34.97 / 34.98 | 34.06 (2.6%) | 10.8 | The September 2001 low, a quiet higher low, an 8-day pause tucked between the 50-day and the 200-day, then a clean break of the pause high; the 10-day EMA stayed above the 21-day all the way to 5R. |
| 3 | NTAP | 2004-09-13 | 15.92, 40% | +21.6% | 22 / 17 | 22.61 / 22.62 | 21.51 (4.9%) | 10.4 | Seven months under a falling 30-week line, a V low in August with a heavy-volume reversal day, a 17-day pause riding the 50-day, and the trigger bar closes above the 200-day. The widest stop of the ten (4.9%), question 4 material. |
| 4 | NUS | 2013-04-18 | 32.36, 48% | +17.2% | 78 / 19 | 49.98 / 49.99 | 49.05 (1.9%) | 31.9 | The longest base here: a December capitulation low, a February higher low, three months of flat 150- and 200-day lines, then a 19-day pause above a turning 50-day (up 2.2% in 10 sessions) and a tight 1.9% stop. The best outcome in the set. |
| 5 | NDSN | 2016-03-02 | 51.89, 39% | +9.1% | 29 / 11 | 73.24 / 73.25 | 71.47 (2.4%) | 8.8 | Half a year of lower highs under the 30-week line, a January low, and a steady 11-day pause that lifts through the 150-day and 200-day before the trigger; volume on the way down into the higher low was below average. |
| 6 | AMD | 2018-05-15 | 9.04, 42% | +5.8% | 29 / 10 | 12.36 / 12.37 | 12.06 (2.5%) | 25.2 | An April low after a six-month slide, a shallow higher low (+5.8%, the smallest here), and a 10-day pause with every close above the 50-day; the break clears the 200-day with room of 4.4R to the old closes. 3R in 4 sessions. |
| 7 | PENN | 2019-11-05 | 16.72, 53% | +7.7% | 57 / 17 | 22.11 / 22.12 | 21.49 (2.8%) | 15.7 | The picture-book shape: a long Stage 4 under a falling 30-week line, an August low, an October higher low, a 17-day pause above a 50-day that has turned up (+3.7%), and the trigger above the 200-day (the prior close 5.8% over it). |
| 8 | SAM | 2020-04-27 | 290.02, 35% | +19.5% | 29 / 12 | 439.42 / 444.00 | 428.39 (3.5%) | 14.2 | The March-2020 low, a quick higher low, a 12-day pause above the 50-day and the trigger gapped over the pause high (entry at the open, 1% past the buy point, inside C28). A V-shaped turn, so the "Stage 4" lasted only weeks: Weinstein's own examples (8.10) were like this too. |
| 9 | URI | 2022-11-08 | 230.54, 44% | +3.8% | 96 / 10 | 326.68 / 326.69 | 316.54 (3.1%) | 13.7 | A June-to-October double bottom (the second low 3.8% above the first; the September-October lows sit higher still), a 10-day pause pinned between the 50-day and the 150-day, and the trigger clears the 200-day with 3.8R of room to the August closes. 3R in 3 sessions. |
| 10 | DY | 2025-05-08 | 131.37, 37% | +14.4% | 22 / 11 | 186.40 / 186.41 | 182.62 (2.0%) | 22.5 | A spring 2025 washout to 131, a higher low at 150, an 11-day pause that walks up through the 50-, 150- and 200-day lines, a 2% stop and a run to 5R in 9 sessions (corrected 2026-11-10 against the bars) (the 5R price, 205.36, first traded on 2025-05-21, the ninth session after the entry day). The most recent clean example in the data. |

Caveats on the examples: five of the ten (SNPS, FDX, SAM, URI, DY) are turns after a market-wide selloff (1998, 2001,
2020, 2022, 2025), which is the setting the sources describe (8.7); none has a group or market reading attached; prices
are split-adjusted by the data vendor (AMD, NUS, SNPS, NTAP and FDX trade at much higher prices now than then); SNPS and
FDX predate the earnings table, so B22 could not be checked for them.

**Notable failures (Version H, stopped under 1R).**
- META 2020-05-11 and again 2020-06-10: after the March 2020 low it reclaimed the 50-day and then the 200-day, paused
  13 and later 34 sessions, broke the pause high, and was stopped without trading above the entry both times (best 0.0R each); the real move came
  later from a third base. A 4B- after a V bottom can fail twice before it goes; the rule re-arms on a new pause (8.5).
- MSFT 2001-05-07 and 2001-06-05: a 66% Stage 4 decline from the 2000 top, a long base, 18- and 38-day pauses above the
  50-day, both breaks stopped (0.3R, 0.6R). The 200-day was not overhead supply: it sat 16.1% and 18.2% under the closes
  (30.74 under 35.69; 30.70 under 36.30) and was flat through the first trade (30.74 on 05-07, 30.75 on 05-16) after a fall of
  2.0% in the 20 sessions before the trigger (-0.1% before the second). Room to run passed because nothing was
  overhead; with the line this flat under the trade, MSFT is a weak example of the falling-line cue that separates it
  from PENN's or NUS's flat ones (section 9) (corrected 2026-11-10 against the bars):
  the earlier text had the stock trading under a falling 200-day, which would be overhead supply.
- TGT 2008-09-03 and 2009-04-30: two 4B- triggers, the first in the 2008 bear and the second in the rally that began in
  March 2009. Both closed above their 200-days (6.4% and 6.5% over; the line was still falling, -1.7% and -2.3% over 20
  sessions) and both were stopped the next session, 0.0R by the scan's convention (the first day's high, 55.83, was over
  the 55.50 entry on the bar that also took the 53.95 stop; the second day's high, 41.30, stayed under the 41.37 entry).
  The market reading, which the scan could not test, is the missing filter for the first (B18, F65, "forest to the
  trees"); the second came in a rally, where the reading may not have kept it out (not tested) (corrected 2026-11-10 against the bars): the earlier
  text had both in the bear, under a falling 200-day, and neither trading above the entry.

## 13. Failures and near-misses (from our data)

Charts in `_study-resume/scratchpad/setups/10-weinstein-4b/final/`: `fail_1-4.png` (the four failures, one column),
`near_1-4.png` (the four near-misses), `pair_13-ma-reclaim.png` (a 4B- above an MA Reclaim). Every chart carries the
same buy point (the pause high), stop, 3R and 5R lines, the pause box and the cycle-low and higher-low marks the
winners carry, with the 50, 150 and 200-day lines. Numbers are read off the daily bars; "N sessions later" counts
from the day after the entry day. All four failures are Version H (close above the 200-day), the version the house
trades; the first three are the ones section 12 names.

**Four failures (every rule in section 12 passed; the stop was hit before 3R).**

| # | Ticker | Trigger | Buy / stop | Where it stopped | What happened | Criterion |
|---|---|---|---|---|---|---|
| 1 | MSFT | 2001-05-07 | 35.59 / 33.93 (4.7%, day low) | 7 sessions later, 2001-05-16, low 33.66 | A 66% Stage 4 decline from the 2000 top to a 20.16 low, a 92-session base, an 18-day pause over the 50-day; the trigger day closed mid-range, the trade reached 0.28R and was stopped a week later. The 200-day sat 16.1% under the close (30.74 under 35.69) and was flat through the trade (30.74 to 30.75) after a 2.0% fall in the 20 sessions before it, so not overhead (corrected 2026-11-10 against the bars). A second trigger on 2001-06-05 also stopped (0.63R). | w4b.long_averages_flat (a falling long average over the trade; a grading cue) |
| 2 | TGT | 2008-09-03 | 55.50 / 53.95 (2.8%, day low) | 1 session later, 2008-09-04, low 53.71 | A 40% decline to 42.32, a higher low only 4% above it, a 13-day pause; the trigger day closed mid-range and the next session fell through the 2.8% stop. Best 0.0R by the scan's convention (the next session's high, 55.83, was over the 55.50 entry, but the same bar took the stop), in the 2008 bear. A second trigger on 2009-04-30, in the rally that began in March 2009, did the same (entry 41.37, stop 39.75). Both closed above their 200-days, 6.4% and 6.5% over (corrected 2026-11-10 against the bars). | w4b.market_reading (the missing filter; not in the scan) |
| 3 | META | 2020-05-11 | 213.22 / 210.32 (1.4%, day low) | 1 session later, 2020-05-12, low 210.00 | A 39% drop to the March 2020 low, a higher low 10% above it, 37 sessions off the low, a 13-day pause above the 50-day; the break of the pause high closed mid-range and the next day took the 1.4% stop. Best 0.0R; the second trigger on 2020-06-10 also stopped. The real move came from a third base. | w4b.higher_low (a V bottom; the rule re-arms on a new pause) |
| 4 | F | 2024-02-12 | 12.99 / 12.59 (3.1%, day low) | 1 session later, 2024-02-13, low 12.48 | A 37.5% decline to 9.63, a higher low 3.6% above it, 70 sessions off the low, a 12-day pause; the trigger day closed near its high and the next session fell through the 3.1% stop. Best 0.0R. | w4b.after_entry_stop (nothing in the setup was wrong) |

**Four near-misses (each looks like a 4B- and fails exactly one gate of the card).** Found by re-running the section
12 scan with every gate relaxed and keeping the candidates that fail one and only one gate (2,546 of 2,630 names in
the 420-second budget); the Version W case comes from the strict scan itself, which recorded hits under the 200-day
for the comparison in section 12. Room to run (851), the higher low (834) and volume into the higher low (810) were
the gates most often missed on their own.

| # | Ticker | Date | The one criterion that fails | The number | What it really is |
|---|---|---|---|---|---|
| 1 | BAC | 2020-06-04 | w4b.version_h_200 | close -10.2% under the 200-day on the day before the trigger; the house version (H) needs the close above it (B26) | Weinstein's own version (W): a 50% decline, a 12% higher low and a 50-day reclaim with the close still 10% under the 200-day. The scan's W hits did better (30% reached 3R against 22% for H), but B26 forbids a long under the 200-day; BAC reached 3.37R. |
| 2 | COST | 2022-07-22 | w4b.stage4 | at the cycle low the 150-day was rising (528.74 against 521.41 20 sessions earlier) | A 34% drop under a 150-day that was still rising at the low: a pullback in an uptrend, so a Remount (13) or a pullback buy, not a Stage 4 turn. Best 0.17R. |
| 3 | CVX | 2024-11-21 | w4b.depth | cycle low 21% under the 52-week high; the rule needs 30% | A 21% dip and a 50-day reclaim on a stock whose 52-week high was never far away: a pullback inside a range, not a 4B-. Best 0.86R. |
| 4 | AAPL | 2019-03-22 | w4b.higher_low | the scan found the pullback into the higher low too shallow: the 39.47 high before it was only 4.1% over the 37.92 higher low, where the scan needed 5%; but the rally before the higher low was 11.2% (35.50 on 2019-01-03 to 39.47 on 01-18), so as the card is written (a rally of 5% or more before it) this AAPL passes the gate (corrected 2026-11-10 against the bars): the earlier text said no 5% rally came before it | A V off the January 2019 low: the higher low (37.92 on 2019-01-23, 13 sessions after the low) sits 6.8% above the cycle low and followed an 11.2% rally, then a pullback of only 4.1%; the scan read that shallow pullback as one leg, not a base. Stopped at a best of 0.0R. |

**What the failures have in common.** All four triggered with a 200-day that was still falling on the trigger day
(the close was above it, as Version H requires, but the line itself had not turned), and three of the four were out
the next session with a best of 0.0R (the scan's convention when one bar holds both the stop and a high over the
entry: TGT on 2008-09-04 and META on 2020-05-12 did trade over the entry that day, then through the stop; F did not):
the break of the pause high had no follow-through. Two came in a bear
market (TGT 2008, MSFT 2001; TGT's second trigger came in the March 2009 rally) and one off a V bottom (META 2020), the three contexts the dossier already flags; F 2024
is the plain case of a correct 4B- that lost. The stops were close (1.4% to 4.7%) and the room-to-run test passed on
paper, so none of the four cost more than 1R; the learner's read is that a 4B- is a bottoming trade with a 22% hit
rate at 3R, that a falling 200-day under the trade is the grading cue that separates these four from PENN and
NUS, and that a second trigger after a failed one (META, MSFT, TGT all had one) is not a better trade.

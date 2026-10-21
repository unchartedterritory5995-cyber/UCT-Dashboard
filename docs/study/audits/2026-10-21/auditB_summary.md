# Audit B: regime.bottoms + size.house_rule (2026-10-21)

Verdicts: `auditB_verdicts.jsonl` (126 lines = 48 bottoms + 78 sizing drafts; the 6 approved sizing items were skipped).
Line count checked against the bank: the set of item ids in the file equals the set of in-scope ids exactly, with no duplicates and no approved items.
Scripts: `auditB_size_check.py` (recomputes every sizing answer), `auditB_build.py` (applies the verdicts, writes the fixes, runs the grounding and voice checks).
Nothing under the repo was written.

## Counts

| segment | in scope | keep | fix | hold | cut |
|---|---|---|---|---|---|
| regime.bottoms | 48 | 0 | 0 | 17 | 31 |
| size.house_rule | 78 | 14 | 42 | n/a | 22 |

Codes. Bottoms: trivia 25, unverified_fact 19 (the 17 holds plus 2 cuts whose dates are weekends), ambiguous 4.
Sizing: thin_lesson 36, duplicate 15, ok 14, degenerate 7, other 3, missing_wide_stop_note 2, voice 1.

Sizing by item type:

| type | keep | fix | cut |
|---|---|---|---|
| forward, first batch (14 drafts) | 7 | 2 | 5 |
| forward, tight batch (16) | 7 | 3 | 6 |
| reverse (12) | 0 | 12 | 0 |
| cap table (10) | 0 | 7 | 3 |
| skip (6) | 0 | 3 | 3 |
| flat vs quality-scaled (8) | 0 | 6 | 2 |
| drawdown ladder recall (8) | 0 | 6 | 2 |
| ladder + size (4) | 0 | 3 | 1 |

What reaches Patrick from sizing: 14 keep + 42 fix = 56 items, plus the 6 he already approved.

## Sizing: what I found

1. **No arithmetic errors.** I recomputed all 84 items, approved ones included, with exact decimals from the numbers in the question.
   - Forward items: shares = floor(account × risk % ÷ (entry − stop)), dollars = shares × entry.
   - Capped items: floor(cap % × account ÷ entry).
   - Skip items: zero shares means skip.
   - Reverse items: position % × stop % ÷ 100.
   - Ladder items: the 6 / 8 / 10 thresholds.

   Every key matches. No answer sits exactly on a whole-share boundary, so floating-point floors cannot flip any of them. The `checked` field on each line shows the working.
2. **The owner's three rulings hold on every forward item.** Every forward stop wider than 10% carries "far wider than the desk would ever use". Every forward position over 20% carries the trim-to-20-25% note. Gap: the generator's skip lessons never apply the wide-stop rule, so the two skip items I kept with 12% and 15% stops get it in their fix. The generator should apply it too.
3. **Thin lessons (36 fixes).** Every type except forward is a one-line template. The standing rule says every lesson is a full explanation, so each fix answers the follow-ups:
   - Reverse: why risk is size × stop, the formula run backwards, the 2% ceiling, the gap risk.
   - Cap: how the capped shares come out, and that the risk drops under budget.
   - Skip: why you can't round up or tighten the stop.
   - Flat vs scaled: what the choice is.
   - Ladder: the full ladder, where this drawdown sits on it, and why size is cut.

   All 42 fix texts were generated from the item's own facts, and a script checked them:
   - every number in a lesson appears in `answer_json` or `reveal_json.facts`, so the importer's grounding check will pass;
   - no sentence is over 22 words;
   - no em-dash, no banned phrase, no "tape", "regime" or "dial";
   - articles are right ("an 8%", "an A+").

   Forward lessons are kept as they are. That is the style the owner approved on items 1-8, and he called the forward math settled.
4. **Degenerate answers (7 cuts).** Five 1- and 2-share answers, where the round-down, not the math, decides the answer. One capped answer of 1 share. And si_05ea5ee88915, where risk % equals stop % (2% and 2%), so the formula puts 99.7% of the account in one stock while the lesson says "you can take the trade this size". The 1-share item the owner approved (si_4f7a0c7a1af7) is still in the bank; si_64c7c21fadcb is the same 0.25% / 8% case with 23 shares, if he wants to swap it.
5. **Duplicates (15 cuts).** Each names the item it repeats:
   - Wide stops: the owner wanted only 2-3 wide-stop (12-15%) examples, and 4 are already owner-reviewed. The extra 12% and 15% forward items are cut.
   - The 2% risk / 8% stop shape: he reviewed it on si_111811fac905 and asked for tighter stops, so the two repeats are cut.
   - Same-shape repeats: skip items (6 built the same way, the 3 closest calls kept), drawdown cases with the same answer and reason, one ladder+size twin, two cap twins, and one flat/scaled pair. For a cap item the shares depend only on cap × account ÷ entry, which is why two items with the same cap and account count as twins.
6. **Invented house rule (3 fixes, code other).** The quality-scaled lessons say "a A+ setup gets 1.5%" and "a B setup gets 0.5%". sizing_rule.md has no grade-to-risk table; it says 0.25-2%, chosen by quality, performance and market. The fix says "this plan puts 1.5% on an A+ setup".
7. **Positions near or past 50% (5 fixes).** These are si_d0c4fcd38430, si_b60168235fb2, si_303c63739664, si_aaa9600701b7 and si_162bd1cdc4ba, at 49.7-74.7% of the account. The ruling keeps the formula answer and the trim note. The fix adds sizing_rule §2.5 ("A tight stop never licenses a monster position. A stop can't catch an overnight gap...") so the lesson answers why the trim matters.
8. **Voice.**
   - "A 8% stop" in si_b7aa411baac5's question (fixed).
   - "a A+" and "After a 8%" in lessons (fixed by the rewrites).
   - Generator-wide: money prints as "$2858.4" or "$25.6", with one decimal and no thousands comma, because `fmt()` keeps grounding to one token. A proper money formatter needs the grounding check to accept "$2,858.40".
   - The owner's own trim sentence is 30 words, over VOICE's 22-word lesson limit. I left it as he wrote it.
9. **For the owner to decide (not item defects).**
   - The cap items assume the member knows the app's cap table (houseSizing.json); the question does not show it. If M13 doesn't teach the table first, state the cap in the question.
   - GREEN A+ caps at 25% while the forward lessons call 20% "the desk's max". The two only fit together through his "trim toward 20-25%" band.
   - The drawdown ladder is still marked owner-to-confirm (sizing_rule §8 #1).
   - At exactly 25% (si_06bdc596f418) the trim note says "trim toward 20-25%" about a position already at 25%.
   - Every size key carries both shares and dollars, and the scorer needs the dollars within $1. So in practice the shares must be exact, and the 1-share tolerance never helps a member.

### Stop width and position size (sizing)

All 64 items that carry an entry and a stop (forward, tight, flat, scaled, cap, skip, ladder+size), including the 6 approved.
"Reaching Patrick" means approved + keep + fix (44 items).

| stop width | 1.5-2% | 2.5-3% | 3.5-4% | 5-6% | 8% | 10% | 12% | 15% |
|---|---|---|---|---|---|---|---|---|
| all 64 | 9 | 11 | 10 | 5 | 13 | 4 | 6 | 6 |
| reaching Patrick (44) | 7 | 8 | 7 | 5 | 9 | 2 | 3 | 3 |
| forward-type, all (44) | 6 | 4 | 6 | 5 | 13 | 2 | 5 | 3 |
| forward-type, reaching (31) | 5 | 2 | 5 | 5 | 9 | 1 | 2 | 2 |

The formula position is the size before any cap or trim.

| formula position (forward-type) | <10% | 10-20% | 20-25% | 25-50% | 50-75% | 75-100% |
|---|---|---|---|---|---|---|
| all (44) | 18 | 11 | 5 | 7 | 2 | 1 |
| reaching Patrick (31) | 11 | 9 | 3 | 6 | 2 | 0 |

Against the owner's ask (most stops 1.5-6%, a few at 8%, only 2-3 at 12-15%):

- **1.5-6% stops:** 17 of the 31 forward-type items reaching him.
- **12-15% stops:** 4, all ones he already reviewed (si_9d442ebbc314, si_718773c087f6 and si_c049b16f2ba8 approved; si_50d28d98a52a carries his fix).
- **8% stops:** still 9. Four of them are the flat/scaled pairs, which the generator draws only from 4-8% stops. Regenerating those pairs at 2-5% would bring the mix in line.

Answers of 3 shares or fewer still reaching him: si_4f7a0c7a1af7 (1, approved), si_718773c087f6 (3, approved), si_f5eee0504e45 (3, kept: it uses 92% of the budget).

### Generator changes this audit implies (scripts/study/gen_size.py)

- Require at least 4 shares, or at least 90% of the risk budget used, on any non-skip answer.
- Forbid risk % ≥ stop %, or cap the formula position near 75%.
- Apply the wide-stop rule in `skip_items`.
- Draw the flat/scaled stops from `STOP_PCTS_TIGHT`.
- Write "an" before 8, 11, 18 and A+.
- Drop the "a A+ setup gets 1.5%" wording.
- Promote the lesson templates in the fixes into the generator, so a regeneration does not undo them.

## Bottoms: what I found

1. **Every key matches the catalog exactly.** I re-parsed `bottomsCatalog.js` myself. For each signpost item, the key is the signpost at that position in date order, and same-date signposts are accepted (2016, 2011, 2009, 2002). For each drawdown item, the key equals `drawdownPct`. One display caveat: the 1974 catalog lists Capitulation before Volatility Peak, while the keys follow date order. If the app's timeline shows the listed order, the timeline and the key disagree.
2. **The catalog itself shows signs of being invented.** None of this needs price data.
   - Two signpost dates are not trading days. 2023-01-15 is a Sunday, and Monday 2023-01-16 was MLK Day. 2003-03-15 is a Saturday.
   - Internal contradictions:
     - 2020: the execution text says the follow-through came "six days off the low", but the 2020-03-26 signpost is the 3rd session.
     - 1987: the drawdown low is 1987-12-04, but the note says the 12-04 retest "held above the crash low".
     - 2009: the 03-09 breadth note says March had fewer new lows than November, so by the catalog's own definition the washout was in November.
     - 2020-03-23 and 2018-12-26: both are labelled News Failure but don't fit the catalog's own definition (bad news that fails to make a new low).
   - My recollection, which needs checking:
     - 1987's "-22.6%" is the Dow's drop, in an S&P 500 case.
     - The 2011 summary's "Draghi/EU relief" in October 2011 comes before Draghi took over the ECB (November 2011).
     - The Fed's "unlimited" QE came the morning of 2020-03-23, not "the day before".
3. **Teachability.**
   - "Which signpost fired third in the 2011 Crisis Low?" can only be answered by memorizing one catalog's curated order, so I cut it as trivia.
   - The drawdown numbers are also trivia. Their questions print ISO dates and don't state the basis (close or intraday), and 2011's -19% key sits next to a -20% distractor.
   - The pre-1993 cases (1987, 1974) ship with no chart.
   - Breadth, volatility and leadership signposts can't be seen on an index price chart.
4. **The 17 holds** are the Capitulation, News Failure and Follow-Through Day items that ship a SPY chart cut at the signpost date. These three can be read from the index's own price and volume, so they are teachable as a chart read. Each hold's fix rewords the question to "{Bottom}. The chart ends on the day one signpost fired. Which one?". Then:
   - Check the date and note on real bars. If the last bar doesn't show the event, cut the item.
   - Changing `q` changes the item id (the id is built from source_ref + q + subject). These are drafts with no verdicts, so nothing is orphaned.
   - Confirm the question chart stops at `asof`. `bars.forward = 20` should appear only in the reveal.
   - The 2002 case is the Nasdaq but `bars.sym` is SPY; use QQQ, which has daily bars from 1999.
   - Volume claims ("record volume", "heavier than the prior session") need exchange volume; SPY volume is only a proxy.
   - Several holds carry a choice that a chart reader could defend. The reason on each line names the choice to swap: Volatility Peak or Breadth Washout on flush days, and Breadth Washout on 2008-11-20, which is also true by the catalog's own words.
5. **All 48 lessons are thin** ("X fired here. Count the signposts, not the days." plus the catalog note). Lessons for the three hold types are below. They use only the catalog's signpost definitions and no market facts. After the price check, add the item's verified note.
   - Capitulation: "That's capitulation. The last bar is a big down day on volume well above normal, after a run of red days. It's the flush: everyone who is going to sell, sells. It means the market is running out of sellers, not finding buyers. So it isn't a buy signal on its own. Next you want bad news to fail to make a new low, then a follow-through day."
   - News Failure: "That's the news failure. Bad news hit, price undercut the prior low, then reversed and closed green. When bad news can't push price lower, the sellers are spent. It marks the turn, not the confirmation. I still wait for a follow-through day before I press."
   - Follow-Through Day: "That's the follow-through day. A few sessions after the low, the index rallies hard on heavier volume than the day before. It's the sign big buyers are stepping back in. It can fail, so the stop goes under the low. This is where you start watching the names that break out first."
6. **A better replacement for this segment:** questions about the signposts themselves rather than one bottom's dates. For example: "What does a bottom usually show first?" or "Bad news hits and price holds above the low. Which signpost is that?" These need no dated market facts. But BOTTOM_SIGNPOSTS is AI-written too, so Patrick signs off the definitions first. Leave out its line "No bottom of consequence has ever happened without one"; that is a market claim.

### Distinct bottoms facts that need a price check (bottom, claim)

[HOLD] marks a fact that a hold item depends on, so check it first. [cut] facts matter only if a cut item is revived. In brackets: what to check it against.

- 2022 Rate Bear: S&P 500 fell -25% from 2022-01-03 to 2022-10-13 [index bars; 10-13 is the intraday-low session, close basis unstated] [cut]
- 2022 Rate Bear: 2022-09-30 % of S&P stocks above their 200-day in single digits [breadth data; my recollection says low teens] [cut]
- 2022 Rate Bear: 2022-10-11 VIX in the mid-30s, the volatility peak [VIX; earlier 2022 closes may be higher] [cut]
- 2022 Rate Bear: 2022-10-13 hot CPI gapped to new lows, then reversed about +5% intraday [index bars + news] [HOLD]
- 2022 Rate Bear: 2022-11-10 follow-through thrust on heavy volume [index bars, session count from the low; an earlier qualifying day may exist] [HOLD]
- 2022 Rate Bear: 2023-01-15 leadership (NVDA, META) [a Sunday; leader stock bars] [cut]
- COVID Crash: S&P 500 fell -34% from 2020-02-19 to 2020-03-23 [index bars] [cut]
- COVID Crash: 2020-03-12 a -9.5% day, circuit breakers, record volume [index bars + exchange volume] [HOLD]
- COVID Crash: 2020-03-16 VIX closed at 82.69, a record [VIX] [cut]
- COVID Crash: 2020-03-23 climactic low, "the day before the Fed went unlimited" [index bars + news; Fed timing suspect] [cut]
- COVID Crash: 2020-03-26 follow-through after three up days [index bars; the catalog's own "six days off the low" conflicts] [HOLD]
- COVID Crash: 2020-04-06 ZM, NVDA, SHOP, DOCU, AMD broke out first [leader stock bars] [cut]
- Christmas Eve Low: S&P 500 fell -20% from 2018-09-20 to 2018-12-24 [index bars] [cut]
- Christmas Eve Low: 2018-12-21 quad-witching flush on record December volume [index bars + exchange volume] [HOLD]
- Christmas Eve Low: 2018-12-24 new 52-week lows surged [breadth data] [cut]
- Christmas Eve Low: 2018-12-26 +5% reversal day, largest Dow point gain at the time [index bars + Dow] [cut]
- Christmas Eve Low: 2019-01-04 jobs number + Powell "patient" drove a volume thrust [index bars + news] [HOLD]
- Christmas Eve Low: 2019-01-15 software (TTD, COUP, AYX) and chips led [leader stock bars] [cut]
- 2016 Double Bottom: S&P 500 fell -15% from 2015-05-20 to 2016-02-11 [index bars; close basis may round to -14%] [cut]
- 2016 Double Bottom: 2016-01-20 capitulation flush as WTI broke $27 [index bars + oil] [HOLD]
- 2016 Double Bottom: 2016-02-11 undercut the January low intraday, reversed and held [index bars; my recollection says a red close, reversal on 02-12] [HOLD]
- 2016 Double Bottom: 2016-02-11 new lows peaked at the retest [breadth data; my recollection says fewer new lows than January] [HOLD, accepted answer]
- 2016 Double Bottom: 2016-02-17 breadth thrust, McClellan surged [index bars + breadth] [HOLD]
- 2016 Double Bottom: 2016-03-01 FANG and NVDA reasserted leadership [leader stock bars] [cut]
- 2011 Crisis Low: S&P 500 fell -19% from 2011-05-02 to 2011-10-03 [index bars; basis decides -19 vs -20] [cut]
- 2011 Crisis Low: 2011-08-08 a -6.7% day after the US downgrade, volume climax [index bars] [HOLD]
- 2011 Crisis Low: 2011-08-08 VIX spiked above 48 [VIX] [HOLD, accepted answer]
- 2011 Crisis Low: 2011-10-04 undercut the August low intraday, reversed +4% to close green [index bars] [HOLD]
- 2011 Crisis Low: 2011-10-10 thrust day on heavy volume [index bars] [HOLD]
- 2011 Crisis Low: 2011-10-20 AAPL and consumer leaders broke out [leader stock bars] [cut]
- Generational Low: S&P 500 fell -57% from 2007-10-09 to 2009-03-09 [index bars] [cut]
- Generational Low: 2008-11-20 climactic flush on record volume [index bars + exchange volume] [HOLD]
- Generational Low: 2008-11-20 VIX closed near 81 [VIX] [HOLD, accepted answer]
- Generational Low: 2009-03-09 low on positive breadth divergence, fewer new lows than November [breadth data] [cut]
- Generational Low: 2009-03-12 thrust on expanding volume [index bars] [HOLD]
- Generational Low: 2009-03-23 AMZN, AAPL, FFIV, GMCR broke out [leader stock bars] [cut]
- Dot-Com Bottom: Nasdaq fell -78% from 2000-03-10 to 2002-10-09 [index bars] [cut]
- Dot-Com Bottom: 2002-07-23 washout flush on heavy volume [Nasdaq bars; the reversal may be 07-24] [HOLD]
- Dot-Com Bottom: 2002-10-09 undercut the July low and reversed [Nasdaq bars; may have closed at the low] [HOLD]
- Dot-Com Bottom: 2002-10-09 new lows peaked at the retest [breadth data] [HOLD, accepted answer]
- Dot-Com Bottom: 2002-10-15 +4% thrust on heavy volume [Nasdaq bars; which index's +4%] [HOLD]
- Dot-Com Bottom: 2003-03-15 homebuilders, energy, AAPL led [a Saturday; leader stock bars] [cut]
- Black Monday: S&P 500 fell -34% from 1987-08-25 to 1987-12-04 [index bars] [cut]
- Black Monday: 1987-10-19 -22.6% in one day [index bars; -22.6% is likely the Dow] [cut]
- Black Monday: 1987-10-20 volatility extreme not matched until 2008/2020 [no VIX in 1987] [cut]
- Black Monday: 1987-12-04 retest held above the crash low [index bars; conflicts with the catalog's own low date] [cut]
- Black Monday: 1987-12-08 thrust off the December low [index bars] [cut]
- 1974 Secular Low: S&P 500 fell -48% from 1973-01-11 to 1974-10-03 [index bars] [cut]
- 1974 Secular Low: 1974-09-13 fear and realized volatility peaked [no volatility index; realized vol undefined] [cut]
- 1974 Secular Low: 1974-10-03 final washout [index bars] [cut]
- 1974 Secular Low: 1974-12-06 December retest held [index bars] [cut]
- 1974 Secular Low: 1975-01-02 January thrust launched a +30% rally [index bars] [cut]

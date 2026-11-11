# The criteria cards: what the writers flagged (2026-11-10)

All 44 cards in `criteria/` validate (`python -m scripts.study.criteria_lib`; `tests/test_study_criteria.py`, 83 green).
Totals: 1,997 criteria (873 settled by a rule or a verdict, 624 proposed, 500 waiting on the owner across 137 decisions),
205 look-alike tells, 168 failures tied to a criterion, 847 question seeds (recall 132, spot 132, discriminate 155,
scenario 159, grade 112, numeric 157). Every card was written from its dossier only; nothing below is a ruling.

## 1. Where a card follows its dossier and the register's default says otherwise

The card keeps the dossier's recommendation as `recommended` and shows the register's default as an option. One answer
in `DECISIONS.md` settles each.

| Setup | Criterion | Dossier | Register default |
|---|---|---|---|
| 17 Holy Grail | hg.touch | a strict touch | D-080: within 0.25 ATR |
| 17, 31 | hg.stop_width, ss.stop_width | size down / 6.5% cap | D-005: one ADR skip line |
| 31 Slingshot | ss.pullback_length | 3 to 7 closes | D-107: 3 to 8 |
| 32 Remount | rm.no_chase | the line (A) / the quiet day's high (B) | D-022: the trigger |
| 41 30-Minute Pivot | red-string gate | 2 (3 graded higher) | D-126: 3 |
| 44 Opening Drive | trigger bar | the 5-minute opening-range high | D-031: the 30-minute bar taught, 5-minute advanced |
| 34 Capitulation, 38 Parabolic Long | size and market reading | the dossier's first option | D-023, D-041 |
| 29 Undercut & Rally | ur.level | the owner's full list (c) | (b) plus gap lows |
| 30 Oops | oops.breakeven, oops.stop_width | 2R; option C | first trim; up to one ADR |
| 35 Wyckoff | spr.range_length, spr.reclaim_window | 20 sessions; 2 days | 15 sessions; 3 days (glossary) |
| 05 IPO Base | ipo breakout volume | a gate (1.4x the base's sessions) | D-006: a cue everywhere |
| 07 Launchpad, 09 Trendline | lp.launch_volume, tl.volume | a gate | D-006: a cue |
| 10 4B | 50-day flattening | a rule in 8.1 | D-070: a cue (it rejects NFLX) |
| 42 Go Signal | go.at_support, go.hourly_flag | 9/10 EMA and prior low allowed; flag required at 10% | D-130 excludes them alone; D-131 says 5% |
| 25 Gap Support | gs.post_gap_high_trim | settled on the 2026-11-09 verdict, read as the first third early | if he meant the game stop only, flip to pending D-013 |
| 20, 21, 22 | C29 on day one | EP and gapper exempt the gap day; PEG applies it | D-017: one ruling for all three |

## 2. Conflicts between dossiers in one family

- **Burst count (34 vs 38, 39, glossary):** Capitulation allows 3 of 5 boxes with the gap the next morning; the parabolic cards need the climax-day gap plus 3 of the other 4. D-002 (one unit or two) decides it; the cards keep the two triggers separable (undercut-and-reclaim within 3 sessions vs the same-day VWAP reclaim).
- **Reclaim windows:** 2B up to 3 sessions, U&R 3, Wyckoff spring 2 days, Remount from 5 closes under; the 4-close gap between U&R and Remount is the glossary's resolution (U&R family to 4, Remount from 5). 28 uses a 5-session swing low, 29 a 3-bar one.
- **Catalyst family volume floors:** EP 3x (gate), PEG 1.5x with 3x for an A, gapper 3x; the scans found no edge beyond the floors.
- **Scope of EP / PEG / News Gapper:** 22 claims every catalyst gap; 21 keeps non-earnings news out of the PEG; the cards follow D-002 (EP and PEG traded, 22 the family lesson for the pullback-and-reclaim).
- **Moving-average family:** the trigger (11 intraday turn, 12 prior-high break, 13 reclaim close; all D-003); the 20 EMA rising window (11 and 12 use 10 sessions, 14 and the glossary 5); pullback length (11: 2 to 15, 12: 2 to 8, 14: 2 to 10); which tap (11/12 first or second, 14 first only); the 200-day window (12: 21 sessions, glossary 20).
- **Prior-trend window:** 04 and 06 measure the 30% advance over 120 / 126 sessions (glossary canonical 65).
- **"Tight":** 04 a fixed 3% close spread, 05 the two-4%-days test, glossary a 0.85 ratio.
- **EMA pair:** 09 keeps Kell's 10/21 against D-021's 9/20 default; 17's line question is the same decision but Part D does not map D-021 to it.
- **ATR length:** 38 and 18 use Bracco's and Kell's ATR(20); the glossary and the other cards ATR(14).
- **Wedge Pop in two dossiers:** 15's measures (8 of 15 closes under the 20 EMA, 0.85 range test, volume above the prior day) and 18's (15% correction, 3 tightening sessions, volume at the 50-day average) differ; 15's card is the full one, 18's lines are flagged under D-006 / D-077.
- **Qullamaggie depth:** the dossier's 25% cap rejects the owner's "textbook 5 star" MRAM (34 to 42% back); no Part D row maps it, so qk.breakout_depth carries the MRAM number as an option. He should rule before it is taught.
- **Short-side family:** 16 and 39 agree the Wedge Drop never uses the parabolic exception; 36's short mirror overlaps 16's bounce and 39's extension (tells by the stall or the burst count plus the 200-day side).
- **Bull Flag heavy red day:** rule 8 forbids one, 8.5 invalidates on two; the card keeps both (one drops the grade, two end the flag).

## 3. Lines the writers could not make measurable (kept as text or a stand-in, each says so)

"crowded positioning" (23, 38), the named catalyst itself (20, 22, 23), PEG "orderly pause" (made 2 to 10 sessions with every close above the gap-day low), 43 "structure before", 41 "no fixed depth", 34 / 36 "location" (a list of levels, no distance), 38 "shape" (box 3 stands in), 04 shape symmetry and "leading group", 06 tight closes and the shakeout cue, 10 "first in the group", 28 "near the averages" and "clean lead-in" (borrowed bands), 13 "light-volume reclaim" (reclaim-day volume below the break day's), 14 "repeated failed crossbacks", 11 "many leaders flagging", 07 the V rally and "the stock can move", 09 "a structure behind the line" and "not wedging up", 37 the same-day form (needs 30-minute bars, D-117), 18 the Reversal Extension's "averages spread apart", the crossback's "drifting down gently", "sell part into the strength", 24 "fresh catalyst", 26 "not messy", 16 "wide and loose", 27 several level and timing lines, 39 "open wait", "round number", the VWAP reclaim.

## 4. Register map quirks to fix in `DECISIONS.md` Part D

- 24:6 maps to D-020; the RS question is really D-011 (whose default exempts an EP or HVE on a neglected name). `hve.leadership` carries D-020 and names D-011.
- 23:4 (B26 and C31 for the short) maps to D-009, not D-011.
- 36:9 (shorts above the 200-day) maps to D-001 though it is a 200-day question.
- 02:14 (the Model Book text) maps to D-010; D-014 is the natural home.
- D-021 (which EMA pair) is not mapped to 17 though the Holy Grail's line question is the same.
- 15 has no D-025 row, so wp.not_earnings_day (an earnings-day pop is an EP) is proposed, not pending.
- 11:17 (B22: trading or calendar days) is a rulebook clarification, filed under setup 11 (D-072).

## 5. House records the cards found wrong (to fix after the ruling they depend on)

- `UNITS-method.md` SET.23 calls the Kicker a "catalyst gap" with "the cleanest RED TO GREEN entry" and "stop under the gap"; the 2026-11-02 rulings make it a PREV DAY HIGH BREAK over the red day's high. M9.L5 says the same.
- The Model Book "30-Minute Pivot" card, the course script and `definitions.json` describe the ORB (setup 40), not the pivot at support (41); D-002 separates them.
- Study's `chart_words.json` defines the inside-day trigger as the two-day high; the dossier's rule is the inside day's own high (D-064).
- The parabolic short scanner, the voice KB entry, the patterns description, the plan template ("size small", "do not re-short") and the Model Book glyph all contradict the sources (D-004). Bracco's two ATR-multiple formulas give different numbers for the same stock (SMCI 9.88 vs 25.67); the card fixes Jeff Sun's percent form (D-121).
- The curriculum maps Remount as PREV LOW RECLAIM; the card's Entry B is a PREV DAY HIGH BREAK. Oops is filed RED TO GREEN (the main version reclaims the prior close); the Williams form is a prior-low reclaim. 4B is filed PREV DAY HIGH BREAK (the pause high).
- 33 Failed H&S is a LONG in every house record (Model Book, SET.29, Bracco's posts); the brief called it a short. The card is the long; the mirror short had no measured edge.
- 27 Bear gap: "no trade in the app today" stays; the only positive slice in the test (earnings collapses one to three sessions off a fresh high, +0.36R, 268 trades) is exactly the shape he cut as "earnings breakdown" (D-025).

## 6. Data checks before anything is taught

- HAE 2026-06-04 (Slingshot) closes over its 200-day on the sandbox bars, not under it as the verdict note says; check the live chart before B26 is applied.
- INTC 2014-06-13 and CCJ 2025-05-23 (News Gapper), STNG and NBIS (News Failure) are "news" or "unknown" by database class only; confirm the headline before they are taught as news models.
- AVWAP and RS 80: 9 of the 10 AVWAP examples score under 80 on the proxy because the required 4 ATR fall pulls a 12-month rating down; applied literally C31 removes most of these trades (D-011).
- On 13 only 4 of the owner's 16 named remounts pass every proposed rule; on 11 his own three examples break the 1 ATR-from-line cap (D-071).
- HTF: every Minervini 2017 line is unverified in the dossier; the card cites it only beside another source.
- Scan-vs-grading findings the cues keep with a caveat: ORB later triggers did better than early ones in the one window; the Opening Drive's "opens above the prior day's high" A+ mark ran the wrong way; the 2x volume floor did not help; Version W of the 4B scored better than Version H; Flat Base and Bull Flag "10% or less deep" is not better in the data.

## 7. Source ids

Cards cite sources by the id `criteria_lib.dossier_source_ids` derives: explicit `S<n>`, a `| n |` row, a `1. ` item, or the
position in reading order where a dossier numbers nothing (02, 03, 07, 08, 09, 11, 12, 14, 16, 17, 18, 19, 24, 31, 36, 37, 38).
Each such card's first `conflicts` line records the map. If a section 11 is re-ordered, those citations shift. Known
quirks: 03's S14 is a Bulkowski table header the reader counts (nothing cites it); 26's ids come from the numbered
"Removed in checking" list inside section 11 while the card cites the unnumbered table rows by position, both in range.

## 8. What the failure and near-miss run found (2026-11-10)

Every setup now has four correctly traded losses and four near-misses charted, each tied to the one criterion it
fails (176 near-misses on 176 distinct criteria, 244 failures listed on the cards, 44 confusable-pair sheets), written
into each dossier's "Failures and near-misses (from our data)" section and the card's `examples`. Checking every pick
against the bars and the earnings table corrected some earlier text:

- **Earnings-window violations mislabelled as setup failures:** Slingshot FSLR 2013-05-06 and BIIB 2022-10-24 (report the next session; relabelled `ss.earnings_window`), Trendline IFF 2020-08-10, Capitulation WDC 2024-07-29, and the AVWAP picks JNJ 2020-07-15 and INTU 2014-05-20. The earnings gate is in no scan, so "valid" in the base rates means every scan gate passed.
- **Bars contradicted the text:** WDAY's cup breakout closed in the lower third, not "near its high"; ULTA's cup held one wide week, not two; SEDG's gapper buy day is 2019-05-10 (05-13 is the stop day); NVDA's Go Signal stop traded in the 12:30 candle of the signal day, not the next morning; NVDA's Red to Green stop was taken in the next session's first hour, not two sessions later; RGTI's parabolic short counts 3 boxes, not 2.
- **Stops outside the rule:** several dossier-named failures carry stops wider than the card allows (HVE NAVN, MBX, KOD, PRTA; U&R LULU 2020; Mean Reversion NFLX, IONQ, DASH; AVWAP DIS) and were not reused as by-the-rules losses.
- **Near-misses the rules reject that then worked** (grade-question material, D-005 and the depth decisions): RIG 5.4R, COST 4.4R, ADC 6.4R, AAPL 9.3R, ENOV 20.7R, ESS 14.9R; the borderline ones are flagged in the dossier sections.
- **Near-miss scans that found nothing:** the AVWAP U&R look-alike (3 hits in 1,162 names), Wick Play's day-1 wick and no-chase gates, Opening Drive's late trigger, Red to Green's gap ceiling; the Holy Grail's long pullback fails two gates at once, so the trigger was used instead.
- **Intraday windows:** 40, 41 and 44 could not spread failures over different years (one 12-week window); different weeks were used.
- **Coverage:** most near-miss scans covered the full 2,630-name universe; 06, 09, 18 and the reversal family ran on budgets or subsets (stated in each section). Enough for examples, not for a base rate.

## 9. Findings from the unit cold checks (2026-11-10)

Building and checking the Setup-track units from the cards turned up problems in the research data and the cards themselves. None is fixed yet; each needs a decision or a rescan.

- **Same-day fills were the open, before the undercut (2B and U&R; fixed 2026-11-10).** For MKSI, NVDA and TSLA (2B) and 56% of the U&R hits, the scan's same-day buy was the day's open although the undercut came later that day. The rescan fills at the reclaimed level plus a cent. The old figures were too PESSIMISTIC in R terms (the open sat above the level, so the stop looked wider): 2B longs now reach 3R 56.7% of the time (was 42.7%) and U&R 50.2% (was 35.6%). The same-day figures are an UPPER BOUND: scored on 5-minute bars with the stop under the low so far at the fill, 2B same-day falls from 60.3% to 31.0% to 3R, because the day often prints a lower low after the buy. Do not teach any same-day reclaim as an edge until the owner sees the intraday numbers. Oops and Wyckoff Spring do not share the open-fill defect.
- **Market reading contradicts itself on the Kicker and Oops cards.** Grading puts Orange or Red at B-, while the gate says Orange is "A+ only" and an A+ needs Green, so an Orange or Red trade can never qualify. The units follow the gate and F65.
- **Dossier examples that are earnings-window violations or stop-width failures were used as by-the-rules losses:** Slingshot FSLR and BIIB, Trendline IFF, Capitulation WDC (relabelled in the failures sections), HVE NAVN, MBX, KOD and PRTA (stops too wide), AVWAP DIS.
- **Sizing answers over the 40% position cap (A7)** were found and fixed in SET.07, SET.14, SET.16, SET.19, SET.20, SET.29, SET.44, SET.46 and SET.54: a risk of 1% on a stop under about 3% always hits the cap, so the sizing lessons should say the smaller of the risk size and the cap wins (A5, A7).
- **Chart questions:** the SPOT IPO chart in SET.10 has only 21 bars and was cut. The daily-only chart item cannot show an hourly or 5-minute setup, so SET.34, SET.48 (partly), SET.53 and SET.54 have daily-context charts or none.
- **Bulkowski:** his site bars use of its content to train AI; his quotes were removed from SET.22 and not used in SET.20 and SET.47. SET.24 cites Sperandeo only through Bulkowski's page, which is a reading, not a training use.
- **Same trade as walk-through and chart (SET.10 KRMN, SET.15 UAA):** the hidden-ticker chart tests less when it is also a walk-through; swapping the chart ticker is the fix.
- **Held for the owner's rulings (verify status fix):** SET.07 q57 (D-006), SET.13 q55 (D-048), SET.14 q51 (D-036, D-003), SET.16 q45 (D-006), SET.19 q32 and SET.20 q51 (D-025), SET.20 q31 (D-086), SET.22 q18, q26, q55 (D-013), SET.29 q13, q42, q44, q62 (D-109, D-002, D-110, D-003), SET.10 q46 (D-005), SET.47 q45 (D-087).
- **More dossier facts the bars contradicted (from the 48, 49 and 50 checks):** Wyckoff Spring says TSLA "never traded above the entry" (high 380.55 over the entry 373.04) and MSFT "never showed a profit" (high 327.11 over 326.47); Capitulation counts COP's reclaim as the third session but the market was closed on 2022-06-20 (Juneteenth), so it was the second; Bear Gap's 311 stopped plus about 51 that reached 5R exceeds its 359 hits. Fix these in the dossiers and cards when the rulings land.
- **StockCharts is one publisher.** Two StockCharts authors do not meet the support rule's "two publishers"; SET.48 and SET.50 now add a second source (Pruden) or cite the card.
- **UCT's own name for the Spring:** public posts say shakeout, failed breakdown and UnR, never "Wyckoff spring" (D-002 decides the name and home).
- **Dossier example errors found on the bars (from the 40, 41 and 42 checks):** Inside Day NVDA April 2024 "under its 10-day for a week" is wrong (it closed above the 10-day from 19 to 26 March), so the card's id.inv_close_under_21 evidence needs correcting; the 4B AAPL 2019 higher low followed an 11.2% rally, not 4.1%; MSFT 2001's 200-day was flat and 16% under price, not overhead supply; the second TGT trigger came in the March 2009 rally and both closed above their 200-days; Wyckoff DY reaches 5R on the 9th session, not the 8th. QCOM is 13.0% over its 10-day SMA but about 9.7% over the 10-day EMA, so the stretch rule's answer flips on D-017.
- **Weinstein's own under-200-day version did better on the fixed-stop test** (30.1% against 22.2% to 3R for the above-200 version). B26 and D-009 keep it out of the course; the owner should see the number.

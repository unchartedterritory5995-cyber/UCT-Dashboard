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

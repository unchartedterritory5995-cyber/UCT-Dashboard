# Setup research: the owner's decisions register

Deliverable 2 of `CRITERIA_PROGRAMME.md`. The 44 dossiers in `research/` end with numbered questions for the owner,
596 in all. Most are one decision asked once per setup. This register collapses them so they can be settled in one
sitting. Nothing here is a ruling: every "our default" is the writers' recommendation and waits for his word.

**Adoption (2026-11-10).** The owner told the session to do all of the remaining work himself ("you do it all fully and completely"). Every open decision therefore takes its **Our default** line as a PROVISIONAL pick, so the course units and the held questions can be finished. These picks are not his words and are not in `owner_verdicts.jsonl`. A decision he answers replaces its default, and every unit item keyed on that default is then re-keyed. Items that rest on a default say so in their unit's `conflicts` line ("keyed on the adopted default of D-nnn").

**How to use it.** Answer by id ("D-003: b", or a sentence). Your words go verbatim into
`docs/study/audits/2026-10-24/owner_verdicts.jsonl` and from there into the criteria cards (`criteria/NN-slug.json`),
where each pending criterion carries the `owner_question` id it waits on. Answering a Part A decision settles it for every
setup listed under it; name a setup if one should differ. The tables in D-002 (the setup map) and D-016 (names) are
answered row by row. Every number is as the dossier states it; the dossier is cited as `NN:q` (dossier number : question number).

**Counts.**

| | |
|---|---|
| Questions read (section 10 of 44 dossiers) | 596 |
| Decisions after merging | 146 |
| Part A, shared across setups | 41 decisions covering 463 questions |
| Part B, setup-specific | 93 decisions covering 100 questions |
| Part C, already settled by the rulebook or a verdict | 12 rules covering 33 questions |
| Open for the owner (A + B) | 134 decisions, 563 questions |

Sources read: every dossier's section 10 and the section 8 lines they point at; `docs/study/sizing_rule.md` section 9
(the 71-rule account rulebook, closed 2026-11-09); the tail of `owner_verdicts.jsonl` (the rulebook rounds, the Kicker
rulings of 2026-11-02, the Go Signal rulings, the example process rule of 2026-10-24); `docs/study/TRADE_PLANS.md`.

---

## Part A: shared decisions

Ordered by how many setups each touches, biggest first.

### D-001. Teach the short side of each setup now, later, or not at all

**Setups touched:** 35 (36 questions): 01:10, 02:12, 03:10, 04:11, 05:13, 06:13, 07:6, 08:12, 09:10, 12:11, 13:11, 14:9, 16:1, 17:9, 18:10, 19:10, 21:13, 22:12, 23:1, 25:9, 26:14, 27:2, 27:11, 28:7, 29:14, 30:7, 31:9, 32:10, 33:1, 35:8, 37:10, 40:10, 41:10, 42:13, 43:8, 44:9

**The question.** Nearly every dossier asks whether its short mirror goes into the course. D47 says shorts are our longs reversed; B26 allows them only below the 200-day. 27:11 asks the master question: should members be taught to short at all, or only after 50 journaled trades, or only as a reading skill.

**Options.** (a) teach the mirror now, below the 200-day, graded B at most (asked by most dossiers); (b) recognition or an index warning only (16:1 a, 23:4 c, 26:14 b, 28:7 b, 35:8 b); (c) later, once examples exist (03:10, 05:13, 06:13, 19:10, 31:9, 32:10, 41:10); (d) long only (01:10 b, 04:11, 21:13 a, 37:10). 23:1 asks which direction the News Failure is (long, short, or both); 27:2 whether the bear gap is a short at all or a level lesson.

**Evidence.** No replay found an edge in a mirrored short: 33 (the 8B mirror -0.01R below the 200-day; the classical breakdown -0.10R), 35 (the upthrust lost money overall), 30 (no edge in the bearish Oops), 16 (an edge only with QQQ under its 50-day). The Sunday Scans intro lists "No Shorting" as a starter rule; C37 starts new traders at 0.25%. UCT uses the bearish Kicker and Launchpad as index cautions.

**Our default (a recommendation, not a ruling).** Every lesson shows the short mirror as recognition only (one chart: the same setup reversed), and a traded short is taught only where the short is the setup itself (16 Wedge Drop, 27 Bear gap Versions R and P, 39 Parabolic Short), below the 200-day (B26) and after 50 journaled trades (C37's bar). Traded mirrors for the other setups wait until you show examples. News Failure is taught long first (23:1 c). Reason: D47 keeps the mirror true, nothing measured says to trade it, and you and Manrav warn newer traders off shorts.

### D-002. The setup map: which of the 44 are their own unit and which are a form of another

**Setups touched:** 32 (42 questions): 01:1, 01:2, 02:1, 02:15, 03:1, 04:2, 04:12, 05:1, 06:1, 07:15, 08:4, 08:16, 09:1, 09:9, 12:7, 13:1, 14:1, 14:3, 16:3, 17:1, 18:1, 19:1, 20:1, 21:1, 22:1, 22:11, 23:2, 28:1, 29:1, 32:1, 33:5, 34:1, 35:1, 36:1, 38:1, 40:3, 41:1, 41:7, 41:8, 43:1, 44:1, 44:2

**The question.** The questions below ask the same thing for their own setup: is this its own lesson, card and tag, or a named form of another setup? One sitting over the table below settles them all. Per row: own unit, or fold into the setup named.

**Options.** Per row, as the dossiers give them; the dossier's lean is in the third column.

| Question | What is asked | Dossier's lean | Our default |
|---|---|---|---|
| 01:1 | Flat top with rising lows (ascending triangle): same setup as Flat Base? | (a) one setup | One setup, Flat Base Breakout; the ascending triangle is a named shape inside it |
| 01:2 and 06:1 | Is VCP its own setup? The Flat Base card today describes a VCP | separate; fix the card | VCP is its own unit (SET.12); the Flat Base card is redrawn as a flat box |
| 02:1 | Bull Flag and "Classic Flag/Pullback": one tag? Pullbacks to an average without a pole go to setup 12 | (A) one | One setup, Bull Flag, alias kept in the journal; no-pole pullbacks go to 12 |
| 02:15 and 03:1 | Flags with a 90%+ pole go to High Tight Flag only; HTF = the textbook pattern only | yes; (a) | Yes: HTF is the 90%+ pole pattern; every other tight flag is a Bull Flag |
| 04:2 | Daily or hourly "mini cups" under 7 weeks | no, they are flags or tight ranges | Not this setup; they are flags or inside ranges |
| 04:12 | Cup without handle | same lesson as a variant | A variant inside the Cup lesson |
| 05:1 | Which IPO base: IBD's early one (left-side high within 25 sessions), your "first year or so", or both; is a second base still an IPO base? | (c) both, (a) as A+ | Both; the early one is the A+ form; a second base since listing is a regular base |
| 07:15 | The launch bar is the Launchpad trigger (your naming) or TraderLion's split (Power of 3 bar, then the Launch Pad retest) | keep your naming | Your naming: the launch bar is the trigger; TraderLion's split is a note; the retest is the second-chance entry |
| 08:4 | The sweep-and-reclaim of an inside day (inside day + Oops) | (c) both, cross-linked | Taught in the Oops lesson and cross-linked from Inside Day |
| 08:16 | Narrow-range days that are not inside (Morpheus's BOOT day) | no lean | Not ours; a one-line mention |
| 09:1 | Trendline break: standalone, a trigger inside other lessons, or both | (c) both | Both: a card that says "the line break is the trigger, the structure is the setup" |
| 09:9 | A hold of the broken line on the throwback: this setup or a pullback | no lean | A pullback entry (setup 12's rules), cross-linked |
| 12:7 | The moving-average undercut and rally (MAU&R): part of MA Pullbacks or its own | no lean | A named variant of U&R (29), as 29:1 (c) proposes; its depth is in the undercut decision |
| 13:1 and 32:1 | Remount and MA Reclaim: one setup or two | (A) one, "Remount" | One unit, "Remount", with the moving-average form (13) and the level form (32) |
| 14:1 | EMA Crossback: Kell's first pullback after a Wedge Pop, or the house "re-entry after an extension" | (a) Kell's | Kell's definition; the card, playbook, lesson and definitions.json are corrected |
| 14:3 | Crossback against the 20 EMA Pullback (11) | (a) first test after a new up-cycle = Crossback; later tests = Pullback | (a) |
| 16:3 | Wedge Drop: Kell's (a stall on or above rising averages, then the first close under both) or the Model Book's rising wedge | (a) Kell's | Kell's; the card and playbook are rewritten |
| 17:1 | Holy Grail: own card, a named variant of the 20 EMA Pullback, or dropped | (b) variant | A named variant inside 11: a 20 EMA pullback where the ADX first pushed over 30 |
| 18:1 | A "Qullamaggie Breakout" card, or fold into Flat Base / Bull Flag / HTF | no lean | Fold in; his three setups are one lesson inside the breakout unit |
| 19:1 | AVWAP reclaim: own setup, a Foundations lesson, or both | (c) both | Both: Foundations F2b.08 and one setup card |
| 20:1 | Is an earnings gap an EP? | (a) yes; PEG = a big earnings gap on an established name in a base | (a); the catalyst engine's TERM-090 split is retired |
| 21:1 | PEG, earnings gapper, ER gapper: one setup? "Power" or "Post"? | (a) one, Power Earnings Gap | One unit, "Power Earnings Gap" |
| 22:1 | What setup 22 covers | (a) any catalyst gap, with EP and PEG as named versions | EP and PEG are the two traded units; "News Gapper" is the family lesson that teaches the first-pullback-and-reclaim entry for both (22:1 c) |
| 22:11 | Delayed reaction (U, RDDT, ESTC, BFLY, ELVN) | no lean | A named variant inside the gap family |
| 23:2 | News Failure: a setup or a read | (b) a read | A read that confirms other setups and the market; no stand-alone plan |
| 28:1 | 2B: own setup, or one undercut-and-reclaim family (2B, Oops, U&R, Go Signal) | no lean; your ruling calls them one family | One family lesson "Undercut and Reclaim" with the four named costumes; each keeps its card |
| 29:1 | U&R: one lesson, two, or one plus the MAU&R variant | (c) | (c) |
| 33:5 | The rounded top inside the failed H&S unit | (a) keep | Keep, with the dome high as the trigger |
| 34:1 | Capitulation = Parabolic Long? | (a) one setup, gated by the mirrored burst | One unit "Capitulation (Parabolic Long)"; the B26 exception applies |
| 35:1 | Wyckoff Spring: own setup or a U&R variant | (b) variant | A named variant inside U&R (29); the vocabulary is kept |
| 36:1 | Mean Reversion: own setup with forms A and B | (a) | Own unit with forms A (leader flush) and B (index flush) |
| 38:1 | Which falls count as a Parabolic Long: the blow-off unwind, the capitulation in a decline, or Bracco's one-day leader flush | (a) and (b) here; FIGR-type to 36 | (a) and (b); the one-day leader flush is Mean Reversion form A |
| 40:3 and 41:1 | ORB against the 30-Minute Pivot; which setup "30-Minute Pivot" names | no lean; 41:1 recommends (a) 1ChartMaster's | Two things: ORB = the first trade through the first half-hour's high; 30-Minute Pivot = 1ChartMaster's turn candle at support (41:1 a) |
| 41:7 and 41:8 | The 30-minute pivot: a setup or an entry timer; is the hourly higher low the same thing | no lean | An entry timer for the daily setups (pullbacks, gap support, remount); the hourly higher low is the same idea on a slower clock |
| 43:1 | Red to Green: a trigger, a setup, or both | (c) both | A trigger lesson plus one named setup: gap down red to green at the 20-day EMA |
| 44:1 and 44:2 | Opening Drive: own name (SMB) or the ORB on a drive day; a day trade or a day-1 entry tactic | (a) or (b); (a) tactic | Fold into the ORB lesson as the drive-day case, taught as an entry tactic (C35) |

**Evidence.** Members meet the same move under two names today (Remount and MA Reclaim; 2B, Oops, U&R and Go Signal; EP, PEG and News Gapper). Your Go Signal ruling already calls the undercut family one family ("GO SIGNAL is similar to the oops reversal or the UNR but is an hourly GO SIGNAL"). Your Launchpad verdicts say "Some of these will crossover with BaseBreakouts btw and that is fine".

**Our default (a recommendation, not a ruling).** The last column of the table. Reason: one definition per unit is what a card, a quiz and a journal tag can measure; the forms stay inside the lesson as named variants.

### D-003. The entry event: as it trades through the level, at the close, or the next day

**Setups touched:** 28 (28 questions): 04:7, 06:4, 07:1, 09:3, 10:5, 11:2, 12:3, 13:8, 14:4, 15:5, 16:6, 17:3, 19:4, 25:3, 28:4, 29:6, 30:1, 31:3, 32:4, 33:3, 34:3, 35:3, 36:7, 37:2, 38:2, 41:6, 42:5, 43:4

**The question.** On 2026-11-02 you ruled for the Kicker: "The entry is supposed to trigger OVER previous day high not at mkt close". 10:5 asks whether that ruling applies to every setup. Each dossier asks the same for its own pivot: buy as price trades through the level (market order, E57), at the daily close, or the next day over the trigger day's high.

**Options.** (a) intraday, as it trades through the pivot or the prior day's high, market order (the lean in 09, 10, 11, 12, 14, 15, 17, 28, 29, 30, 36, 42, 43; 04:7 asks a cent over, IBD's 10 cents over, or at market); (b) the daily close (07:1 A, 30:1 B, 31:3 a, 32:4 A, 34:3 c, 38:2 d; 41:6 asks if the reclaim inside the turn counts, as on DELL); (c) the next day, over the trigger day's high (19:4 a, 33:3 b, 07:1 C, 12:3 A); (d) an intraday 30/65-minute or 5-minute trigger as the advanced form (14:4, 16:6, 35:3, 37:2).

**Evidence.** 07: the close entry did best in the fair test; the trade-through did best on your own kept charts, with tighter stops but more false starts. 30: the intraday reclaim showed no edge on unselected data and six in ten reclaims failed by the close; the close had the measured edge. 32 replay: the pause entry gave the tightest stop for the same result but missed 44% of remounts. 35: the test entry (+0.11R) beat the immediate entry (+0.06R). 31: your own definition is the close.

**Our default (a recommendation, not a ruling).** Your Kicker ruling applies to every daily setup: buy as price trades through the pivot or the prior day's high, market order, stop under that day's low. The close is the entry only where the setup is defined by its close (Slingshot, Launchpad, a Kell Wedge Pop), and then the stop is still the day's low. The next-day break of the trigger day's high is the second-chance entry. Reason: it is your ruling and E57, and it keeps the stop tightest.

### D-004. Scanners and bank drafts: bring each to the agreed rules before Study uses its output

**Setups touched:** 27 (28 questions): 01:14, 02:13, 03:11, 07:11, 09:13, 10:9, 12:8, 13:13, 17:10, 18:12, 20:13, 21:14, 22:14, 23:10, 24:13, 25:10, 26:15, 27:12, 28:10, 30:12, 31:10, 32:9, 32:11, 33:11, 34:9, 35:9, 36:13, 39:13

**The question.** Thirty-five dossiers found their scanner firing on a different rule than the lesson (a close entry, the wrong stop, no 200-day or B23 gate, a dead check, a measured-move target). May engineering rebuild each scanner to its criteria card once you rule, hide the ones that cannot be fixed yet, and rebuild the bank drafts from the agreed rules?

**Options.** (a) fix each to the card (section 8 of its dossier); (b) retire it and build the lesson finder from the drawing or card rule; (c) leave the code and teach from hand-picked charts. 01:14 asks which of four flat-base engines feeds Study; 10:9 and 33:11 ask whether to build one at all; 32:11 asks about the Morning Wire's private Remount list; 27:12 asks to fix the evidence replay (measure_rules.py counts the fill day's own low or high on close entries) and regenerate the evidence for all setups.

**Evidence.** 07: the scanners fire on 3 and 1 of your 26 kept Launchpads, the member tag on none. 16: kell_cycle.py fires on 100% of charts. 01: Chart IQ wrote 100 Flat base drafts at up to 22% deep. 04: 40 of the 100 draft bank items have handles under 5 days and 20 are under the 200-day. 24: the HVC detector looks back about nine and a half months while your kept charts were all-history records 16 times in 19.

**Our default (a recommendation, not a ruling).** One blanket yes: every scanner that feeds Study is rebuilt to its criteria card (B26, B23, the house entry, stop and trims) and hidden from members until it passes a blind check; the bank drafts are rebuilt from the cards; the replay bug is fixed first and the evidence regenerated. Code comes one PR at a time for your merge. Reason: today the scanners and the lessons describe different trades.

### D-005. When the honest stop is wider than about 3%: skip, size down, or cap

**Setups touched:** 25 (25 questions): 01:8, 02:8, 03:6, 05:8, 06:3, 07:2, 08:6, 10:4, 14:6, 17:5, 18:3, 20:4, 21:8, 22:4, 23:3, 24:4, 28:6, 30:4, 31:6, 35:5, 36:8, 39:5, 40:5, 42:6, 44:7

**The question.** A13 says the stop usually sits within about 3% of the buy; A3 says if the honest stop does not fit the risk, skip. Twenty-five dossiers ask what to do when the day's low is more than 3% away, which is common on gap days, parabolics, HVEs and Slingshots.

**Options.** (a) skip (02 guidance, 03:6 above one ADR, 20:4 day 1, 40:5); (b) take it with smaller size by A5 (18:3, 21:8, 36:8, 39:5, 44:7, 31:6 up to about 6.5%, 24:4 no ceiling); (c) cap at the stock's ADR or 1 ATR (01:8 b, 03:6, 06:3, 08:6 a, 14:6 c, 18:3, 22:4 1.5 ATR); (d) a tighter intraday stop instead (the 30-minute low, VWAP, a swing low: 01:8 c, 23:3 b, 39:5 c, 40:5 c); (e) only A+ may go wider (30:4 C, 18:3 c, 35:5 b at a lower grade). 10:4 also asks which line is the default (the pause low, the 50-day, the higher low).

**Evidence.** 07: the stop under the launch-day low was never under 3% on your kept charts (median 4.0%; tightest 3.00%). 31: all six pass-2 greats (VRT, NFLX, NVDA, SOFI, PLTR, SMCI) had a trigger-low stop of 3.5% to 6.1%. 21: the PEG-day-low stop is wider than 3% in about half of earnings gaps. 24: the day-2 HVE stop median 2.3%, 5.2% on days up 20%+. 39: usually 4% to 14%. 23: the news day's extreme is usually 7% to 12% away. 28: Bracco's names undercut by up to 15.8%. You gave the Kicker 3.5% (2026-11-02).

**Our default (a recommendation, not a ruling).** One rule for all: up to one ADR (the stock's average daily range), take it, size down by A5 and grade it one notch lower; past one ADR, skip or wait for the tighter trigger (the prior-day-high break, the 30-minute low). The Kicker keeps its 3.5%. Reason: A3 and A5 already size from the stop; one ADR is where 03, 06 and 18 converge, and it keeps your best Launchpad, Slingshot and PEG examples in the course.

### D-006. Volume on the trigger day: a gate or a grading cue

**Setups touched:** 23 (23 questions): 01:6, 02:6, 03:7, 04:10, 06:5, 07:10, 11:15, 13:10, 14:15, 15:4, 16:8, 19:7, 21:4, 26:6, 28:8, 29:10, 32:8, 35:7, 36:10, 37:6, 40:6, 41:9, 44:5

**The question.** Does a setup need above-average volume to count, or does volume only raise the grade?

**Options.** A gate: 01:6 (1.4 times the 50-day), 04:10 (40% over the 50-day), 06:5 (40% over, or 1.5 times the 20-day), 13:10 (the 50-day average), 15:4 (above the prior day and the base days), 19:7 (1.5x the 20-day), 21:4 (1.5x the 50-day, 3x for an A), 26:6 (1.5x the 50-day), 32:8 (1.2x the 20-day), 36:10 (expansion on the flush), 40:6 (1.5x the 20-day for the window), 44:5 (first 5 minutes 2x). A cue only: the lean in 03, 04, 06, 14, 16, 19, 26, 35, 37, 41. A quiet pullback as a rule: 02:6, 11:15, 14:15, 37:6. 28:8 asks whether the 2B fails on quiet or heavy volume.

**Evidence.** 15: half of the pops Kell and UCT named had less than the 50-day average. 16: volume raised the win rate, not the average R. 32 replay: volume neutral. 14: quiet pullbacks did worse in the test. 13: the 50-day rule fails 4 of your 16 remounts (CRWD among them). 07: your kept Launchpads had a median 1.8x, 8 of 26 under 1.5x. 29 and 35: no difference measured.

**Our default (a recommendation, not a ruling).** Volume is a grading cue, not a gate, for every setup; the exceptions are the setups where volume is the setup (24 HVE, and the burst checklist in 34, 38, 39). The A+ cue is 1.5x the 50-day average on the trigger day; for pullback setups the cue is a quiet pullback. Reason: we buy at market during the day (E57) before the day's volume is known, and the replays found volume neutral.

### D-007. Model examples: approve the candidate lists for charting, then review them one at a time

**Setups touched:** 18 (22 questions): 01:15, 03:12, 04:14, 04:16, 05:14, 06:14, 06:17, 15:12, 16:11, 16:12, 19:11, 21:15, 22:15, 28:11, 28:12, 29:13, 33:12, 34:13, 37:13, 39:15, 42:15, 43:13

**The question.** Each dossier names candidates for its 10 model examples (and some failures). Which do you want? And some bank drafts are wrong under the proposed rules (04:14, 14:11, 28:11, 42:15).

**Options.** Approve the list for charting; name your own; cut. 16:11 asks whether losing examples are failed classical wedges or failed Kell-style Wedge Drops. 06:14 asks whether you review the 82-case gold standard's 7 double-flagged and 50 split cases before they become answer keys. 42:15 asks whether to re-grade 13 of 18 Go Signal footprints on the hourly close-ups or start fresh from your public calls.

**Evidence.** Your process rule (2026-10-24): liquid and sizable names, the example must WORK after the trigger, and you look at every chart one at a time. Several dossiers note their candidates are not yet checked against the proposed rules.

**Our default (a recommendation, not a ruling).** Chart every candidate under the MUST WORK rule and the liquidity rule, plus the failure and near-miss charts the method plan needs, and show them to you in the usual keep / keep with a note / cut form; bank items that fail the agreed rules are rebuilt before any go live. Reason: it is your process already.

### D-008. Which low the stop goes under: the entry day's low, or the pattern's low

**Setups touched:** 18 (18 questions): 04:8, 06:2, 08:3, 09:7, 12:4, 13:6, 15:6, 16:7, 19:5, 22:13, 25:4, 27:7, 32:5, 33:4, 34:4, 37:3, 41:2, 43:5

**The question.** A3 and F62 put the stop a few cents under the day's low or the prior day's low. Eighteen dossiers ask whether their setup uses the pattern's low instead (the handle low, the final contraction, the base low, the flush low, the pivot candle, the gap-fill spot), or the line minus a cushion.

**Options.** (a) a few cents under the entry day's low (house default; the lean in 06, 09, 13, 15, 19, 25, 32, 33, 34, 43); (b) the pattern or structure low (04:8 handle low as the outer limit, 06:2 b, 08:3 first inside day, 16:7 top of the stall, 22:13 the 50-day or the earnings close, 27:7 gap-day high or gap-fill, 37:3 day 1's body top, 41:2 a the pivot candle's low); (c) the line minus a cushion (12:4 C, 13:6 C, 19:5 b AVWAP minus 0.5 ATR, 32:5 C). 13:6 and 32:5 also ask whether a close back under the line is an extra exit (settled under A4, Part C).

**Evidence.** 06: the final contraction's low is often 4% to 10% away. 33: the failed-break low was a median 9.3% away. 27: the gap-day high median 4.2%, the gap-fill level 9.4% (26.8% on the 39 drafts). 41: the pivot candle's low differs from the day's low on four of your five public examples (HOOD, LITE, TEAM, TQQQ) and is tighter. 32 replay: the code's 1.5% under an older low did worst. 25: every in-house Gap Support example fits the test day's low.

**Our default (a recommendation, not a ruling).** The entry day's low (A3, F62) for every setup, with the pattern low as the outer limit (never wider than it); the 30-minute pivot candle's low is allowed where it is tighter (41). Reason: A3 is settled and in every replay the day's low gave the same result with less risk.

### D-009. Setups that form below the 200-day: no exception, watch-only, or an index exception

**Setups touched:** 18 (20 questions): 07:3, 09:11, 10:2, 12:2, 14:11, 15:3, 18:7, 23:4, 24:6, 25:6, 27:5, 28:9, 29:3, 31:2, 35:10, 35:11, 36:3, 36:9, 38:9, 42:11

**The question.** B26 bans longs below the 200-day SMA except a parabolic long. Several reversal setups (4B-, Wedge Pop, U&R, Spring, Mean Reversion, Slingshot) often form under it, and some of your own graded examples did.

**Options.** (a) B26 as written; the setup is taught as a read until price is back above (10:2 a and c, 15:3, 18:7 a, 31:2 a, 35:11, 36:3 a, 38:9); (b) a named exception for the setup (10:2 b, 29:3 c, 23:4 b, 28:9); (c) an exception for indexes and leveraged ETFs only (36:3 b, 15:3); (d) keep below-200 cases in the bank as reading drills marked not a buy (14:11 b). 07:3 and 25:6 ask whether kept examples that were under the 200 stay with a note or are recut; 42:11 whether MSFT 2022-11-17 and AAPL 2022-09-01 leave the bank; 12:2 whether a 200-day pullback is a long at all; 09:11 whether a bottom-fishing trendline break is this setup or mean reversion; 27:5 whether a bear gap short above the 200-day is a new exception, whether the bear gap is exempt from the C31 RS mirror, and whether the parabolic exception covers Bracco's day-2 variant with no climax gap up.

**Evidence.** 15: about half of all pops are under the 200; the data are mildly on B26's side. 10: NFLX and DXCM were 30% to 54% under their 200-day at the entry. 16 and 33: the above-200 short cases with the clearest tilt were the stretched, climax-like ones. 31: the sandbox bars show HAE's trigger close over its falling 200-day, not under it. Your own words: "Generally, below the 200SMA no participation is best."

**Our default (a recommendation, not a ruling).** B26 as written, no new exception: below-200 cases stay in the course as reading drills and failure charts marked "not a buy for us (B26)"; index and leveraged-ETF flushes count only as the parabolic long (Bracco's burst mirrored); a 200-day pullback is context, not a long setup. Reason: you called the 200-day a hard rule on 2026-11-09.

### D-010. Remove unsourced claims, invented quotes and wrong attributions from member-facing text now

**Setups touched:** 15 (15 questions): 04:15, 06:15, 11:13, 14:10, 15:10, 16:10, 19:9, 20:14, 29:11, 33:10, 36:14, 37:11, 40:12, 43:12, 44:8

**The question.** Twenty-two dossiers found text members can see (scanner narratives, quotes.json, definitions.json, Model Book cards, the voice KB, the recall bank, course drafts) that quotes a source the writer could not find, names a wrong book, or states a statistic with no source. Remove or rewrite it now, before you rule on the setups?

**Options.** (a) remove now, re-source later (the lean in 40, 44, 29); (b) keep until a source is found; (c) re-attribute as house rules (20:14). 14:10 offers a verified Kell line to replace the unverified one; 43:12 asks to fix the line that calls the Kicker "the cleanest RED TO GREEN entry".

**Evidence.** Examples: the Minervini sentences in pullback_to_21ema.py and quotes.json (11, 06); the Kullamägi and Pierpont lines in vcp.py (06); the Kell quote in the Study bank (14); Shannon's 60-65% rates and the "kiss-goodbye" stop (19); the Crabel and Raschke claims (08, 40); the Brandt quote and the Wyckoff 1908 date (33); "Win rate drops 15-20% in chop vs trend" (36); the Kullamägi attributions in the EP playbook (20).

**Our default (a recommendation, not a ruling).** Yes, one blanket approval: any member-facing claim with no verified source is removed or rewritten as a plain house statement at once, with a log of what was cut; verified replacements go in where the dossier found one. Reason: the text is wrong whichever rules you pick.

### D-011. RS 80 (C31): which setups are exempt, and when RS is measured

**Setups touched:** 16 (16 questions): 07:7, 10:3, 12:5, 13:7, 15:7, 19:8, 20:6, 21:10, 22:8, 28:5, 29:4, 30:5, 32:6, 33:6, 36:15, 42:12. Also the RS half of 24:6 (does C31 apply to a neglected stock on its HVE day) and of 23:4 (C31 for the News Failure short), mapped to D-009 for their 200-day half.

**The question.** C31 requires an RS rating of 80 or more except parabolic and mean-reversion trades. Nineteen dossiers ask whether their setup is in the exempt class, and whether RS is read on the entry day or before the pullback or gap.

**Options.** (a) strict, on the entry day (20:6 a, 21:10 a); (b) read before the pullback or gap (12:5, 21:10 b, 22:8, 36:15 b); (c) exempt as mean reversion (10:3 a, 13:7 B, 28:5, 29:4 b, 32:6 B, 20:6 b); (d) a lower bar: RS 60 or 70, or a rising RS line (13:7 C, 32:6 C, 33:6, 15:7 b, 10:3 a); (e) a grade factor, not a gate (15:7 c).

**Evidence.** 15: only 16% of Wedge Pops qualify on the day. 42: ZETA, BIDU, META and ZS were under 80 on our rough proxy when you called them. 13: many of your 200-day remounts were beaten-down names (NOW, TAN, RDDT). 22 and 24: neglected EPs and HVEs (you kept FSLY as "100% A+"). 12: a 50-day pullback can push a real leader under 80. 30: your Oops examples are all leaders.

**Our default (a recommendation, not a ruling).** C31 as written for every continuation setup (bases, flags, pullbacks, crossbacks, Launchpad, ORB, Go Signal, Oops, AVWAP reclaim), read on the entry day. The named reversal and catalyst setups are the mean-reversion class C31 already exempts: 4B-, the 200-day Remount, Wedge Pop, the washout U&R, Capitulation, and an EP or HVE on a neglected name; for them the cue is an RS line that held up through the decline. You confirm the class list. Reason: C31's own exception, applied by name so a quiz can check it.

### D-012. Weekly, hourly and intraday versions: one definition per setup, or several

**Setups touched:** 14 (14 questions): 02:10, 04:1, 06:11, 07:9, 08:11, 09:6, 11:1, 12:10, 14:8, 15:9, 24:14, 30:8, 31:11, 37:7

**The question.** UCT uses most setups on daily, weekly and hourly charts. Does the course teach the weekly and hourly versions as the same setup, as variants, or not at all?

**Options.** (a) daily only (the lean in 07, 09, 24); (b) daily definition, weekly as a grade cue or context (07:9, 04:1 weekly base + daily trigger); (c) all time frames as Kell does (14:8 c, 15:9); (d) hourly versions taught with the Go Signal (02:10); (e) weekly Oops as a trade with the weekly low as the stop (30:8 B).

**Evidence.** 04: most of your cup examples are weekly, IBD defines the cup weekly. 14: you and Bracco use weekly crossbacks (CHYM, CRCL, CRWV). 24: ChartMaster uses weekly and monthly HVEs (MDB, LASR). 30: a weekly Oops stop is usually far over 3%.

**Our default (a recommendation, not a ruling).** Every setup is defined on the daily chart with a daily trigger (cups: the weekly base, the daily trigger). The weekly version is a grade cue and a context lesson; the hourly version lives in the Go Signal and 30-Minute Pivot lessons as entry timing, not as a separate setup. Reason: one definition per setup is what the cards and the quiz can measure, and your hourly uses are timing.

### D-013. May a setup replace the house trims with its own target

**Setups touched:** 12 (14 questions): 02:9, 05:10, 17:6, 18:4, 18:11, 25:5, 27:8, 29:7, 31:7, 34:5, 36:4, 38:4, 39:3, 39:6

**The question.** B19 (a third at 3R, the hard rule) and E51 (a third at 5R, trail the last third) are the taught plan. Thirteen dossiers ask whether their setup uses its own target instead: the 9 EMA for parabolics, the post-gap high for Gap Support, the target average for mean reversion, Kullamägi's 3-5 day trim, O'Neil's 8-week hold, a measured move.

**Options.** (a) house only (the lean in 18:4, 25:5 a, 29:7, 31:7, 34:5); (b) the setup's own target replaces the thirds (36:4 b, 38:4 a, 39:6 a, 27:8 Bracco's 9 EMA; 39:3 asks which target: the daily 9 EMA, Bracco's later "9 or 10 day", or Kullamägi's 10 and 20-day); (c) both, a third at the higher of 3R and the named spot (25:5 b); (d) teach the alternative as a member's choice (18:4 b, 31:7 b). 05:10 asks whether O'Neil's 8-week hold is an exception for IPO breakouts up 20% in under 3 weeks; 02:9 whether the measured move is taught as a reference; 18:11 how much to sell into an Exhaustion Extension (a third, half, judgment) and whether C34 covers a Kell extension that is not a burst.

**Evidence.** 36: 3R came before the stop in only about one oversold signal in five. 39: the house trims added nothing in the test. 34: the house 3R and 5R land near the 9 and 20 EMAs with the reclaim entry. D47 already names the 9-day average as the parabolic short's target. Your Trade Story ruling (2026-11-09): "yes add those stops too" for the post-gap high and the first return to the high-volume close.

**Our default (a recommendation, not a ruling).** B19 and E51 are the plan for every swing setup. The three climax setups (34/38 Capitulation, 36 Mean Reversion, 39 Parabolic Short) take their first trim at the setup's own target (the 9 EMA or the 20-day), as D47 already does for the parabolic short, and the rest by the thirds. A setup's named spot (the post-gap high, the first return to the HVC) is a cue to take the 3R third early, not a change to the thirds. The measured move and the 8-week hold are references, not rules; an Exhaustion Extension sells a third (C34, judgment). Reason: B19 is a hard rule and D47 already carves out the parabolics.

### D-014. Model Book cards, playbooks, glyphs and journal tags: rewrite to your rulings and add the missing ones

**Setups touched:** 13 (13 questions): 02:14, 05:15, 07:12, 08:14, 14:12, 18:13, 25:11, 31:13, 34:10, 36:12, 38:10, 42:10, 44:10

**The question.** Many cards describe a different setup than the dossier found (the Flat Base card is a VCP, the Wedge Drop playbook mirrors the Wedge Pop, the Parabolic Long card rides a parabola up, the Go Signal card describes a 9 EMA engulfing candle). Several setups have no card or journal tag. Rewrite and add, once you rule?

**Options.** Rewrite: 07:12 (8/21/30/50 playbook), 18:13 (Wedge Drop, Parabolic Long, EMA Crossback cards), 36:12 (Parabolic Long card), 38:10 (card, glyph, definitions, lesson), 42:10 (retire the other Go Signal definition), 31:13 (the Slingshot glyph draws a 3-day average of closes, not the 4-day of the highs; family), 05:15 (the AI-written IPO playbook and its 4 recall items). Add: 08:14 Inside Day card and tag, 14:12 EMA Crossback tag, 25:11 Gap Support tag, 34:10 Capitulation card and tag, 44:10 Opening Drive card (one journal tag shared with ORB), 18:13 Kell's phases in setupGroups.js.

**Evidence.** Each dossier's section 5 lists the card text against the sources. 18:13 notes EMA Crossback is already a Notebook tag through its card.

**Our default (a recommendation, not a ruling).** Yes: every card and playbook is rewritten from its criteria card after you rule (the card is the source, app text follows), and each setup unit gets one journal tag (a shared tag where two setups are one unit, so the journal statistics do not split). Reason: members should meet one description per setup.

### D-015. Your own trades, notes, transcripts and the team's words as sources

**Setups touched:** 12 (12 questions): 09:12, 10:10, 11:14, 12:13, 14:14, 15:11, 23:11, 27:1, 29:12, 30:14, 34:12, 41:11

**The question.** The dossiers lack the one source that matters most: your own trades and rules in your own words. Twelve ask for them.

**Options.** 09:12 (your trendline playbook notes and the scanner's outcome record), 10:10 (three to five journal trades tagged 4B), 11:14 (the "Playbook Review On Pullback Buys" transcript, 13:24), 12:13 (is TSDR you?), 14:14 (a forward log of crossbacks), 15:11 (are the unsigned INTRO and Index & ETF sections yours?), 23:11 (your News Failure journal trades, long or short), 27:1 (two or three charts of what "bear gaps off the highs" means; is MPWR 2024-10-31 the model?), 29:12 (the Zoom U&R segment, edu_videos:355 at 00:14:08 and 00:36:06), 30:14 (your 2026-05-13 Oops video), 34:12 (confirm Bracco's Monday-list date), 41:11 (ask 1ChartMaster to confirm the wording, or rule from video 52 at 0:00 and 29:00 and video 135 at 5:48).

**Evidence.** The Weinstein, trendline, News Failure and 30-minute pivot dossiers have no labelled house data at all; the team playbook rows are not in this public repo.

**Our default (a recommendation, not a ruling).** Yes to all: three to five tagged trades per setup, the two transcripts, the Zoom segment, the Oops video, and a question to 1ChartMaster and Bracco where named; you confirm TSDR and the unsigned sections. Reason: it is the only outcome evidence we are missing.

### D-016. Names, journal families and small naming fixes

**Setups touched:** 11 (12 questions): 10:1, 10:7, 12:9, 23:9, 24:12, 27:10, 31:12, 32:12, 33:13, 36:2, 37:9, 40:13

**The question.** Twelve naming questions, one row each.

**Options.** Per row.

| Question | What is asked | Dossier's lean | Our default |
|---|---|---|---|
| 10:1 | Weinstein's buy is the "4B-", not "4B" | (a) rename the tag "4B- (Stan Weinstein)" | (a) |
| 10:7 | Journal family for the 4B- | Reversals & Reclaims | Reversals & Reclaims |
| 12:9 | The pullback setup's name and tag | no lean | "Pullback to the moving averages", one tag "MA Pullback", with the line named in the note (9/20 EMA, 50-day) |
| 23:9 | The Bottoms signpost and the swing tag share the name News Failure | no lean | Rename the signpost "Bad news fails" |
| 24:12 | A "High Volume Edge" journal tag next to "HVC", or rename | no lean | One tag, "High Volume Edge (HVC)" |
| 27:10 | "Bear gap", "Bear gap off the highs", or "Bear gap retest"; its own unit; a card and tag | no lean | "Bear gap off the highs", its own unit (not SET.22 Gap Support), a card and a tag |
| 31:12 | Credit Scot1and as the Slingshot's originator (2015) | no lean | Yes, credit him |
| 32:12 | "Remount" as a plain verb on the 20 EMA Pullback and Crossback cards | (A) keep the verb | Keep the verb; the glossary defines "remount" as take back a lost line and the setup name as a line lost for at least 5 sessions |
| 33:13 | "Failed H&S / Rounded Top", "H&S Failure" (Brandt) or "Busted Top" (Bulkowski) | no lean | Keep "Failed H&S / Rounded Top" |
| 36:2 | Mean Reversion tag: Swing or Intraday group | (c) both, filed under Swing | Swing, with an intraday trigger and a 1-5 day hold |
| 37:9 | Wick Play family: move from Reversals & Reclaims to Momentum & Trend | no lean | Momentum & Trend |
| 40:13 | "DAY 1" for the Kicker gap day everywhere (some app files say day 2) | no lean | Day 1 everywhere |

**Evidence.** The journal, Model Book, course and Study use different names for the same setup in several places.

**Our default (a recommendation, not a ruling).** The last column. Reason: one name per unit, your word where you have one.

### D-017. C29 (10% over the 10-day) on catalyst days, and which 10-day

**Setups touched:** 10 (10 questions): 05:9, 07:8, 08:8, 20:3, 21:7, 22:3, 24:3, 29:9, 37:8, 40:9

**The question.** C29 skips a long more than 10% above its 10-day average. The gap itself breaks it on most EP, PEG, HVE, Kicker and ORB days. 07:8 and 08:8 also ask whether the 10-day is simple or exponential and whether the day itself counts (CRCL on 2026-09-04 passes one and fails the other).

**Options.** (a) exempt the gap day's own entry, day 1 or the day-2 HVE entry (20:3 a, 22:3, 24:3 a, 37:8, 40:9); (b) C29 applies, only delayed entries (21:7 a, 29:9 a, 24:3 b); (c) measure against the 10-day before the gap, or from the level (21:7 c, 29:9 c); (d) a setup cap such as 25% over (20:3 c); (e) exempt A+ only (24:3 c). 05:9 asks whether a day-1 30-minute ORB while still within 10% is allowed; 08:8 whether the member drawing's 6%-over-the-50-day gate stays.

**Evidence.** 24: 97% of HVE days up 20%+ break C29 and 16 of your 19 kept charts closed more than 10% over it; extension did not hurt day-2 entries. 21: most big PEGs break it (TWLO, DELL, OKTA, META). 29: MXL was 40.9% over; 37: MXL about 41%. 05: FIGR closed up over 21%. 07: MSTR, your model Launchpad, closed more than 10% above its 10-day on every reading.

**Our default (a recommendation, not a ruling).** C29 stays for every base and pullback entry. On a catalyst day (EP, PEG, HVE, Kicker, an ORB on a gap) it is measured against the 10-day as of the prior close, so the gap itself does not disqualify the day-1 or day-2 entry; from day 3 it applies as written. The 10-day is the simple average and the entry day is not in it; the 6%-over-the-50-day gate is dropped. Reason: your kept HVE and PEG charts nearly all break C29 on the gap day, and the data say extension did not hurt there.

### D-018. ETFs, leveraged ETFs and the index's own setup

**Setups touched:** 8 (8 questions): 01:11, 15:8, 23:8, 26:8, 33:8, 38:7, 39:9, 42:14

**The question.** E54 says leveraged ETFs are preferred, no extra rules. Eight dossiers ask whether ETFs and indexes count in their setup, whether RS 80 applies to them, and whether the index's own version (Wedge Pop, Go Signal, News Failure) is taught as a market tell.

**Options.** (a) ETFs and leveraged ETFs count (26:8 a, 33:8, 38:7 b for thin 3x ETFs, 39:9 b inverse ETFs and puts, 23:8 with 1% and 1.2x thresholds); (b) stocks only (26:8 b, 38:7 a, 39:9 a); (c) the index version as a market tell inside the lesson (15:8, 42:14) or its own lesson (42:14).

**Evidence.** UCT's canonical Kicker is ARKK; you kept SMH as C-; XLI and IYT were called flat bases on the Substack (01:11); the Sunday Scans read the index Wedge Pop next to the Follow Through Day.

**Our default (a recommendation, not a ruling).** ETFs and leveraged ETFs count in every setup (E54), RS 80 is waived for index ETFs (they are the benchmark), the ETF's own volume must still pass B23 (no thin 3x names), and the index's own setup is taught as a market tell inside the setup lesson, not a separate lesson. The short vehicles are shares (A6), with inverse ETFs and puts as the defined-risk alternative (B25, E54). Reason: E54 and your ARKK Kicker.

### D-019. C33's 10-day time stop, breakeven, and the exits test

**Setups touched:** 7 (8 questions): 04:9, 14:16, 17:7, 30:9, 30:11, 34:6, 36:5, 38:5

**The question.** C33 sells a trade still under 1R after 10 trading days. Fast reversal setups ask for 3 sessions; the cup asks for more time; 14:16 found the house management earned 0.17R to 0.32R less per trade than holding to a close under the 21-day EMA, for crossbacks and random days alike.

**Options.** (a) C33 as written (04:9, 17:7, 30:9, 34:6 b, 36:5 a, 38:5 b); (b) 3 sessions for the climax setups (34:6 a, 36:5 b, 38:5 a), 5 for the Oops or Raschke's 5 quiet sessions (30:9, 17:7, 36:5 c); (c) more time for cups (04:9: 62% of cup breakouts throw back within 30 days); (d) breakeven at 2R for the Oops or later (30:11); (e) test a variant across all setups before teaching exits (14:16 a or c).

**Evidence.** 14: the measured gap of 0.17R to 0.32R per trade. 34 and 38: the edge is "1-3 days". 30: you want "quick follow-through".

**Our default (a recommendation, not a ruling).** C33 as written everywhere, with a 3-session time stop added only for the climax setups (34/38, 36) whose edge is 1 to 3 days; breakeven at the first trim (B19). 14:16's finding goes to one replay across all setups before any course teaches a change to the exits. Reason: the rulebook is closed and one measured test is cheaper than 44 exceptions.

### D-020. A gap or reclaim through the 200-day: does a close above it the same day count

**Setups touched:** 6 (6 questions): 09:2, 20:7, 21:9, 22:6, 26:9, 30:6

**The question.** B26 says no longs below the 200-day. Does a stock that opens under it and trades above it on the entry day qualify, or must the prior close already be above? 09:2 asks whether the 200-day must be rising.

**Options.** (a) above at the time of entry counts (20:7, 21:9 a, 22:6, 26:9 a, 30:6 your IWM at the 200SMA, 29:3 b); (b) the prior close must be above (21:9 b, 22:6, 26:9 b); (c) only over a rising 200-day (21:9 c, 09:2). 24:6 asks whether an IPO under a year old is exempt (see the new-listings decision) and whether the rule is "above the 200 by day 2". 26:9 asks what to do with VOD and LHX.

**Evidence.** DELL 2026-02-27 and PLTR 2026-08 started under the 200 and closed over it (21). HTZ and DELL did the same (22). Your IWM long "at the 200SMA" (2026-10-05). 09: B26 is stated on price only.

**Our default (a recommendation, not a ruling).** Price above the 200-day at the moment of entry is the test: a gap that opens under and trades above counts, an undercut of the 200 that reclaims it the same day counts; the slope of the 200-day is a grade cue, not a gate. VOD and LHX stay if they pass that test. Reason: B26 is written on price, and DELL, PLTR and HTZ were your examples.

### D-021. 9/20 EMA, 10/21, or 10/20: one pair for the course

**Setups touched:** 7 (7 questions): 07:5, 11:3, 12:1, 14:2, 15:1, 16:4, 18:6

**The question.** You write 20EMA and 9 EMA; the scanners and E52 say 10 and 21; Kell uses 10/20; the originators of the Launchpad use simples (10, 21, 50, 200). Seven dossiers ask which pair the course teaches.

**Options.** (a) 9 and 20 EMA everywhere (your words, the Model Book, the Study stack; 11:3, 12:1 A, 18:6 b); (b) 10 and 21 (the scanners, E52; 12:1 B); (c) 10 and 20 for Kell's setups only (14:2 b, 15:1 a, 16:4, 18:6 a); (d) "20/21" written as one (11:3); (e) the originators' simples for the Launchpad (07:5 D).

**Evidence.** 07: the numbers barely change between the 8/21 and 9/20 sets; one set should be taught. 15: the app's Chart IQ reader already uses 10/20. 16: Kell himself acted on a 10-only close twice.

**Our default (a recommendation, not a ruling).** One pair everywhere: the 9 and 20 EMA with the 50 and 200 SMA (your words), with a one-line note where an originator uses 10/20 or 10/21; E52's "10-day" and "21-day" read as the 9/10 EMA and the 20/21 EMA; the scanners move to 9/20. Reason: one set, your wording, and the lines differ by cents.

### D-022. C28's buy point per setup, and a gap past it

**Setups touched:** 7 (7 questions): 07:13, 13:9, 22:5, 26:3, 32:7, 33:7, 35:4

**The question.** C28 says never buy more than 4% above the buy point. Seven dossiers ask what the buy point is for their setup (the line, the pivot, the trigger, the top of the averages) and what to do when the day gaps past it.

**Options.** (a) the trigger level: the pivot, the prior day's high, the pause high, the opening-range high (07:13, 13:9 B, 22:5, 32:7 B); (b) the structure's edge: the reclaimed line, the top of the averages, the old range low (07:13, 13:9 A, 32:7 A, 35:4 a); (c) on a gap past 4%: skip, use the 30-minute ORB as the buy point, or exempt the setup (26:3, 33:7).

**Evidence.** 07: with the top of the averages as the buy point, C28 would cut 15 of your 26 kept launches at the close. 32 replay: with the line as the buy point, 39% of pause entries filled more than 4% over it. 33: SMH 2026-04-08, your best example, opened 4.6% over its right shoulder.

**Our default (a recommendation, not a ruling).** The buy point is the trigger level (the pivot, the prior day's high, the pause high, the opening-range high), never the structure's far edge; a gap of more than 4% past it means wait for the 30-minute ORB or the first pause, no setup exception. Reason: C28 is 4% of the buy point, and by your Kicker ruling the trigger is the buy point.

### D-023. The market reading for the reversal setups, and extra index filters

**Setups touched:** 7 (7 questions): 11:7, 13:12, 16:9, 34:7, 36:11, 38:6, 39:10

**The question.** F65 makes the reading a guide: Orange means A+ only, Red means mostly cash and shorts. The capitulation, mean-reversion and parabolic setups happen in Orange and Red; the parabolic short happens in Green. Two dossiers ask for an extra index filter of their own.

**Options.** (a) allow the climax longs in Orange and Red when the index itself is capitulating (34:7 a, 36:11, 38:6 a); (b) F65 as written, Orange A+ only (34:7 b, 38:6 b); (c) never in Red (34:7 c, 38:6 c); (d) the parabolic short in Green and Yellow (39:10 a) or only where F65 allows shorts (39:10 b); (e) an extra filter: QQQ above a rising 20 EMA for pullbacks (11:7 b), QQQ under its 50-day for the Wedge Drop short (16:9 b); 13:12 asks whether your 2026-11-08 note (close out all holdings below the 200SMA, rebuy on the remount) is a house rule, a guide, or background.

**Evidence.** 16: QQQ under its 50-day was the only regime with a measured edge for the Wedge Drop short. Bracco's index examples (March and June 2026) came in weak markets. Your words on an index filter: "It's like saying XLU ... is below the 20EMA so therefore I cannot trade META".

**Our default (a recommendation, not a ruling).** F65 as written is the guide. The capitulation and parabolic long are allowed in Orange and Red when the index itself is capitulating (they are the exception B26 names), and the parabolic short is allowed in Green and Yellow (the exception B26 names). No setup adds its own index filter; 16's QQQ-under-the-50 finding and your 2026-11-08 note are taught as context. Reason: the reading is a guide (A10) and your own words reject a per-setup index rule.

### D-024. The trail line: E52's 10-day and 21-day, or the 20 EMA you use in your posts

**Setups touched:** 6 (7 questions): 03:8, 11:4, 11:10, 20:8, 21:12, 24:10, 26:16

**The question.** E52 trails fast movers on the 10-day and steadier names on the 21-day, sold on a close below. Seven dossiers ask which applies to their setup and whether your 20 EMA habit replaces it; 11:4 asks whether E52's averages are EMAs or simple averages.

**Options.** (a) E52 as written (03:8 10-day, 20:8, 21:12 a, 26:16); (b) your 20 EMA (03:8 WULF, 11:10 b, 21:12 b, 24:10); (c) the 10-day until the first base, then the 21-day (20:8); (d) two closes under the 20 EMA (11:10 c); (e) Morales's 7-week rule (21:12 c).

**Evidence.** Your posts trail CIFR and WULF on the 20EMA; the Kicker plan trails under each higher low or the 10-day; 20: Bonde watches EPs for a year.

**Our default (a recommendation, not a ruling).** E52 as written, exponential: the 10-day (your 9/10 EMA) for fast movers and the 21-day (your 20/21 EMA) for steadier names, sold on a close below; each card names which. Your "keep the first stop until the 20 EMA passes the entry, then the 20 EMA close" (11:10 b) is the taught way to move from the fixed stop to the trail. Reason: E52 is settled; which number is the averages decision.

### D-025. An earnings gap on a pattern: this setup, or the catalyst-gap units

**Setups touched:** 6 (7 questions): 01:9, 02:11, 21:2, 25:8, 26:12, 26:13, 27:4 Also setup 15 (no dossier question): the Wedge Pop card's wp.not_earnings_day, from the CRWD 2021-03-17 failure, asks the same thing.

**The question.** When the breakout, flag, Kicker or gap-support test is the earnings day itself, which lesson owns it? Your Kicker verdicts cut several earnings-day Kickers as "just an earnings gapper".

**Options.** (a) the earnings day belongs to EP/PEG; the pattern's unit takes the chart from the next day on (01:9 b, 02:11, 26:13); (b) the pattern's unit keeps it (01:9 a, 25:8 non-earnings gaps count, 21:2 b earnings or major company news); (c) exclude earnings collapses from the bear gap or keep only the one-day collapse off a fresh high (27:4).

**Evidence.** Your verdicts: "Sometimes earnings gappers can be kickers but mostly they are just earnings gappers"; "I want them to be rarely earnings". 27: in the test the earnings slice was the only positive one for bear gaps. 21: you treated INTC's news gap "like a classic PEG".

**Our default (a recommendation, not a ruling).** The report day itself belongs to the catalyst-gap units (EP, PEG); the same chart from the next day on (a Kicker after an earnings gap, a flag on an earnings pole, a gap-support test of an earnings gap) belongs to the pattern's unit and is graded there; a major company news gap is a PEG; an earnings collapse is a bear gap only when it comes straight off a fresh high. Reason: it matches your Kicker verdicts and keeps the catalyst units rare.

### D-026. Second and third tests, and the second-chance entry for a missed day one

**Setups touched:** 6 (6 questions): 11:6, 12:6, 14:7, 17:8, 25:7, 26:11

**The question.** Which touches of a line or test of a gap count as the setup: the first only, the first and second, or any while the line rises? And is a tight pause after a missed day one a new entry?

**Options.** (a) first only (14:7 a, 25:7 the card); (b) first and second, the second as a B (11:6, 12:6, 14:7 b, 17:8 after a new ADX push); (c) any while the line rises (11:6, 12:6); (d) a next-day hourly flag or a tight pause above the trigger as a new entry for those who missed day one (26:11 your RIVN).

**Evidence.** The sources agree the first test is the best; 25 notes the Model Book card says first test only; B21 allows a new trade on a new trigger.

**Our default (a recommendation, not a ruling).** The first and second tests are trades (the first an A, the second a B); the third and later are not this setup until a new high resets the count. A tight pause after a missed day one is the second-chance entry, its own trade with its own stop (B21). Reason: the sources agree on the first two, and after that the line is being worn out.

### D-027. Buying inside the base before the pivot: the early entries

**Setups touched:** 6 (6 questions): 01:7, 02:2, 03:5, 04:6, 05:7, 06:12

**The question.** Six base and flag dossiers ask whether the early entries you use (the early pivot inside the base, the undercut and reclaim of the base low, the support reclaim in the flag, the in-handle shakeout, the cheat, the opening-range high in a very tight flag, the IPO AVWAP higher low) go in the course and how.

**Options.** (a) the pivot break only (03:5 a, 04:6 breakout only, 02:2 B); (b) the early entry as the execution and the pivot as the definition (04:6 both, 02:2 A support over confirmation, 03:5 b advanced); (c) any, with the stop rule deciding (02:2 C, 05:7).

**Evidence.** Your own words (02): support over confirmation; your BWXT note bought in the middle of the base (06:12); 03: Qullamaggie's opening-range high and Bonde's KOD.

**Our default (a recommendation, not a ruling).** The pivot break defines the setup and is the lesson's entry. The early entries are one advanced lesson: the same setup, an earlier trigger, the same stop rule and the same grade cues; they are not separate setups. Reason: your own practice favors them, but the quiz needs one definition per setup.

### D-028. Quoting the Sunday Scans, Discord and the brain summaries in the public repo and course

**Setups touched:** 5 (5 questions): 06:16, 27:13, 34:11, 39:14, 43:10

**The question.** Five dossiers quote short Sunday Scans or Rest of the Week passages, Bracco's Discord posts, or your own Discord notes summarized in the brain files; one prints a link to an unlicensed PDF of Minervini's book.

**Options.** (a) fine as short excerpts; (b) move to a private file; (c) your own Discord words may be quoted, others' only with their OK (34:11, 43:10); (d) remove the PDF link and check the quotes against your own copy (06:16).

**Evidence.** The vocabulary file already keeps Sunday Scans text out of the public repo (the golden set).

**Our default (a recommendation, not a ruling).** Short excerpts stay in the dossiers; new quotations of Sunday Scans and Discord text go to a private file; the course may quote your own Discord words; Bracco's Discord posts only with his OK; the PDF link is removed. Reason: the golden-set rule already exists.

### D-029. The prior advance that qualifies a base, flag or pullback

**Setups touched:** 5 (5 questions): 01:5, 02:3, 06:8, 11:8, 18:2

**The question.** What move must come before the pattern: 20%, 25%, 30%, Kullamägi's 30% in 1 to 3 months, or none beyond the trend rules?

**Options.** 01:5: 20% (O'Neil), 25%, 30% (TraderLion, Kullamägi). 02:3: 20% in 20 sessions, 30%+ within 1 to 3 months, or no number. 06:8: 20% (System A), 30% (System D, ChartMill, Minervini), or the Trend Template only. 11:8: 1.5 ATR above the 20 EMA within 10 sessions, 30% in 1-3 months, a breakout or Wedge Pop in the last 2 months, or none. 18:2: a hard gate or a grade cue.

**Evidence.** 18: our data did not show the 30% gate helping, but the sample is biased.

**Our default (a recommendation, not a ruling).** 30% as the number (the TraderLion, Kullamägi and Minervini figure) as a gate for bases and the HTF, and a grade cue for flags and pullbacks, where the trend rules already apply. Reason: one number across the breakout family; the 20% figure lets in too many.

### D-030. B23 edge cases: when the $10 and $20 million are measured, and pattern-only examples

**Setups touched:** 4 (4 questions): 20:5, 22:7, 24:5, 30:3

**The question.** B23 says $10 or more and $20 million a day. On a gap day the price and volume jump; old examples are split-adjusted; some of your kept examples fail it.

**Options.** 20:5: measure on the 20-day average before the gap, on the gap day itself, or both; D42's 1% on which average. 22:7: $10 at the entry (FSLY opened at $13.49) or at the prior close ($9.31). 24:5: 7 of your 19 kept HVE charts closed under $10 and 12 traded under $20M before the event; apply B23 on the 20 days after, waive the $10 floor, or drop them. 30:3: four of your kept Oops models fail B23 (ORIC, LQDA, TVTX, LPG): drop, keep as pattern-only, or relax. 03:12: the HTF drafts are split-adjusted, so the $10 test needs the price as it traded then; keep news-driven poles if liquid and known.

**Evidence.** Your words (2026-11-07): "If the examples under the liquidity rule are good enough we can use them btw but i am also fine leaving them out. But if they are great visuals of the concept then it is okay."

**Our default (a recommendation, not a ruling).** B23 is measured on the entry day: the price at entry and the dollar volume of the 20 days ending on the entry day (the gap day included), on prices as they traded then; D42's 1% uses the same 20-day average. A chart that fails B23 may stay as a "pattern only, not a trade for us" example when it is a great visual. Reason: your 2026-11-07 words.

### D-031. Which 30 minutes, which hourly bars, which trigger bar

**Setups touched:** 4 (4 questions): 26:2, 40:1, 42:3, 44:3

**The question.** Your Kicker ruling and B20 use the first 30 minutes. 26:2 asks 9:30 to 10:00 ET or 9:45 to 10:00; 40:1 asks 30 minutes always or 5 and 15 on big catalyst days; 42:3 asks clock-aligned, session-aligned or 65-minute hourly bars; 44:3 asks a 1, 2 or 5-minute bar or the 30-minute ORB for the drive.

**Options.** As listed.

**Evidence.** 40: most first breaks came by 10:20; Zarattini found 5 minutes best as a day trade; 42: the review screen draws clock-aligned bars.

**Our default (a recommendation, not a ruling).** The first regular 30-minute bar, 9:30 to 10:00 ET, everywhere; clock-aligned hourly bars (9:30 to 10:00 first) as the review screen draws them; the 5-minute drive and the 15-minute ORB are advanced notes, not the taught window. Reason: your ruling and B20 say 30 minutes; one clock for the course.

### D-032. Which news counts, and must it be real

**Setups touched:** 4 (4 questions): 20:12, 22:9, 23:6, 38:12

**The question.** The catalyst setups ask which news qualifies (earnings, guidance, contracts, FDA, buyouts, regulation, index adds, analyst upgrades, sympathy moves) and whether a scanner may use the gap and volume alone.

**Options.** 20:12 (biotech EPs the hardest), 22:9 (do upgrades, index additions and sympathy moves count), 23:6 (a confirmed catalyst only, or a 4% gap on 2x volume for the scanner), 38:12 (skip falls caused by the company's own news).

**Evidence.** Kullamägi calls biotech EPs the hardest; 23 recommends a real catalyst for teaching and the gap test for scanning.

**Our default (a recommendation, not a ruling).** A named company or sector catalyst counts (earnings, guidance, contracts, FDA, buyouts, regulation, index adds); upgrades and sympathy moves are lesser grades; a scanner may fire on the gap and volume, but the lesson names the news; a fall on the company's own bad news is not a parabolic long. Reason: the sources agree, and a quiz can ask for the catalyst.

### D-033. The minimum gap for an EP or PEG

**Setups touched:** 4 (4 questions): 18:5, 20:2, 21:3, 22:2

**The question.** Four dossiers ask the same floor: 4% (our scanner, your 2026-09-04 decision), 8% (Bonde 2010, the PEG scanner today), 10% (Kullamägi), or 4% plus 0.75 ATR (21:3 a).

**Options.** (a) 10% (18:5 a, 20:2); (b) 4% (18:5 b); (c) 4% for the scan, 10% for A+ (18:5 c, 20:2); (d) 4% + 0.75 ATR (21:3 a); (e) 8% (21:3 b); (f) no number (21:3 d). 22:2 notes your TXN example opened 3.7% up.

**Evidence.** Your 2026-09-04 decision set the scanner at 4%; both originators use 10% for an EP.

**Our default (a recommendation, not a ruling).** 4% plus 0.75 ATR qualifies for the scan and for a PEG; 10% is the EP floor and the A+ mark. Reason: your 4% stands for the scan, and the originators' 10% marks the real EP.

### D-034. Stocks with no 200-day or no RS history yet

**Setups touched:** 3 (5 questions): 05:3, 05:4, 05:11, 37:12, 43:11

**The question.** E53 says no rule for new listings. B26 needs a 200-day, C31 needs 63 sessions of RS. Five dossiers ask what stands in until they exist, and whether "no rule" also bars setup-level changes (smaller size, a lockup check).

**Options.** 05:3: (a) the IPO AVWAP and the IPO price until the 200-day exists; (b) skip until 200 sessions (removes nearly every classic IPO base); (c) another proxy. 05:4: (a) waive RS until it exists; (b) performance since listing against the S&P 500 or Nasdaq; (c) skip. 05:11: lockups as context only. 37:12 and 43:11: a long allowed above the 50-day or the IPO-day low?

**Evidence.** 05: option (b) removes nearly every classic IPO base; your TTAN note used "IPO price" for the open ($100 against a $71 offer).

**Our default (a recommendation, not a ruling).** Until the 200-day exists the long must be above the 50-day and the IPO-day low, with the IPO AVWAP as the cue; RS is measured since listing against the Nasdaq; lockups are context only; no setup-level size change (E53). Reason: it keeps the classic IPO base tradeable without a new rule.

### D-035. Day-trade forms: entry timing for swing trades, or day trades with their own exits

**Setups touched:** 3 (3 questions): 17:11, 39:2, 43:9

**The question.** C35 says we swing trade. The parabolic short is mostly intraday for Bracco; Red to Green and Green to Red have intraday tags; the Holy Grail has intraday uses from 1993 and 2004.

**Options.** 39:2: (a) as Bracco trades it, overnight only in profit; (b) a swing short to the 9 EMA. 43:9: keep the intraday tags with their own exit (flat by the close) or fold them into the swing rules. 17:11: leave the intraday uses out or mention once. 44:2 is in the scope table.

**Evidence.** 39: C35 needs a note for this setup.

**Our default (a recommendation, not a ruling).** C35 holds: intraday forms are taught as entry timing for swing trades; the parabolic short is the one named day trade (out by the close unless in profit, Bracco's way, noted under C35); the intraday tags fold into the swing rules; the 1993 and 2004 uses are one line of background. Reason: one management rule for members.

### D-036. How far under the line or level an undercut may go, and how fast it must reclaim

**Setups touched:** 2 (2 questions): 11:5, 29:5

**The question.** Pullback and U&R setups ask how deep an undercut may be and whether it must close back above the same day.

**Options.** 11:5: (a) within about 1 ATR and the day closes back above; (b) any undercut if reclaimed the same day; (c) one close under is fine if the next day reclaims. 29:5: (a) no number, judgment (Morales); (b) 3% for an A, 6% at most, back above within 3 sessions; (c) an ATR limit.

**Evidence.** 29: our test found the prior day's low alone is not special; Morales refuses a number.

**Our default (a recommendation, not a ruling).** Within about 1 ATR under the line or level and back above it the same day for an A; up to 6% and 3 sessions as a B; deeper or longer is a different trade (a Remount after 5 closes under). Reason: one number the quiz can check and the border with Remount stays clean.

### D-037. Run our own replays and quote our own numbers in the course

**Setups touched:** 2 (2 questions): 01:13, 04:13

**The question.** May we run each setup's card rules with the house plan over the pod's history, so the course quotes our numbers instead of Bulkowski's or none?

**Options.** 01:13 (flat bases 2015 to now), 04:13 (the screener's IBD-style cup).

**Evidence.** Several dossiers already did a first replay with the house plan (sections 4 and 12).

**Our default (a recommendation, not a ruling).** Yes: one replay per card with the house plan (the day's-low stop, thirds at 3R and 5R, the 10/21-day trail), 2015 to now, with the window stated; the course quotes only our numbers. Reason: the method plan requires a base rate per setup.

### D-038. A resting buy-stop against E57's market orders

**Setups touched:** 2 (2 questions): 08:13, 40:4

**The question.** E57 says entries are market orders. Does a resting buy-stop a cent over the trigger, which becomes a market order when hit, satisfy it?

**Options.** 08:13 and 40:4: (a) watch and market-order on the trade through; (b) a resting buy-stop.

**Evidence.** 40: it is how every source executes and it removes the chase.

**Our default (a recommendation, not a ruling).** Yes: a resting buy-stop that turns into a market order satisfies E57; the course says "market order on the trigger, resting or by hand". Reason: the fill is a market order either way.

### D-039. A strong close as a rule or a grading cue

**Setups touched:** 2 (2 questions): 08:10, 21:5

**The question.** Must the trigger day close in its upper half (or top quarter, or green, or over the prior high)?

**Options.** 08:10: a rule or a cue. 21:5: top half and over the prior high, top quarter, green only, or none; and is a faded day one a delayed-reaction setup of its own.

**Evidence.** 21: the faded day one is the delayed reaction (in the scope table as a variant).

**Our default (a recommendation, not a ruling).** A grading cue for every setup; for the PEG, where the day is the setup, a close in the top half and over the prior high is the A mark. Reason: we enter before the close (E57).

### D-040. The test that makes a stock parabolic for B26's exception

**Setups touched:** 2 (2 questions): 16:2, 39:4

**The question.** B26's exception needs a definition a scanner and a quiz can apply. 39:4 asks which test; 16:2 asks whether a Wedge Drop after a burst can use it.

**Options.** 39:4: (a) Bracco's five boxes, 3 of 4 plus the gap; (b) that plus an extension floor (10% over the 9 EMA, 40% over the 50-day, a 10+ Jeff Sun ATR multiple); (c) judgment per chart. 16:2: (a) never for a Wedge Drop; (b) when the prior run met the checklist.

**Evidence.** B26 already points to Bracco's post; 39 recommends (b) so a scanner can apply it.

**Our default (a recommendation, not a ruling).** Bracco's boxes (three of four plus the gap up on the climax day) plus the extension floor; a Wedge Drop never qualifies, it comes later. Reason: the rule is only usable if it is measurable.

### D-041. Riskier setups capped at B size

**Setups touched:** 2 (2 questions): 34:8, 38:11

**The question.** Kullamägi calls the parabolic long "by far the riskiest setup". Should the capitulation and parabolic long be capped at B risk unless A+?

**Options.** 34:8: (a) B- risk (0.25-0.5%) by default, 1-1.5% only for a 5-star; (b) the normal grade table. 38:11: (a) B size at most unless A+; (b) normal grading (E49).

**Evidence.** D38 and E49 already size by grade.

**Our default (a recommendation, not a ruling).** The normal grade table (D38, E49), no setup cap; the lesson says most capitulations grade B or lower. Reason: the grade already carries the risk; a setup cap doubles it.

---

## Part B: setup-specific decisions

Grouped by setup in dossier order. Duplicates inside a setup are merged. Setup 12 has no entry here: every one of its
questions is a Part A decision or a Part C rule. Setup 32's remaining questions sit inside setup 13's decisions, since
the two are proposed as one unit (D-002).

### 01 Flat Base Breakout

#### D-042. Minimum length of a flat base

**Questions:** 01:3

**The question.** How many weeks must the base run before it is a flat base and not a flag?

**Options.** (a) 5 weeks, IBD's rule, shorter rests taught as flags; (b) 3 weeks, closer to your examples (FPS "4 weeks", USAR "8 days"); (c) 2 weeks, Kullamägi's.

**Evidence.** Your own calls (FPS, USAR) are shorter than IBD's 5 weeks.

**Our default (a recommendation, not a ruling).** (b) 3 weeks to qualify, 5 weeks for an A; shorter rests are Bull Flags. Reason: it keeps your examples and the IBD mark as the A cue.

#### D-043. Maximum depth of a flat base

**Questions:** 01:4

**The question.** How deep may the base be?

**Options.** (a) 15%, IBD; (b) 12%, our Compass scanner; (c) 10%, the tight end of IBD's band.

**Evidence.** Chart IQ v3 wrote 100 Flat base drafts at up to 22% deep (01:14).

**Our default (a recommendation, not a ruling).** (a) 15% to qualify, 10% for an A. Reason: IBD's number, with the tight end as the grade.

#### D-044. The grading cues on the flat base card

**Questions:** 01:12

**The question.** Are the A+ and B- cues in section 9 the right things to look at, knowing grading stays your call (E50)?

**Options.** Keep, change, or drop.

**Evidence.** E50: grading is discretionary; the cues are what the course points at, not a checklist.

**Our default (a recommendation, not a ruling).** Keep them as cues, worded "what an A+ tends to show". Reason: E50.

### 02 Bull Flag

#### D-045. Maximum length of a flag

**Questions:** 02:4

**The question.** How many sessions may the flag run?

**Options.** (A) 15 sessions; (B) 20 sessions; (C) up to 2 months, as Kullamägi. The dossier recommends A.

**Evidence.** The dossier's textbook check used 15.

**Our default (a recommendation, not a ruling).** (A) 15 sessions. Reason: past that it is a base.

#### D-046. Maximum depth of a flag

**Questions:** 02:5

**The question.** How deep may the flag pull back?

**Options.** (A) half the pole and 15% from the top; (B) a third of the pole; (C) keep the scanner's 62%. The dossier recommends A.

**Evidence.** The scanner's 62% is far looser than any source.

**Our default (a recommendation, not a ruling).** (A) half the pole and 15% from the top; a third of the pole is the A cue. Reason: the sources' range.

#### D-047. The 21-day EMA as the flag's disqualifier

**Questions:** 02:7

**The question.** Is the disqualifier a close under the 21-day EMA that is not reclaimed the next day, with an intraday undercut and reclaim being the buy?

**Options.** Yes or no.

**Evidence.** Your own words put support over confirmation (02:2).

**Our default (a recommendation, not a ruling).** Yes, written on the 20 EMA per the averages decision. Reason: it matches your T1 support-reclaim buy.

### 03 High Tight Flag

#### D-048. Pole size for a High Tight Flag

**Questions:** 03:2

**The question.** 90% or 100%?

**Options.** 90% (Bulkowski; our main scanner, the flag rule's HTF label and Chart IQ) or 100% (IBD, Minervini, TraderLion; both base-catalog structures). The dossier recommends 90% to qualify, 100%+ for an A grade.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** 90% to qualify, 100%+ for an A. Reason: the dossier's recommendation keeps the scanners and the catalog consistent.

#### D-049. Shortest HTF flag

**Questions:** 03:3

**The question.** 3 to 4 days (your DAVE note), 5 sessions (Deepvue), 10 sessions (Minervini's 10 to 12 days) or 15 (IBD's 3 weeks)?

**Options.** As listed. The dossier recommends 5, with 10 to 25 as ideal.

**Evidence.** Your DAVE note used 3 to 4 days.

**Our default (a recommendation, not a ruling).** 5 sessions to qualify, 10 to 25 ideal. Reason: keeps your DAVE-type flags as lesser examples and the textbook as the A.

#### D-050. Deepest HTF flag

**Questions:** 03:4

**The question.** 20% (Minervini) or 25% (IBD)?

**Options.** The dossier recommends 25% to qualify, 20% for an A.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** 25% to qualify, 20% for an A. Reason: the dossier's recommendation.

### 04 Cup with Handle

#### D-051. Cup length

**Questions:** 04:3

**The question.** Our scanner caps the cup at 13 weeks (65 daily bars). IBD allows 7 to 65 weeks.

**Options.** Lift to 65 weeks (the dossier's recommendation) / cap at 26 weeks / keep 13.

**Evidence.** IBD's range is 7 to 65 weeks.

**Our default (a recommendation, not a ruling).** 7 to 65 weeks. Reason: IBD's definition, and your weekly examples run long.

#### D-052. Cup depth

**Questions:** 04:4

**The question.** How deep may the cup be?

**Options.** 12% to 33% normal, 50% only after a bear market (IBD, the dossier's recommendation) / 12% to 35% / Zanger's 20% to 35%.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** 12% to 33%, 50% only after a bear market. Reason: IBD's definition.

#### D-053. Handle depth

**Questions:** 04:5

**The question.** How deep may the handle be?

**Options.** At most 12% (IBD, the dossier's recommendation) / about 5% to 8% only (Zanger) / a third of the cup's depth (AAII).

**Evidence.** 40 of the 100 draft bank items have handles under 5 days (04:14).

**Our default (a recommendation, not a ruling).** At most 12%, with 5% to 8% as the A cue. Reason: IBD's number with Zanger's as the grade.

### 05 IPO Base

#### D-054. What counts as a new listing

**Questions:** 05:2

**The question.** Spin-offs, uplistings, de-SPACs: yes or no to each?

**Options.** Yes or no to each.

**Evidence.** No source rules them in or out for the IPO base.

**Our default (a recommendation, not a ruling).** Spin-offs yes, uplistings no (they have a price history), de-SPACs no (the listing is the merger, not an offering). Reason: the IPO base needs a true first price history.

#### D-055. IPO base depth cap

**Questions:** 05:5

**The question.** 20%, 35% or 50%?

**Options.** As listed.

**Evidence.** IPO bases are wider than regular bases in every source.

**Our default (a recommendation, not a ruling).** 35%, with 20% as the A cue. Reason: the middle number keeps the classic cases.

#### D-056. IPO base minimum length

**Questions:** 05:6

**The question.** 7, 10 or 15 sessions?

**Options.** As listed.

**Evidence.** IBD's early base needs the left-side high within 25 sessions (05:1).

**Our default (a recommendation, not a ruling).** 10 sessions. Reason: the middle number, inside IBD's 25-session window.

#### D-057. Which IPO price the course uses

**Questions:** 05:12

**The question.** The offer price (needs a data source), the IPO open (in our bars), or Stockbee's listing-day close?

**Options.** As listed. Your TTAN note used "IPO price" for the open ($100 against a $71 offer price).

**Evidence.** The open is in our bars; the offer price is not.

**Our default (a recommendation, not a ruling).** The IPO open, called "the IPO open" in the lesson, with the offer price mentioned when known. Reason: it is in our bars and matches your TTAN use.

### 06 VCP

#### D-058. Minimum number of contractions

**Questions:** 06:6

**The question.** 2 (Minervini) or 3 (ChartMill's "common picture", Chart IQ's strict check)?

**Options.** The dossier recommends 2, with 3 or 4 as an A+ sign.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** 2 to qualify, 3 or 4 for an A+. Reason: the originator's number.

#### D-059. How much smaller each contraction must be

**Questions:** 06:7

**The question.** 0.85 (System A), 0.80 (Chart IQ), 0.75 (recommended), or 0.35 to 0.75 (System D, which also forbids very fast shrinking)?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** 0.75 or less of the prior contraction. Reason: the dossier's recommendation; the strict band is a cue.

#### D-060. The trend filter for a VCP

**Questions:** 06:9

**The question.** The full 8-line Trend Template with RS 80, or only B26 (200-day) and C31 (RS 80)? And 30% (2013) or 25% (2017) above the 52-week low?

**Options.** The dossier recommends the full template.

**Evidence.** Minervini changed the number from 30% (2013) to 25% (2017).

**Our default (a recommendation, not a ruling).** The full Trend Template as the A cue, B26 and C31 as the gate, 25% above the 52-week low. Reason: the house rules are the gate; the template is the originator's picture.

#### D-061. Minimum length of a VCP

**Questions:** 06:10

**The question.** None, 3 weeks (recommended), or 6 weeks?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** 3 weeks. Reason: the dossier's recommendation.

### 07 Launchpad

#### D-062. The shape of the base: under the bundle, then a first poke above, then the launch

**Questions:** 07:4

**The question.** "Hanging underneath the MAs" (MSTR) and "I want the dangle above the launchpad for a bit" (CAT). Is under the bundle for weeks, then a first poke above, then the launch the order you want taught?

**Options.** Yes or no.

**Evidence.** On your kept charts most of the base sat under the bundle, then a first poke above it in the last 10 sessions (18 of 26).

**Our default (a recommendation, not a ruling).** Yes, taught as the three-step picture. Reason: it is what your kept charts show.

### 08 Inside Day

#### D-063. Ties on an inside day

**Questions:** 08:1

**The question.** Does a day that matches yesterday's high or low to the cent count as inside?

**Options.** (a) strict; (b) ties allowed.

**Evidence.** No source rules on it.

**Our default (a recommendation, not a ruling).** (b) ties allowed. Reason: a cent should not decide a pattern.

#### D-064. Which high triggers the inside day

**Questions:** 08:2

**The question.** Buy over (a) the inside day's high, or (b) the mother bar's high?

**Options.** Study's glossary says the two-day high, as do Bulkowski (the first day's high, on a close) and Investopedia as summarised in the repo.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (a) the inside day's high, with the mother bar's high as the A cue when the two are close. Reason: it is the tighter trigger and fits the day's-low stop.

#### D-065. Buying the inside day itself

**Questions:** 08:5

**The question.** Do we teach buying the inside day itself (SOUN), or only the break? And was the POET buy on 6 Oct (the inside day) or at the 7 Oct open ($6.73, the cost listed in your 12 Oct post)?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** The break only in the lesson; anticipation goes to the early-entries lesson. You confirm the POET date. Reason: one trigger per setup.

#### D-066. The trend gate for an inside day

**Questions:** 08:7

**The question.** (a) the full 8 > 21 > 50 stack (scanner); (b) close over a rising 21 EMA (id4); (c) just over the 50 and 200-day plus a location rule (the dossier's recommendation).

**Options.** As listed.

**Evidence.** The 6%-over-the-50-day gate hides most of your examples (08:8).

**Our default (a recommendation, not a ruling).** (c). Reason: the house rules already carry the trend; the stack is a cue.

#### D-067. How long the inside-day trigger stays live

**Questions:** 08:9

**The question.** (a) next day only; (b) 3 sessions; (c) until the low breaks.

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (b) 3 sessions. Reason: a middle number the quiz can check.

### 09 Trendline Break

#### D-068. Touches on the line

**Questions:** 09:4

**The question.** (a) 2 is enough; (b) 3 required; (c) 2 to trade, 3 for an A.

**Options.** As listed.

**Evidence.** The app's own judged r7 line uses 3 touches (09:13).

**Our default (a recommendation, not a ruling).** (c). Reason: it keeps the trade and marks the better line.

#### D-069. The trendline numbers

**Questions:** 09:5

**The question.** Minimum line age (the dossier proposes 15 sessions), maximum slope (0.15 ATR a session), maximum depth (35%), volume (1.2x). Accept, change, or drop each?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Accept the age, slope and depth; volume is a cue (the volume decision). Reason: the first three make the line measurable.

### 10 Weinstein 4B-

#### D-070. What counts as the decline before a 4B-

**Questions:** 10:6

**The question.** Depth only (30%? 40%? 50%?), time only (stageanalysis.net's 39 weeks), or both? And the 50-day "flattening" number (1% in 8.1): keep, loosen, or drop?

**Options.** As listed.

**Evidence.** On the two named examples depth is easy (77% and 56%) but time is short (about 17 and 8 weeks under a falling 30-week line before the low), so a time rule would drop both; the 1% flattening rejects the NFLX entry.

**Our default (a recommendation, not a ruling).** Depth only, 30% or more; the flattening number is a cue, not a gate. Reason: a time rule drops both source examples.

### 11 20 EMA Pullback

#### D-071. How far above the 20 EMA you may buy

**Questions:** 11:16

**The question.** Three of your dated examples (ALAB 2025-06-18, XOM 2025-11-18, FLNC 2025-11-07) closed more than 1 ATR above the 20 EMA on the hold day.

**Options.** (a) cap the entry price, not the close, at about 1 ATR above the line; (b) no cap beyond C28 (4% past the buy point) and C29; (c) another limit you use.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (b): C28 and C29 are the only caps, with the distance from the line as a grade cue. Reason: your own examples break a 1 ATR cap.

#### D-072. B22's 3 days: trading days or calendar days

**Questions:** 11:17

**The question.** B22 says no new buys in the 3 days before a report. Trading days or calendar days?

**Options.** Trading or calendar.

**Evidence.** A rulebook clarification asked once.

**Our default (a recommendation, not a ruling).** Trading days. Reason: the rulebook counts sessions everywhere else (C33).

### 13 MA Reclaim

#### D-073. Which lines count for a Remount

**Questions:** 13:2, 32:2

**The question.** (A) the 200-day and the 50-day (above the 200-day) only; (B) add the 20 EMA and "all MAs"; (C) add the weekly 30-week and 10-week lines.

**Options.** The dossier recommends A, with "all MAs" as an A+ cue and the 20 EMA left to pullbacks. 32:2 asks the same for levels: (A) 50-day, 200-day and levels, plus the 20 EMA only above a rising 50-day; (B) add the 20 EMA on its own; (C) add AVWAPs.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** The 200-day, the 50-day above the 200-day, and levels; the 20 EMA only above a rising 50-day; "all MAs" is the A+ cue; AVWAPs stay in setup 19. Reason: it keeps the border with the pullbacks.

#### D-074. How long the line must have been lost

**Questions:** 13:3, 32:3

**The question.** (A) 3 of the prior 20 closes (today's scanner); (B) 5 straight closes (the member tag, remount, draw:remount); (C) a base of 8 weeks or more (your template). 32:3 asks (A) 5 to 30 straight closes; (B) any number; (C) 3 of the last 20.

**Options.** The dossier recommends 5 straight closes as the rule and the 8-week base as the A+ cue; 32 recommends 5 to 30.

**Evidence.** 32 replay: no edge difference; 5 to 30 is the cleanest border with U&R, Oops and the pullbacks.

**Our default (a recommendation, not a ruling).** 5 to 30 straight closes under, the 8-week base as the A+ cue. Reason: the cleanest border.

#### D-075. The remount numbers against your own examples

**Questions:** 13:14

**The question.** Of the 16 reclaim days behind your named remounts, only 4 pass every proposed rule.

**Options.** (a) margin over the line: 0.5 ATR (fails 8 of 16), 0.25 ATR (fails 2), or any close above plus the upper-half close; (b) the 200-day's slope: must be higher than 20 sessions ago (fails 11 of 16) or only "not falling fast" (the line no lower than 10 sessions ago minus 0.5 ATR; every 200-day example passes); (c) volume: the 50-day average as the rule (fails 4, CRWD among them) or a cue; (d) the chop count on the 60 sessions before the break or before the reclaim.

**Evidence.** As listed; the dossier recommends 0.25 ATR, "not falling fast", a cue, and the 60 before the break.

**Our default (a recommendation, not a ruling).** 0.25 ATR, "not falling fast" with flattening as a plus, volume a cue, the 60 sessions before the break. Reason: it keeps 14 of your 16 remounts.

### 14 EMA Crossback

#### D-076. How long after the Wedge Pop the crossback may come

**Questions:** 14:5

**The question.** (a) 3 to 20 sessions; (b) any time before the first new high; (c) your number.

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (a) 3 to 20 sessions. Reason: a window the quiz can check.

### 15 Wedge Pop

#### D-077. Must a Reversal Extension come first

**Questions:** 15:2

**The question.** (a) yes, a capitulation day first; (b) no, any decline that spent most of three weeks under the 20 EMA (8 of 15 closes).

**Options.** The dossier recommends (b).

**Evidence.** Kell allows rounded lows (COIN: "never formed a textbook Reversal Extension") and popped MU and CAVA inside uptrends.

**Our default (a recommendation, not a ruling).** (b), with the capitulation day as the A+ cue. Reason: Kell's own cases.

### 16 Wedge Drop

#### D-078. One or both averages for the Wedge Drop

**Questions:** 16:5

**The question.** (a) a close under the 10 counts; (b) both are required.

**Options.** The dossier recommends (b) for the short and grades a 10-only loss down; for the long holder's exit, (a) is closer to what Kell did (QQQ 2023-02-16/17; the AMD exit of 2024-01-02).

**Evidence.** The 10-only version was not measured.

**Our default (a recommendation, not a ruling).** (b) both for the short; (a) for the long holder's exit. Reason: the dossier's split, matched to Kell's own use.

### 17 Holy Grail

#### D-079. The ADX gate

**Questions:** 17:2

**The question.** Keep Raschke's 30, use Wilder's 25, or none?

**Options.** As listed; untested for us, a replay would answer it.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Raschke's 30 as the variant's definition (it is her setup), tested in the replay. Reason: the name comes with her number.

#### D-080. What counts as a touch of the 20 EMA

**Questions:** 17:4

**The question.** Must the day's range reach the line, or does a low within 0.25 ATR above it count?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** A low within 0.25 ATR counts. Reason: a few cents should not decide the pattern.

### 18 Qullamaggie and Kell

#### D-081. The Reversal Extension in the course

**Questions:** 18:8

**The question.** You wrote on 2026-11-08 that you try them (on 1-3 day trades, "primarily to stay in tune").

**Options.** (a) watch-only in the course (recommended); (b) a trade, only as a parabolic long under Bracco's mirror definition; (c) a trade on the index only.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (a), with (b) noted as the only traded form. Reason: your own words say it is to stay in tune.

### 19 AVWAP Reclaim

#### D-082. Which anchors count

**Questions:** 19:2

**The question.** (a) only the high (the member drawing); (b) high, earnings gap and IPO as three named variants; (c) any meaningful event, lows included.

**Options.** The dossier recommends (b) for a first lesson.

**Evidence.** Shannon's own worked reclaim is from a low; you already anchor from the HVE day on HVE charts.

**Our default (a recommendation, not a ruling).** (b). Reason: three named anchors a quiz can ask for.

#### D-083. How long under the AVWAP

**Questions:** 19:3

**The question.** (a) 15 closes (the drawing); (b) 5 (the scanner); (c) different for the earnings and IPO variants.

**Options.** The dossier recommends 15 for the high.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** 15 for the high anchor, 5 for the earnings and IPO anchors. Reason: the younger anchors have less history.

### 20 Episodic Pivot

#### D-084. How many sessions after the gap still count as an EP entry

**Questions:** 20:9

**The question.** Bonde watches for a year; the dossier proposes 10 sessions.

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** 10 sessions; later entries are the pattern's own setup (a flag, a gap-support test). Reason: a window the cards can check.

### 21 Power Earnings Gap

#### D-085. The house entry for a PEG

**Questions:** 21:6

**The question.** (a) the pause buy as default plus day one for A+ only (recommended); (b) pause only; (c) day one only (ORH); (d) all named variants, member's choice. Which pause trigger: the pause high, the Slingshot close, or the 30-minute opening range the next day?

**Options.** As listed.

**Evidence.** Your words (22:10): "I love trading earnings gappers on day one".

**Our default (a recommendation, not a ruling).** (a), with the pause high as the trigger (the Slingshot close is the variant). Reason: your day-one habit at A+ only, the pause for everyone.

### 22 News Gapper

#### D-086. The course draft: never the open, or day one too

**Questions:** 22:10

**The question.** "Never the open, always the reclaim" (docs/curriculum, SET.20) against "I love trading earnings gappers on day one". Rewrite the draft to teach both?

**Options.** Yes or no.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Yes, both, with day one as the A+ form. Reason: your own words.

### 23 News Failure

#### D-087. Same day or a few days for a News Failure

**Questions:** 23:5

**The question.** (a) the same day's close only (Shapiro's usual test); (b) up to 3 sessions to recover the pre-news close.

**Options.** The dossier recommends (a) for shorts and (b) for longs.

**Evidence.** Bracco's SOXX and SPCX took days; Shapiro once read a run of days (January 2024).

**Our default (a recommendation, not a ruling).** (a) for shorts, (b) for longs. Reason: the dossier's split.

#### D-088. Crowding as a requirement

**Questions:** 23:7

**The question.** Should the lesson require crowding first (index COT for ETFs; a big prior run or fall for stocks)? Shapiro requires it.

**Options.** Yes or no.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** A grade cue, not a requirement. Reason: it cannot be measured on the chart alone.

### 24 High Volume Edge

#### D-089. The HVE volume rule and how far back the record looks

**Questions:** 24:1, 24:2

**The question.** (a) 10x the 50-day OR 2.5x the old record (the finder; misses COMP and CPNG, which you kept); (b) any record, no multiple (your Substack usage: NBIS, PUMP, VELO); (c) 10x AND an all-history record. And "ever" or one year: the app looks back about nine and a half months.

**Options.** The dossier recommends (a) as the rule and (c) as the A+ cue; the record since the IPO with the one-year record as a lesser grade.

**Evidence.** Four of your five great charts are (c); RUM was a one-year record; your kept charts were all-history records 16 times in 19.

**Our default (a recommendation, not a ruling).** (a) as the rule, (c) as the A+ cue; the record is since the IPO, a one-year record is a lesser grade. Reason: it keeps COMP, CPNG and RUM.

#### D-090. The call at the first return to the high-volume close

**Questions:** 24:7

**The question.** The Trade Story game waits on this.

**Options.** (a) hold with the plan's stop; (b) take some off; (c) sell the rest.

**Evidence.** On your kept charts a new high came first 8 times in the 13 that can be decided; on HVEs like yours, 61%; on all mechanical ones, 47%.

**Our default (a recommendation, not a ruling).** (a) hold with the plan's stop. Reason: the data.

#### D-091. Down-close record-volume days

**Questions:** 24:8

**The question.** The app calls them bearish.

**Options.** (a) stop firing on down closes; (b) relabel them as a capitulation watch; (c) leave as is.

**Evidence.** The dossier recommends (a) for this setup and (b) as a separate idea.

**Our default (a recommendation, not a ruling).** (a) for the HVE, (b) as a cue for the capitulation setup. Reason: the dossier's recommendation.

#### D-092. More excluded days

**Questions:** 24:9

**The question.** Add the last Friday of June (index reconstitution) and acquisition announcements (a pin) to OPEX and month-end?

**Options.** Yes or no.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Yes to both. Reason: the volume is not demand on those days.

#### D-093. The minimum move on the HVE day

**Questions:** 24:11

**The question.** Up 8% (your kept minimum), 10% (Duncan), or 20% (all your greats)?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** 8% to qualify, 20% for an A+. Reason: your kept minimum and your greats.

### 25 Gap Support

#### D-094. How much breach is slight, and must the test day close back above the gap-up low

**Questions:** 25:1, 25:2

**The question.** Your great AFRM (-0.7%) and MU (-0.9%) closed just under it, META (-5.4%), TWLO (-2.8%) and TER (-2.0%) further under.

**Options.** Breach: (a) up to 2% (K-M's porosity); (b) up to 3%; (c) up to 5% (the finder); (d) up to about 7.5% (META 6.9%, TWLO 7.5%). Close: (a) the same day; (b) within 1% is fine; (c) a reclaim by the next session's close counts.

**Evidence.** The dossier recommends 5% with META and TWLO as the outer edge, and within 1% for the close; on the bars the tests that closed under did no worse than the ones that held (4.7). Your ruling: "I want the gap up low to hold or be slightly breached instead of the gap fill spot".

**Our default (a recommendation, not a ruling).** Breach up to 5%, close within 1% of the gap-up low; deeper closes count after a reclaim as lesser examples. Reason: it keeps AFRM, MU and EDU, and matches your ruling.

#### D-095. The time window for a test

**Questions:** 25:12

**The question.** Keep 2 to 60 sessions, or cap it (K-M tighten after day 5; your DOCS and KKR tests came 37 and 38 sessions later)?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Keep 2 to 60. Reason: your DOCS and KKR tests.

#### D-096. How big the gap must be

**Questions:** 25:13

**The question.** The 4% and 2x in the lesson are the scanner's numbers. In your posts MU's $458 "gap up lows" was a 3.0% gap on 1.1x volume and TSLA's $467.50 "bullish open gap" a 2.3% gap on 1.4x.

**Options.** (a) keep 4% and 2x; (b) any true gap the stock holds, graded higher when it is big and heavy; (c) another number.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (b). Reason: your own posts use smaller gaps.

### 26 Kicker

#### D-097. The red day: must the Kicker open above its open, and how big must it be

**Questions:** 26:4, 26:5

**The question.** Your picture-perfect JBI opened inside the red body. The 1-5% body and the 9%-bar-too-dramatic notes are an assistant's, not yours. A 1% body floor would cut your "very good" GS (0.48% body, but down 1.86% on the day) and your "good" RCUS (0.78%, and up on the day).

**Options.** Open above the red open: (a) a grade factor only; (b) required. Red day size: (a) a body of at least 1% or a 1% drop on the day, no cap; (b) a body of at least 1% only; (c) also cap the body near 5% and the range at 2.5 or 3 ATR.

**Evidence.** Your verdicts: "generally want a bit of a weaker close visually the previous day".

**Our default (a recommendation, not a ruling).** Open above the red open is a grade factor; the red day is a body of at least 1% or a 1% drop on the day, no cap, with a 9%+ bar graded down. Reason: it keeps JBI, GS and RCUS as you graded them.

### 27 Bear Gap

#### D-098. Off the highs: a top, or a range near the highs, and how far

**Questions:** 27:3

**The question.** (a) any recent top (the app now); (b) a range near the highs, like MPWR; (c) your call per chart. And how far from the top may the prior close be: 30% (the app, which let in NFLX), 15%, or 10%?

**Options.** As listed.

**Evidence.** Your ruling: "Don't want to do downtrend gaps but will do bear gaps off the highs".

**Our default (a recommendation, not a ruling).** (b), within 10% of the top. Reason: your ruling rules out downtrend gaps, and 30% let in NFLX.

#### D-099. What counts as a bear gap

**Questions:** 27:6

**The question.** (a) a full daily window (high under the prior low; the app now); (b) any open under the prior close that is not filled that day (your BE, GLW, MRNA examples); (c) a minimum size: 5% (the app), 1 ATR, or 4%. And volume: 2x (the app), 1.5x, or none (your SNDK gaps had 1.3x and 0.9x).

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (b) with a 1 ATR minimum; volume a cue. Reason: your BE, GLW, MRNA and SNDK examples.

#### D-100. Which line the chart emphasises

**Questions:** 27:9

**The question.** The course says the gap day's high; the overlay labels the prior day's low.

**Options.** (a) draw the zone between them as one band (the dossier's recommendation); (b) the gap day's high only; (c) the prior day's low only.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (a). Reason: the level is a zone.

### 28 2B Reversal

#### D-101. Which lows count for a 2B

**Questions:** 28:2

**The question.** (a) any swing low 5-60 sessions old with a rally between; (b) only multi-week lows the whole market can see; (c) also last week's low and range lows, as in your posts.

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (a), with (b) as the A cue. Reason: a measurable window that keeps your range-low cases.

#### D-102. How fast the reclaim must be

**Questions:** 28:3

**The question.** (a) same day only; (b) same day or next day; (c) within 3 sessions.

**Options.** As listed.

**Evidence.** Bracco's names took 1 to 3 days.

**Our default (a recommendation, not a ruling).** (c) within 3 sessions, the same day as the A. Reason: it matches the undercut decision.

### 29 Undercut and Rally

#### D-103. Which levels count for a U&R

**Questions:** 29:2

**The question.** (a) only prior lows and base lows (Morales); (b) those plus rising moving averages (MAU&R); (c) any obvious level, including prior highs, round numbers, gap lows, VWAP (your usage). And should the prior day's low alone count? Our test says it is not special.

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (b) plus gap lows; the prior day's low alone does not count. Reason: the test, and the Oops already owns the prior-day low.

### 30 Oops Reversal

#### D-104. The Williams open as the A+ requirement

**Questions:** 30:10

**The question.** Should the Williams Oops (open below the prior low) be the A+ requirement, or just a plus?

**Options.** As listed.

**Evidence.** The member tag shows only Williams Oops days (30:12).

**Our default (a recommendation, not a ruling).** The A+ requirement. Reason: it is the originator's form.

#### D-105. The "low never breaks" rule

**Questions:** 30:13

**The question.** Keep it as an example filter only (the low broke within 20 sessions on three of four Oops days in our test), or also teach it as a sell rule (sell on any later trade under the Oops low, even after a trim)?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** An example filter only; the stop is the sell rule (A4). Reason: A4.

### 31 Slingshot

#### D-106. PEG only, or PEG mostly

**Questions:** 31:1

**The question.** (a) only the way into a power earnings gap; (b) PEG mostly, a strong rally allowed (your COIN words: "Not exclusively to PEGs but still good"); (c) any strong stock, as Scot1and does.

**Options.** The dossier recommends (b); the test found no difference between the two kinds of drive.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (b). Reason: your COIN words.

#### D-107. Pullback length and depth

**Questions:** 31:4, 31:5

**The question.** Length: (a) 3-7 closes under the line; (b) 3-8, so VRT ("Perfect", 8 by a strict count) fits; (c) no upper limit. Depth: (a) 5-12% (your greats measured 5.6-11.7%); (b) 5-9%; (c) Scot1and's "The EMA 9 should be the limit".

**Options.** The dossier recommends 5-12%.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** 3-8 closes and 5-12%. Reason: it keeps VRT and your measured greats.

#### D-108. Quiet or strong trigger days

**Questions:** 31:8

**The question.** You graded +11% to +13% trigger days lower ("good", "okay") than +3% to +6% days; the test found the strong days did better.

**Options.** Prefer quiet, prefer strong, or neither.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Neither as a rule; a quiet trigger is the cleaner teaching picture and the course says so. Reason: the data and your grades disagree.

### 33 Failed H&S / Rounded Top

#### D-109. Which failure counts

**Questions:** 33:2

**The question.** (a) only after a neckline break (version B, Bracco's "failed breakdown"); (b) also when the break never comes (version A, the card's wording).

**Options.** The dossier recommends both, with A graded lower, and the card's wording and glyph updated to show a neckline and an undercut.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Both, A graded lower. Reason: the dossier's recommendation.

#### D-110. The failed H&S numbers

**Questions:** 33:9

**The question.** Head 3%+ over the higher shoulder; shoulders within 10%; 15 to 100 days; depth 5% to 30%; failed break under 10%.

**Options.** Accept or change.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Accept. Reason: they make the pattern measurable.

### 34 Capitulation

#### D-111. Which capitulation settings the course teaches

**Questions:** 34:2

**The question.** (a) leader flush and index washout; (b) also the deep-downtrend climax the scanner finds now; (c) index washout only.

**Options.** The dossier recommends (a).

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (a). Reason: the deep-downtrend climax is under the 200-day and outside the burst.

### 35 Wyckoff Spring / Upthrust

#### D-112. How long and how clean the range must be

**Questions:** 35:2

**The question.** (a) at least 15 sessions, 2 touches (the app's scanner minimum); (b) at least 20 sessions, 2 touches; (c) at least 30 sessions, 3 touches.

**Options.** Your DELL and AMZN examples used short ranges (a week or two, sometimes on the hourly chart), which only (a) or a looser rule would admit.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (a) 15 sessions, 2 touches. Reason: your DELL and AMZN cases.

#### D-113. Two-bar springs

**Questions:** 35:6

**The question.** (a) count them (they measured better, +0.15R); (b) one-bar only.

**Options.** Your AMZN example is a two-bar spring.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (a). Reason: the data and your AMZN example.

### 36 Mean Reversion

#### D-114. The stretch measure the course teaches

**Questions:** 36:6

**The question.** The % ATR move from the prior close (Bracco's 200%); RSI(2) under 5 (Connors); a close under the lower band; distance from the 20-day in ATRs (the old template's 3 ATR); the ATR% multiple from the 50-day (Jeff Sun).

**Options.** The dossier recommends a star count of the first three plus the down-day count.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** The star count. Reason: one score a quiz can ask for, with Bracco's number first.

### 37 Wick Play

#### D-115. Which wick-play form is ours

**Questions:** 37:1

**The question.** (a) strict: day 2 wholly inside day 1's upper wick, buy day 3 over day 2's high (Deepvue, TaPlot); (b) same-day: open in the wick and buy the push over day 1's high (Kell's APPS, your "gap up wick play with immediate push"); (c) both.

**Options.** The dossier recommends (c), in the order given in 8.2.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (c). Reason: both are yours.

#### D-116. Touching the body, and the minimum wick

**Questions:** 37:4, 37:5

**The question.** Touching the body: none (Deepvue), or "a little" as Kell allowed on GOOG (for example 0.25 ATR)? Minimum wick on day 1: none, or a quarter of the range?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** 0.25 ATR into the body allowed; a quarter of the range as the minimum wick. Reason: measurable and matches Kell's GOOG.

#### D-117. Measuring the same-day form before it ships

**Questions:** 37:14

**The question.** The same-day form's stop cannot be tested on daily bars (4.3, item 5). Measure it on 30-minute bars before it goes into a scanner, a drill or Hard mode, or ship it as a judgment entry with no measured claim?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Measure it on 30-minute bars first. Reason: no unmeasured claim in Hard mode.

### 38 Parabolic Long

#### D-118. Depth of the fall

**Questions:** 38:8

**The question.** For blow-off unwinds: (a) 40% minimum, 50% for A+; (b) Kullamägi's 50-60%+. For declines: (a) 3 ATR index, 5 ATR stock, 7 for A+; (b) one number for both.

**Options.** The dossier recommends the (a) options.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** The (a) options. Reason: the dossier's recommendation.

#### D-119. Is the gap-down climax required

**Questions:** 38:13

**The question.** Your TQQQ trade and Bracco's SOXL trade both bought the day-2 gap up after a flush day that opened UP.

**Options.** (a) keep the gap down required for the main version and teach the day-2 gap up as a separate, named entry; (b) require the gap down for both; (c) drop the requirement and grade it instead.

**Evidence.** The mirror of Bracco's "I won't short without that gap-up".

**Our default (a recommendation, not a ruling).** (a). Reason: it is what UCT actually traded.

### 39 Parabolic Short

#### D-120. Which parabolic-short versions the course teaches

**Questions:** 39:1

**The question.** (a) P1 only, the climax-day short; (b) P1 and P2 (the day-2 gap down) at smaller size; (c) also a swing version on daily bars.

**Options.** The dossier recommends (b).

**Evidence.** P2 had the cleaner stop in the test.

**Our default (a recommendation, not a ruling).** (b). Reason: both are Bracco's.

#### D-121. Which ATR multiple the course teaches

**Questions:** 39:8

**The question.** (a) Jeff Sun's percent form (Bracco since 2025-09); (b) the 2025 points form; (c) percent extensions only.

**Options.** The dossier recommends (a), with the formula written out.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (a). Reason: Bracco's current form.

#### D-122. Small caps in the parabolic short

**Questions:** 39:11

**The question.** Kullamägi trades 300-1000% small-cap runs; Bracco prefers mid and large caps. Include small caps that pass B23 and D48?

**Options.** Yes or no.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Yes, if they pass B23 and D48, graded B. Reason: the rulebook already filters them.

### 40 Opening Range Breakout

#### D-123. Must the opening-range high clear the prior day's high

**Questions:** 40:7

**The question.** (a) required; (b) graded higher; (c) ignored.

**Options.** The dossier recommends (b) (Bysshe; your CEP and TMDX plans).

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (b). Reason: your CEP and TMDX plans.

#### D-124. Range low broken first

**Questions:** 40:8

**The question.** Is the long ORB off for the day once the 30-minute low trades first, or can you still buy a later ORH break the same day?

**Options.** As listed; the dossier proposes off for the day.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Off for the day. Reason: the range failed.

### 41 30-Minute Pivot

#### D-125. Must the pivot be at a daily level, and which levels

**Questions:** 41:3

**The question.** Your 2026-05-18 note says yes. Which levels count: the 10/20-day EMA, the 50-day SMA, gap support, an HVC, a prior breakout level, a range low? Any others (AVWAP, the 8-week EMA)?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Yes, at a daily level: the 9/20 EMA, the 50-day, gap support, an HVC, a prior breakout level, a range low, an AVWAP. Reason: your note.

#### D-126. The red string before the pivot

**Questions:** 41:4

**The question.** At least 2 red 30-minute candles, or 3? Or no count, just "a pullback on the 30-minute chart"?

**Options.** As listed; the replay did better with 3 or more (4.4).

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** 3 or more. Reason: the replay.

#### D-127. The trigger window

**Questions:** 41:5

**The question.** Same session only, or may the next morning's break of the pivot high count?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Same session, the next morning as a lesser grade. Reason: the pivot is an intraday read.

### 42 Go Signal

#### D-128. Which open counts for a Go Signal

**Questions:** 42:1

**The question.** (a) any open, as long as the first hourly candle trades under the prior close; (b) only an open above the prior close that dips through it ("green to red", your 2026-11-01 words); (c) a gap down (your 22 Jun 2025 "0.7% or more").

**Options.** The dossier recommends (a), teaching (b) and (c) as its two shapes.

**Evidence.** Your verdict: "the first hourly candle should go green to red and take out previous day close, for the most part".

**Our default (a recommendation, not a ruling).** (a), with (b) as the A form. Reason: your "for the most part".

#### D-129. Close or touch for the hourly reclaim

**Questions:** 42:4

**The question.** Must an hourly candle close back above the prior close, or is trading back above it enough? (Your META example of 12 Sep 2025 traded above it in the second hour and closed above it in the third.)

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Trading back above is the trigger (market order), the hourly close above is the confirmation grade. Reason: it matches the trigger decision.

#### D-130. Which levels the Go Signal needs

**Questions:** 42:7

**The question.** Is the 20-day EMA the main level, and which others count (9 EMA, 50-day, bullish gap, HVC, base top, prior day's low)?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** The 20-day EMA is the main level; the 50-day, a bullish gap, an HVC and a base top also count; the 9 EMA and the prior day's low alone do not. Reason: the same level list as the 30-minute pivot.

#### D-131. The hourly flag

**Questions:** 42:8

**The question.** Required, or a plus? How tight (10%? 5%?) and how many sessions (2 to 5)?

**Options.** As listed.

**Evidence.** Your ruling: "GO SIGNALS are supposed to be notable hourly flags that undercut a slight range and quickly go red to green in the first hour".

**Our default (a recommendation, not a ruling).** Required, within 5% and 2 to 5 sessions. Reason: your ruling says the flag is the setup.

#### D-132. The already-moved test

**Questions:** 42:9

**The question.** Keep the scanner's test (13% in 5 days, a 4% gap on 2x volume, or a tight base above the 50), or use something simpler?

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** Simpler: a rising 20-day EMA and price above it for 10 sessions. Reason: the hourly flag already carries the move.

### 43 Red to Green

#### D-133. How big the gap down must be, and a ceiling

**Questions:** 43:3

**The question.** (a) 0.7% or more for the A version (your 2025-06-22 words), smaller as a lesser version; (b) any open below the close; (c) any dip below, even after a green open (Bracco's TEM). Ceiling: about 4%, none, or another number.

**Options.** As listed.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (a) with a 4% ceiling. Reason: your number and C28.

### 44 Opening Drive

#### D-134. The gap minimum for an opening drive

**Questions:** 44:4

**The question.** (a) 1% (app); (b) 3% (SMB "ideally"); (c) open above the prior day's high; (d) none.

**Options.** The dossier recommends (a) as the floor, (c) as an A+ mark.

**Evidence.** As listed.

**Our default (a recommendation, not a ruling).** (a) as the floor, (c) as the A+ mark. Reason: the dossier's recommendation.

---

## Part C: already settled by the rulebook or a verdict

These are not open. The card marks them `settled` with the rule id. If a line misreads a rule, say so and it moves to Part B.

### D-135. A5 (one price, one stop, no adding)

A5: "The full size at one price with one stop; no adding." Your 2026-11-09 words: "I do not scale into trade i buy full at one spot with one stop."

- `11:9`: The 20 EMA pullback is a new trade at full size, not an add-on.
- `12:12`: One entry only; TSDR's ALAB and COIN adds are not taught.
- `14:13`: The crossback is a full new entry, not an add.
- `18:9`: Kell's adds at the crossback and Base n' Break are not taught; a later phase is a new trade only from flat (B21).
- `38:3`: One entry at one price for the parabolic long.
- `39:7`: One entry at the VWAP break; Bracco's second entry at the day's low is not taught.

### D-136. A4 (the stop is the exit) and the 2026-11-09 verdict on rule 15

A4: "The stop is the exit. It only moves up, never down or wider." Your words on the cut-half rule: "15, eh, my stop is my stop most of the time." No setup adds an exit before the stop.

- `07:14`: A close back under the 200-day after a Launchpad entry is not an exit; the stop is.
- `08:15`: An entry day that closes back under the inside day's high: hold to the stop.
- `09:8`: A close back under the trendline is not an exit.
- `13:5`: A 200-day remount that slips back under the line but stays above the stop: hold.
- `19:6`: A close back under the AVWAP after the buy is not an exit.
- `26:10`: No early Kicker exits (Bigalow's gap back, the ARKK engulfing candle, a close under the red high).
- `29:8`: A close back under the reclaimed level: hold to the stop.
- `30:2`: An Oops reclaim that fails the same day: keep the Oops-day stop, do not add.
- `43:6`: A red-to-green that closes back under the prior close: keep the stop; taught as a warning.
- `44:6`: A drive day that closes below its open: the stop is the only exit.

### D-137. B22 (earnings)

B22: no new buys in the 3 days before a report; hold through a report only if the trade is up 5R.

- `18:14`: Kell's reduced "earnings size" through a report is not taught; B22 stands.
- `21:11`: A PEG is sold before the next report unless up 5R.

### D-138. B23 ($10 and $20 million a day)

B23: trade only stocks at $10 or more that trade at least $20 million a day.

- `11:11`: GPRO, CIFR, WULF and OPEN under $10 are out of the lesson's examples.

### D-139. B26 (the 200-day line)

B26: no longs below the 200-day SMA unless a parabolic long. A hard rule ("200SMA is hardened rule yes").

- `11:12`: The NVDA 2022-07-25 bounces and the AAPL 2022-09-01 Go Signal were under the 200-day: not longs.
- `13:4`: A 50-day reclaim under the 200-day is not this setup and not a long; it is setup 10's 4B-.

### D-140. D40 (fundamentals)

D40: prefer stocks with growing sales and earnings; the chart comes first.

- `03:9`: Fundamentals are preferred, not required, for the High Tight Flag.
- `20:11`: Fundamentals (EPS or sales +25% with a beat) are a grading cue for an EP, not a gate.

### D-141. E58 (no buys outside regular hours)

E58: no new buys outside regular trading hours.

- `20:10`: No pre-market EP buys, though Bonde made his biggest EP money pre-market.

### D-142. B21 and E56 (re-entry)

B21: after a stop-out, buy again only on a new trigger, as a new trade. E56: at most 3 tries in a week and 6 in a month.

- `39:12`: The plan template's "do not re-short the same run" loses to B21 and E56: a new trigger may be taken, up to 3 tries a week.
- `40:11`: Your RVMD retake of the day's high after a stop-out is allowed under B21 and counts against E56.

### D-143. C30 (no time-of-day rule)

C30: no time-of-day rule.

- `40:2`: The ORB trigger is valid all session; the 30-minute window is the trigger's definition, not a clock rule; later triggers may grade lower (E50).
- `43:7`: No time rule for the red-to-green cross; the first or second hourly candle is a grading factor.

### D-144. Your Kicker stop ruling (2026-11-02)

Your words: "Under the kicker candle low or entry with a 3.5% stop but we should get these with smaller than 3.5% stop usually." The note records it applies to both Kicker entries (the day-1 30-minute ORB and the day-2 break over the previous day's high).

- `26:1`: When you buy at the open and there is no low yet, the stop is 3.5% under the fill, raised to a few cents under the 30-minute low at 10:00 (our reading of the ruling).
- `26:7`: The Kicker keeps 3.5%, not A13's 3%.

### D-145. Your Go Signal ruling (2026-10)

Your words: "None of these are really go signals, the first hourly candle should go green to red and take out previous day close, for the most part" and "I need a go signal to go red to green in the first or second hourly candle essentially."

- `42:2`: Red to green is measured against the prior day's close, not the hourly candle's open or a flag low.
- `43:2`: The red-to-green line is the prior close everywhere; the hourly finder that uses the day's open is fixed.

### D-146. C35 and C33 (we swing trade; the 10-day time stop)

C35: days to a few weeks; a winner can be held longer while it keeps working. C33: a trade still under 1R after 10 trading days is sold.

- `10:8`: The 4B- is a short-term trade on the house trims, not a position meant to ride into Stage 2.

---

## Part D: the map from every question to its decision

Corrected 2026-11-10 after the criteria cards were written: 24:6 and 36:9 moved to D-009 (both are the 200-day rule), 02:14 to D-014 (a Model Book rewrite).

Every one of the 596 questions, by dossier. Part C ids are marked (settled).

**01 Flat Base Breakout** (15 questions)

| Question | Decision |
|---|---|
| 01:1 | D-002 |
| 01:2 | D-002 |
| 01:3 | D-042 |
| 01:4 | D-043 |
| 01:5 | D-029 |
| 01:6 | D-006 |
| 01:7 | D-027 |
| 01:8 | D-005 |
| 01:9 | D-025 |
| 01:10 | D-001 |
| 01:11 | D-018 |
| 01:12 | D-044 |
| 01:13 | D-037 |
| 01:14 | D-004 |
| 01:15 | D-007 |

**02 Bull Flag** (15 questions)

| Question | Decision |
|---|---|
| 02:1 | D-002 |
| 02:2 | D-027 |
| 02:3 | D-029 |
| 02:4 | D-045 |
| 02:5 | D-046 |
| 02:6 | D-006 |
| 02:7 | D-047 |
| 02:8 | D-005 |
| 02:9 | D-013 |
| 02:10 | D-012 |
| 02:11 | D-025 |
| 02:12 | D-001 |
| 02:13 | D-004 |
| 02:14 | D-014 |
| 02:15 | D-002 |

**03 High Tight Flag** (12 questions)

| Question | Decision |
|---|---|
| 03:1 | D-002 |
| 03:2 | D-048 |
| 03:3 | D-049 |
| 03:4 | D-050 |
| 03:5 | D-027 |
| 03:6 | D-005 |
| 03:7 | D-006 |
| 03:8 | D-024 |
| 03:9 | D-140 (settled) |
| 03:10 | D-001 |
| 03:11 | D-004 |
| 03:12 | D-007 |

**04 Cup with Handle** (16 questions)

| Question | Decision |
|---|---|
| 04:1 | D-012 |
| 04:2 | D-002 |
| 04:3 | D-051 |
| 04:4 | D-052 |
| 04:5 | D-053 |
| 04:6 | D-027 |
| 04:7 | D-003 |
| 04:8 | D-008 |
| 04:9 | D-019 |
| 04:10 | D-006 |
| 04:11 | D-001 |
| 04:12 | D-002 |
| 04:13 | D-037 |
| 04:14 | D-007 |
| 04:15 | D-010 |
| 04:16 | D-007 |

**05 IPO Base** (15 questions)

| Question | Decision |
|---|---|
| 05:1 | D-002 |
| 05:2 | D-054 |
| 05:3 | D-034 |
| 05:4 | D-034 |
| 05:5 | D-055 |
| 05:6 | D-056 |
| 05:7 | D-027 |
| 05:8 | D-005 |
| 05:9 | D-017 |
| 05:10 | D-013 |
| 05:11 | D-034 |
| 05:12 | D-057 |
| 05:13 | D-001 |
| 05:14 | D-007 |
| 05:15 | D-014 |

**06 VCP** (17 questions)

| Question | Decision |
|---|---|
| 06:1 | D-002 |
| 06:2 | D-008 |
| 06:3 | D-005 |
| 06:4 | D-003 |
| 06:5 | D-006 |
| 06:6 | D-058 |
| 06:7 | D-059 |
| 06:8 | D-029 |
| 06:9 | D-060 |
| 06:10 | D-061 |
| 06:11 | D-012 |
| 06:12 | D-027 |
| 06:13 | D-001 |
| 06:14 | D-007 |
| 06:15 | D-010 |
| 06:16 | D-028 |
| 06:17 | D-007 |

**07 Launchpad** (15 questions)

| Question | Decision |
|---|---|
| 07:1 | D-003 |
| 07:2 | D-005 |
| 07:3 | D-009 |
| 07:4 | D-062 |
| 07:5 | D-021 |
| 07:6 | D-001 |
| 07:7 | D-011 |
| 07:8 | D-017 |
| 07:9 | D-012 |
| 07:10 | D-006 |
| 07:11 | D-004 |
| 07:12 | D-014 |
| 07:13 | D-022 |
| 07:14 | D-136 (settled) |
| 07:15 | D-002 |

**08 Inside Day** (16 questions)

| Question | Decision |
|---|---|
| 08:1 | D-063 |
| 08:2 | D-064 |
| 08:3 | D-008 |
| 08:4 | D-002 |
| 08:5 | D-065 |
| 08:6 | D-005 |
| 08:7 | D-066 |
| 08:8 | D-017 |
| 08:9 | D-067 |
| 08:10 | D-039 |
| 08:11 | D-012 |
| 08:12 | D-001 |
| 08:13 | D-038 |
| 08:14 | D-014 |
| 08:15 | D-136 (settled) |
| 08:16 | D-002 |

**09 Trendline Break** (13 questions)

| Question | Decision |
|---|---|
| 09:1 | D-002 |
| 09:2 | D-020 |
| 09:3 | D-003 |
| 09:4 | D-068 |
| 09:5 | D-069 |
| 09:6 | D-012 |
| 09:7 | D-008 |
| 09:8 | D-136 (settled) |
| 09:9 | D-002 |
| 09:10 | D-001 |
| 09:11 | D-009 |
| 09:12 | D-015 |
| 09:13 | D-004 |

**10 Weinstein 4B-** (10 questions)

| Question | Decision |
|---|---|
| 10:1 | D-016 |
| 10:2 | D-009 |
| 10:3 | D-011 |
| 10:4 | D-005 |
| 10:5 | D-003 |
| 10:6 | D-070 |
| 10:7 | D-016 |
| 10:8 | D-146 (settled) |
| 10:9 | D-004 |
| 10:10 | D-015 |

**11 20 EMA Pullback** (17 questions)

| Question | Decision |
|---|---|
| 11:1 | D-012 |
| 11:2 | D-003 |
| 11:3 | D-021 |
| 11:4 | D-024 |
| 11:5 | D-036 |
| 11:6 | D-026 |
| 11:7 | D-023 |
| 11:8 | D-029 |
| 11:9 | D-135 (settled) |
| 11:10 | D-024 |
| 11:11 | D-138 (settled) |
| 11:12 | D-139 (settled) |
| 11:13 | D-010 |
| 11:14 | D-015 |
| 11:15 | D-006 |
| 11:16 | D-071 |
| 11:17 | D-072 |

**12 MA Pullbacks** (13 questions)

| Question | Decision |
|---|---|
| 12:1 | D-021 |
| 12:2 | D-009 |
| 12:3 | D-003 |
| 12:4 | D-008 |
| 12:5 | D-011 |
| 12:6 | D-026 |
| 12:7 | D-002 |
| 12:8 | D-004 |
| 12:9 | D-016 |
| 12:10 | D-012 |
| 12:11 | D-001 |
| 12:12 | D-135 (settled) |
| 12:13 | D-015 |

**13 MA Reclaim** (14 questions)

| Question | Decision |
|---|---|
| 13:1 | D-002 |
| 13:2 | D-073 |
| 13:3 | D-074 |
| 13:4 | D-139 (settled) |
| 13:5 | D-136 (settled) |
| 13:6 | D-008 |
| 13:7 | D-011 |
| 13:8 | D-003 |
| 13:9 | D-022 |
| 13:10 | D-006 |
| 13:11 | D-001 |
| 13:12 | D-023 |
| 13:13 | D-004 |
| 13:14 | D-075 |

**14 EMA Crossback** (16 questions)

| Question | Decision |
|---|---|
| 14:1 | D-002 |
| 14:2 | D-021 |
| 14:3 | D-002 |
| 14:4 | D-003 |
| 14:5 | D-076 |
| 14:6 | D-005 |
| 14:7 | D-026 |
| 14:8 | D-012 |
| 14:9 | D-001 |
| 14:10 | D-010 |
| 14:11 | D-009 |
| 14:12 | D-014 |
| 14:13 | D-135 (settled) |
| 14:14 | D-015 |
| 14:15 | D-006 |
| 14:16 | D-019 |

**15 Wedge Pop** (12 questions)

| Question | Decision |
|---|---|
| 15:1 | D-021 |
| 15:2 | D-077 |
| 15:3 | D-009 |
| 15:4 | D-006 |
| 15:5 | D-003 |
| 15:6 | D-008 |
| 15:7 | D-011 |
| 15:8 | D-018 |
| 15:9 | D-012 |
| 15:10 | D-010 |
| 15:11 | D-015 |
| 15:12 | D-007 |

**16 Wedge Drop** (12 questions)

| Question | Decision |
|---|---|
| 16:1 | D-001 |
| 16:2 | D-040 |
| 16:3 | D-002 |
| 16:4 | D-021 |
| 16:5 | D-078 |
| 16:6 | D-003 |
| 16:7 | D-008 |
| 16:8 | D-006 |
| 16:9 | D-023 |
| 16:10 | D-010 |
| 16:11 | D-007 |
| 16:12 | D-007 |

**17 Holy Grail** (11 questions)

| Question | Decision |
|---|---|
| 17:1 | D-002 |
| 17:2 | D-079 |
| 17:3 | D-003 |
| 17:4 | D-080 |
| 17:5 | D-005 |
| 17:6 | D-013 |
| 17:7 | D-019 |
| 17:8 | D-026 |
| 17:9 | D-001 |
| 17:10 | D-004 |
| 17:11 | D-035 |

**18 Qullamaggie and Kell** (14 questions)

| Question | Decision |
|---|---|
| 18:1 | D-002 |
| 18:2 | D-029 |
| 18:3 | D-005 |
| 18:4 | D-013 |
| 18:5 | D-033 |
| 18:6 | D-021 |
| 18:7 | D-009 |
| 18:8 | D-081 |
| 18:9 | D-135 (settled) |
| 18:10 | D-001 |
| 18:11 | D-013 |
| 18:12 | D-004 |
| 18:13 | D-014 |
| 18:14 | D-137 (settled) |

**19 AVWAP Reclaim** (11 questions)

| Question | Decision |
|---|---|
| 19:1 | D-002 |
| 19:2 | D-082 |
| 19:3 | D-083 |
| 19:4 | D-003 |
| 19:5 | D-008 |
| 19:6 | D-136 (settled) |
| 19:7 | D-006 |
| 19:8 | D-011 |
| 19:9 | D-010 |
| 19:10 | D-001 |
| 19:11 | D-007 |

**20 Episodic Pivot** (14 questions)

| Question | Decision |
|---|---|
| 20:1 | D-002 |
| 20:2 | D-033 |
| 20:3 | D-017 |
| 20:4 | D-005 |
| 20:5 | D-030 |
| 20:6 | D-011 |
| 20:7 | D-020 |
| 20:8 | D-024 |
| 20:9 | D-084 |
| 20:10 | D-141 (settled) |
| 20:11 | D-140 (settled) |
| 20:12 | D-032 |
| 20:13 | D-004 |
| 20:14 | D-010 |

**21 Power Earnings Gap** (15 questions)

| Question | Decision |
|---|---|
| 21:1 | D-002 |
| 21:2 | D-025 |
| 21:3 | D-033 |
| 21:4 | D-006 |
| 21:5 | D-039 |
| 21:6 | D-085 |
| 21:7 | D-017 |
| 21:8 | D-005 |
| 21:9 | D-020 |
| 21:10 | D-011 |
| 21:11 | D-137 (settled) |
| 21:12 | D-024 |
| 21:13 | D-001 |
| 21:14 | D-004 |
| 21:15 | D-007 |

**22 News Gapper** (15 questions)

| Question | Decision |
|---|---|
| 22:1 | D-002 |
| 22:2 | D-033 |
| 22:3 | D-017 |
| 22:4 | D-005 |
| 22:5 | D-022 |
| 22:6 | D-020 |
| 22:7 | D-030 |
| 22:8 | D-011 |
| 22:9 | D-032 |
| 22:10 | D-086 |
| 22:11 | D-002 |
| 22:12 | D-001 |
| 22:13 | D-008 |
| 22:14 | D-004 |
| 22:15 | D-007 |

**23 News Failure** (11 questions)

| Question | Decision |
|---|---|
| 23:1 | D-001 |
| 23:2 | D-002 |
| 23:3 | D-005 |
| 23:4 | D-009 |
| 23:5 | D-087 |
| 23:6 | D-032 |
| 23:7 | D-088 |
| 23:8 | D-018 |
| 23:9 | D-016 |
| 23:10 | D-004 |
| 23:11 | D-015 |

**24 High Volume Edge** (14 questions)

| Question | Decision |
|---|---|
| 24:1 | D-089 |
| 24:2 | D-089 |
| 24:3 | D-017 |
| 24:4 | D-005 |
| 24:5 | D-030 |
| 24:6 | D-009 |
| 24:7 | D-090 |
| 24:8 | D-091 |
| 24:9 | D-092 |
| 24:10 | D-024 |
| 24:11 | D-093 |
| 24:12 | D-016 |
| 24:13 | D-004 |
| 24:14 | D-012 |

**25 Gap Support** (13 questions)

| Question | Decision |
|---|---|
| 25:1 | D-094 |
| 25:2 | D-094 |
| 25:3 | D-003 |
| 25:4 | D-008 |
| 25:5 | D-013 |
| 25:6 | D-009 |
| 25:7 | D-026 |
| 25:8 | D-025 |
| 25:9 | D-001 |
| 25:10 | D-004 |
| 25:11 | D-014 |
| 25:12 | D-095 |
| 25:13 | D-096 |

**26 Kicker** (16 questions)

| Question | Decision |
|---|---|
| 26:1 | D-144 (settled) |
| 26:2 | D-031 |
| 26:3 | D-022 |
| 26:4 | D-097 |
| 26:5 | D-097 |
| 26:6 | D-006 |
| 26:7 | D-144 (settled) |
| 26:8 | D-018 |
| 26:9 | D-020 |
| 26:10 | D-136 (settled) |
| 26:11 | D-026 |
| 26:12 | D-025 |
| 26:13 | D-025 |
| 26:14 | D-001 |
| 26:15 | D-004 |
| 26:16 | D-024 |

**27 Bear Gap** (13 questions)

| Question | Decision |
|---|---|
| 27:1 | D-015 |
| 27:2 | D-001 |
| 27:3 | D-098 |
| 27:4 | D-025 |
| 27:5 | D-009 |
| 27:6 | D-099 |
| 27:7 | D-008 |
| 27:8 | D-013 |
| 27:9 | D-100 |
| 27:10 | D-016 |
| 27:11 | D-001 |
| 27:12 | D-004 |
| 27:13 | D-028 |

**28 2B Reversal** (12 questions)

| Question | Decision |
|---|---|
| 28:1 | D-002 |
| 28:2 | D-101 |
| 28:3 | D-102 |
| 28:4 | D-003 |
| 28:5 | D-011 |
| 28:6 | D-005 |
| 28:7 | D-001 |
| 28:8 | D-006 |
| 28:9 | D-009 |
| 28:10 | D-004 |
| 28:11 | D-007 |
| 28:12 | D-007 |

**29 Undercut and Rally** (14 questions)

| Question | Decision |
|---|---|
| 29:1 | D-002 |
| 29:2 | D-103 |
| 29:3 | D-009 |
| 29:4 | D-011 |
| 29:5 | D-036 |
| 29:6 | D-003 |
| 29:7 | D-013 |
| 29:8 | D-136 (settled) |
| 29:9 | D-017 |
| 29:10 | D-006 |
| 29:11 | D-010 |
| 29:12 | D-015 |
| 29:13 | D-007 |
| 29:14 | D-001 |

**30 Oops Reversal** (14 questions)

| Question | Decision |
|---|---|
| 30:1 | D-003 |
| 30:2 | D-136 (settled) |
| 30:3 | D-030 |
| 30:4 | D-005 |
| 30:5 | D-011 |
| 30:6 | D-020 |
| 30:7 | D-001 |
| 30:8 | D-012 |
| 30:9 | D-019 |
| 30:10 | D-104 |
| 30:11 | D-019 |
| 30:12 | D-004 |
| 30:13 | D-105 |
| 30:14 | D-015 |

**31 Slingshot** (13 questions)

| Question | Decision |
|---|---|
| 31:1 | D-106 |
| 31:2 | D-009 |
| 31:3 | D-003 |
| 31:4 | D-107 |
| 31:5 | D-107 |
| 31:6 | D-005 |
| 31:7 | D-013 |
| 31:8 | D-108 |
| 31:9 | D-001 |
| 31:10 | D-004 |
| 31:11 | D-012 |
| 31:12 | D-016 |
| 31:13 | D-014 |

**32 Remount** (12 questions)

| Question | Decision |
|---|---|
| 32:1 | D-002 |
| 32:2 | D-073 |
| 32:3 | D-074 |
| 32:4 | D-003 |
| 32:5 | D-008 |
| 32:6 | D-011 |
| 32:7 | D-022 |
| 32:8 | D-006 |
| 32:9 | D-004 |
| 32:10 | D-001 |
| 32:11 | D-004 |
| 32:12 | D-016 |

**33 Failed H&S / Rounded Top** (13 questions)

| Question | Decision |
|---|---|
| 33:1 | D-001 |
| 33:2 | D-109 |
| 33:3 | D-003 |
| 33:4 | D-008 |
| 33:5 | D-002 |
| 33:6 | D-011 |
| 33:7 | D-022 |
| 33:8 | D-018 |
| 33:9 | D-110 |
| 33:10 | D-010 |
| 33:11 | D-004 |
| 33:12 | D-007 |
| 33:13 | D-016 |

**34 Capitulation** (13 questions)

| Question | Decision |
|---|---|
| 34:1 | D-002 |
| 34:2 | D-111 |
| 34:3 | D-003 |
| 34:4 | D-008 |
| 34:5 | D-013 |
| 34:6 | D-019 |
| 34:7 | D-023 |
| 34:8 | D-041 |
| 34:9 | D-004 |
| 34:10 | D-014 |
| 34:11 | D-028 |
| 34:12 | D-015 |
| 34:13 | D-007 |

**35 Wyckoff Spring / Upthrust** (11 questions)

| Question | Decision |
|---|---|
| 35:1 | D-002 |
| 35:2 | D-112 |
| 35:3 | D-003 |
| 35:4 | D-022 |
| 35:5 | D-005 |
| 35:6 | D-113 |
| 35:7 | D-006 |
| 35:8 | D-001 |
| 35:9 | D-004 |
| 35:10 | D-009 |
| 35:11 | D-009 |

**36 Mean Reversion** (15 questions)

| Question | Decision |
|---|---|
| 36:1 | D-002 |
| 36:2 | D-016 |
| 36:3 | D-009 |
| 36:4 | D-013 |
| 36:5 | D-019 |
| 36:6 | D-114 |
| 36:7 | D-003 |
| 36:8 | D-005 |
| 36:9 | D-009 |
| 36:10 | D-006 |
| 36:11 | D-023 |
| 36:12 | D-014 |
| 36:13 | D-004 |
| 36:14 | D-010 |
| 36:15 | D-011 |

**37 Wick Play** (14 questions)

| Question | Decision |
|---|---|
| 37:1 | D-115 |
| 37:2 | D-003 |
| 37:3 | D-008 |
| 37:4 | D-116 |
| 37:5 | D-116 |
| 37:6 | D-006 |
| 37:7 | D-012 |
| 37:8 | D-017 |
| 37:9 | D-016 |
| 37:10 | D-001 |
| 37:11 | D-010 |
| 37:12 | D-034 |
| 37:13 | D-007 |
| 37:14 | D-117 |

**38 Parabolic Long** (13 questions)

| Question | Decision |
|---|---|
| 38:1 | D-002 |
| 38:2 | D-003 |
| 38:3 | D-135 (settled) |
| 38:4 | D-013 |
| 38:5 | D-019 |
| 38:6 | D-023 |
| 38:7 | D-018 |
| 38:8 | D-118 |
| 38:9 | D-009 |
| 38:10 | D-014 |
| 38:11 | D-041 |
| 38:12 | D-032 |
| 38:13 | D-119 |

**39 Parabolic Short** (15 questions)

| Question | Decision |
|---|---|
| 39:1 | D-120 |
| 39:2 | D-035 |
| 39:3 | D-013 |
| 39:4 | D-040 |
| 39:5 | D-005 |
| 39:6 | D-013 |
| 39:7 | D-135 (settled) |
| 39:8 | D-121 |
| 39:9 | D-018 |
| 39:10 | D-023 |
| 39:11 | D-122 |
| 39:12 | D-142 (settled) |
| 39:13 | D-004 |
| 39:14 | D-028 |
| 39:15 | D-007 |

**40 Opening Range Breakout** (13 questions)

| Question | Decision |
|---|---|
| 40:1 | D-031 |
| 40:2 | D-143 (settled) |
| 40:3 | D-002 |
| 40:4 | D-038 |
| 40:5 | D-005 |
| 40:6 | D-006 |
| 40:7 | D-123 |
| 40:8 | D-124 |
| 40:9 | D-017 |
| 40:10 | D-001 |
| 40:11 | D-142 (settled) |
| 40:12 | D-010 |
| 40:13 | D-016 |

**41 30-Minute Pivot** (11 questions)

| Question | Decision |
|---|---|
| 41:1 | D-002 |
| 41:2 | D-008 |
| 41:3 | D-125 |
| 41:4 | D-126 |
| 41:5 | D-127 |
| 41:6 | D-003 |
| 41:7 | D-002 |
| 41:8 | D-002 |
| 41:9 | D-006 |
| 41:10 | D-001 |
| 41:11 | D-015 |

**42 Go Signal** (15 questions)

| Question | Decision |
|---|---|
| 42:1 | D-128 |
| 42:2 | D-145 (settled) |
| 42:3 | D-031 |
| 42:4 | D-129 |
| 42:5 | D-003 |
| 42:6 | D-005 |
| 42:7 | D-130 |
| 42:8 | D-131 |
| 42:9 | D-132 |
| 42:10 | D-014 |
| 42:11 | D-009 |
| 42:12 | D-011 |
| 42:13 | D-001 |
| 42:14 | D-018 |
| 42:15 | D-007 |

**43 Red to Green** (13 questions)

| Question | Decision |
|---|---|
| 43:1 | D-002 |
| 43:2 | D-145 (settled) |
| 43:3 | D-133 |
| 43:4 | D-003 |
| 43:5 | D-008 |
| 43:6 | D-136 (settled) |
| 43:7 | D-143 (settled) |
| 43:8 | D-001 |
| 43:9 | D-035 |
| 43:10 | D-028 |
| 43:11 | D-034 |
| 43:12 | D-010 |
| 43:13 | D-007 |

**44 Opening Drive** (10 questions)

| Question | Decision |
|---|---|
| 44:1 | D-002 |
| 44:2 | D-002 |
| 44:3 | D-031 |
| 44:4 | D-134 |
| 44:5 | D-006 |
| 44:6 | D-136 (settled) |
| 44:7 | D-005 |
| 44:8 | D-010 |
| 44:9 | D-001 |
| 44:10 | D-014 |


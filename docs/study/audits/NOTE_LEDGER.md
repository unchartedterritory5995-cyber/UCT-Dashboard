# Study: every owner note, and where it stands

The owner, 2026-11-08: *"I hope you implemented all the enhancements and adjustments that i recomeneded for each spot"*
and *"Make sure all improvements and adjustments meet 99/100 quality on every single spot for each page and graphic and
production, for each question and each thing"*.

This is the checklist. Every design note he has written (119, from `owner_verdicts.jsonl`, passes `workbench`,
`workbench-part`, `workbench-ruling` and `chat-ruling`) is listed by its number (N001 to N119, in the order they were
written; `docs/study/audits/2026-10-24/owner_verdicts.jsonl` holds every word verbatim). Each line says what he asked,
whether it is done, and where. A line is **Done** only when it is in the code and was looked at on a real screen; it is
**Partly** when the main ask is in but a named part is not; **Not yet** when nothing has been built; **Your call** when
it waits on a decision only he can make.

His score is the only score. "Done" here means built and checked, not that it has reached his 99/100: that is what his
ranks on each batch say, and every batch's ranks are added to this ledger the day they arrive.

Last checked: 2026-11-08 (late), branch `feat/study-focus-status`. Nothing is left Partly or Not yet; what remains waits on his ranks or approvals.

## 1. The chart

| Notes | What he asked | Status | Where |
|---|---|---|---|
| N001, N002, N007, N067, N082, N090 | The member's own UCT chart widget, with his settings and our logo, not a generic chart; no recreated chart or dead timeframe bar | Done | `challenges/ChallengeChart.jsx` (look `widget`), `DrillPlayer.jsx` (`paneLookProps`, `showBrandMark`); rail: `principles.test.js` rule 1 |
| N007 | 1 to 2 candles of room at the right edge | Done | `rightPadBars` phone 3 / desktop 2; rail: rule 2 |
| N023, N045 | The chart a bit bigger, sized better | Done | `heroChart`, 480 to 520 px on desktop in every mode |
| N089 | Do not ask with the indicators blanked | Done | the toggles are gone |
| N029 | Show the ticker on the lesson's question card ("the widget stays exactly as on the Charts page, identity row and watermark visible before answering") | Done 2026-11-08 (his "Yes") | a lesson set carries each chart's `ticker` (`_set_payload` `ticker`; `/today` and `lesson: true` sets); the lesson chart shows the widget's identity row and watermark; the challenges never carry it (Hard mode stays "no ticker"); test in `test_study_router.py` |
| N112 | "better graphics" on the chart | Built 2026-11-08, waiting on his rank | since his batch-24 "Okay": the gold targeting brackets round every chart (the arena), the key under it, the replay framed close and widening, its clock, its questions, and the trade as bar markers at their own bars |

## 2. The pointer (the arrow and its label)

| Notes | What he asked | Status | Where |
|---|---|---|---|
| N001, N004, N023, N031, N062, N068, N083, N094, N111 | An arrow logically spaced, pointing at the candle; labels further away, never on candles; a much higher quality pill and arrow | Done | `ui/callout.js` (one pointer, kit v2 bolder ring and leader); in every mode since 2026-11-08 |
| N068 | "highlighting the user and detailing the question much more" | Done 2026-11-08 | the question header carries the detail, and the pointer now asks it at the candle: "What fired here?" in Hard mode, "Kicker here?" (the setup asked about) in Boss and the lesson player |
| N040 | Spot game: candles that can be picked should show it (highlighted, slightly animated) | Done 2026-11-08 | gold rings and lettered pills on every candidate, arriving with one soft fade and lift (`ChartCalloutOverlay` `look.fadeIn`), never a pulse |

## 3. The question

| Notes | What he asked | Status | Where |
|---|---|---|---|
| N068, N091 | Never "the firm"; we are UCT | Done | `brandWords` at every door the bank's text comes through; rails: rule 11 |
| N008 | Questions must not lead | Drafts waiting on his approval | every approved question checked 2026-11-08 for the classic tells: 19 where the right choice is far longer than the rest (often carrying its own reason) have drafts that make every choice the same short form, the reasoning left in the lesson (`docs/study/audits/2026-11-08/leading_questions.json`, workbench spot "leading_q"); one of them also had a second right answer among the wrong ones (the Launchpad stop). The questions' own words never change (an item's id is made from them) |
| N101, N113 | A more detailed question; better question text and type | Done | the question header (eyebrow tag, headline, detail line) in every mode, 2026-11-08 |

## 4. The answers, Check and Next

| Notes | What he asked | Status | Where |
|---|---|---|---|
| N069, N073, N084, N114 | Answer cards much cooler, on brand, a real production | Done | `ui/Tile.jsx` + `kit2.module.css` (key cap, running gold border, right and wrong states) |
| N032 | The check mark and the answer as more of a production | Done | tile states + the stamp |
| N038, N049, N070, N085 | Start, Check and Next significantly better | Done | `ui/StudyButton.jsx` (struck-gold) everywhere, Start included since 2026-11-08; rail: rule 17 |

## 5. After the answer

| Notes | What he asked | Status | Where |
|---|---|---|---|
| N071 | The answer takes over the entire screen, like a pop-up | Done 2026-11-08 (his "Yes") | `ui/VerdictTakeover.jsx` in the lesson player, Hard mode, Boss and Spot the Setup: the screen dims, a slow burst of light in the verdict's colour, the stamp, the verdict, the answer and XP, confetti on a right answer; one button opens the review and the replay starts then. Blitz keeps its instant flash (thirty answers a minute) |
| N074, N086, N115 | The verdict and stamp cooler, higher quality | Done | `ui/Prompt.jsx` verdict band, `ui/Stamp.jsx`, 2026-11-08 |
| N095 | Never a wrong example ("NOTHING FIRED" on an AAPL Oops Reversal) | Done | `api/services/study_hard.py` sweeps every chart with the setup detectors before it can play |

## 6. Teaching (the lesson and the trade)

| Notes | What he asked | Status | Where |
|---|---|---|---|
| N009, N013, N024, N028, N032 | The Kicker trade on his rules: entry a cent over the red day's high on the Kicker day, or the day-1 30-minute ORB; stop under the Kicker low or 3.5% | Done | `api/services/study_trade.py`, `docs/study/TRADE_PLANS.md` |
| N003 | Entry, sizing and entry tactics in the explanation | Done | entry, stop, targets and trail for every setup; the key shows the risk from the entry to the stop as a percent (the number a member sizes from) |
| N103 | Entry, stop, trim, trail and the advance, not a table of numbers; review and explain the trade | Done | `ui/TradeReview.jsx` in the lesson card; `ui/ChartKey.jsx` under the chart |
| N116, N117 | The chart lists the levels and the action items and explains them; on-screen explanations of levels | Done | `ui/ChartKey.jsx`, `challenges/tradeMarks.js`: Hard, Boss, Spot the Setup and the lesson player (whose chart now also carries Hard mode's pointer) |
| N013, N087, N096, N116, N118 | Lessons simpler and easier to read, more direct, as a teacher; a better-looking text box | Drafts waiting on his approval | the lesson card (takeaway, trade tiles, on this chart, the setup as numbered steps); each setup's definition in plain words, three steps and a "not it" line (`studyPlainRules.js`, lab piece 72), shown in lessons once he approves each |
| N065 | No bar count; % off the highs and % from the averages as a table | Done | "The read on this chart" in the lesson player |
| N033 | Pause in the replay and ask about trimming, trailing, sell rules; no scrolling to reach the buttons | Done 2026-11-08 | the replay holds at 2R ("What does the plan do here?") and at 3R ("What happens to the stop on what is left?"), answered only from the plan's own words (`study_trade.replay_checks`; no fraction is invented, TRADE_PLANS.md), in a card right under the chart (`ui/ReplayPause.jsx`); not scored; Hard mode, Spot the Setup, Boss, Draw it |

## 7. The replay (the run-on)

| Notes | What he asked | Status | Where |
|---|---|---|---|
| N092 | Run on to the full culmination of the move, not 5 to 10 days | Done | `hardMode.culmination`, `useRunOnTo` |
| N044 | Show the next candles a bit slower | Done | `RUN_ON_MS` slow mode |
| N061 | No switch between a labelled and a bare chart; pick one | Done | rule 18 |
| N010, N014, N019, N025 | Start closer, teach as it plays, tick by tick within each day (30-minute or hourly), faster between the key days, no flashing, no bouncing text | Built 2026-11-08; live once the server fill runs | each forward day grows through its real 30-minute closes (`useRunOnTicks`, `challenges/replayTicks.js`), every close on the key days (the first two, the targets, the stop, the best price), at most four between; a steady clock on the chart ("DAY 3 · 11:30 AM", `ui/ReplayClock.jsx`); the replay opens 40 sessions wide and widens with the run (`replayView`, the chart's anchor frame); Hard mode, Spot the Setup, Boss and Draw it. The bars: fetched once on the server and kept only for days that add up to the daily candle (`api/services/study_intraday.py`, `scripts/study/fill_replay_intraday.py`); checked on a real screen with the real hourly bars the server fetched for the Go Signal build (3,785 days, none off the daily candle). Charts before Sept 2003 keep the daily replay |
| N072, N102 | Better replay graphics and animation | Done 2026-11-08 | the replay grows each day through its 30-minute closes with a clock, opens close and widens; the action items are the chart's own bar markers (BOUGHT arrow, 2R and 3R dots, STOPPED), at their bar, never over a candle or under the price scale (`tradeMarks.tradeMarkers`) |

## 8. Status line and progress

| Notes | What he asked | Status | Where |
|---|---|---|---|
| N006, N066, N079, N100, N105 | An animated journey bar our logo fills, the best of the four status lines, much higher quality | Done | `ui/HudLooks.jsx` `HudCombo` (and `HudClock` for Blitz), every mode |

## 9. Start and end screens

| Notes | What he asked | Status | Where |
|---|---|---|---|
| N036 | Less space before the Start button | Done | the start arena fits one screen |
| N076, N088, N093, N099, N110 | The start screen dramatically improved (68/100 at last rank) | Done 2026-11-08, waiting on his rank | `ui/StartLooks.jsx` `StartArena` rebuilt (the widget in miniature with the pointer, the title, stat chips, the shared button) |
| N011, N015, N016, N020, N026, N034, N075, N104, N119 | End screen cleaner, cooler, on brand, the boxes much better (B- at last rank) | Rebuilt 2026-11-08, waiting on his rank | `ui/EndLooks.jsx` `EndHard` in every mode: the coin on a lit pedestal under a spotlight, the stats as metal-rimmed crests with icons, the run as cards |

## 10. The logo

| Notes | What he asked | Status | Where |
|---|---|---|---|
| N036, N041, N048, N058, N064 | Our 3D logo, spinning and moving, in place of the cartoon; smoother shape and motion | Done | `components/study/StudyMark` (three.js), decided 2026-11-03 |

## 11. The games

| Notes | What he asked | Status | Where |
|---|---|---|---|
| N036 | Each game begins with a tutorial | Done | `ui/HowItPlays.jsx` on every game's start screen, above Start: three steps, open by itself on a member's first visit, one tap away after |
| N042 | Blitz needs hundreds of examples, never the same three | Done | about 100 questions a run (a run answers about 30), a fresh draw from the bank every run (`fetchNamedPool` seed, `fetchSpotPool` 8 a setup, `fetchRecallPool` 16 a skill) |
| N047 | Blitz: both question kinds and more quick-recognition kinds | Done | five kinds |
| (found 2026-11-08) | Never a wrong example: Blitz asked "What setup fired on the last candle?" on bank charts that can be "No, it does not fire" charts | Done | "name it" now uses only charts the detectors verify (`POST /api/study/spot-setup`, the Spot the Setup pool); test in `challengeBank.test.js` |
| N037, N043 | Boss graphics improved | Done | Boss on Hard mode's design, 2026-11-08 |
| N050, N051, N055, N056, N059, N060 | Bugs: Boss stuck, taps that do nothing, Face the Boss dead, no charts in the sandbox | Done | fixed in their rounds; every mode played start to end by the capture rig on 2026-11-08 |
| N063, N106 | Trap becomes Spot the Kicker, then Spot the Setup | Done | `challenges/SpotSetupChallenge.jsx` |
| N039, N045, N052, N057 | Draw-it: the drawing tool lands where it is put; show the entry as a line and explain; easier stop placement; no throbbing gold | Built 2026-11-08, waiting on his rank | `challenges/DrawItChallenge.jsx` + `POST /api/study/draw/score`: tap the entry then the stop (dashed lines, a chip to move either), scored against the setup's own plan; the review draws the plan beside yours with the chart key; no glow on the chart |
| N017 | The loop more fun, exciting and interactive | Partly | the shared kit, the reward system (levels, trophies), the replay's questions; his ranks decide the rest |

## 12. Study home, the course path and rewards

| Notes | What he asked | Status | Where |
|---|---|---|---|
| N021, N022, N027, N030, N035 | The home and the course path like Duolingo, our brand, 3x the production, progressing sensibly | Built 2026-11-08, waiting on his rank | `StudyLanding.jsx`: the player hero (level in 3D gold, tier, XP to go, streak and XP crests, today's one button), the Method's stations as coins on a winding gold road with the logo on the current one, Foundations as a coin grid, the games as plated cards, the trophy shelf; `SkillTrail` (a station's page): lessons as coins zigzagging down the page |
| N035 | A much better reward system and scoring | Built 2026-11-08, waiting on his rank | levels with tiers on the home, the daily goal ring, the week, trophies actually granted by the server (award_badge had never been called), the trophy shelf with locked goals, the level bar and "Level up" on every end screen, new-trophy coins on the lesson's end |

## 12b. The look as a whole

| Notes | What he asked | Status | Where |
|---|---|---|---|
| (2026-11-08) | "This still needs significant graphic improvements imo. Use some creativity for Christ sake!" | Built, waiting on his rank | THE ARENA: a stage behind every Study screen (a gold stage light, a faint skyline of giant candles, a lit floor grid drifting toward the member; `DrillPlayer.module.css`), gold targeting brackets on every chart, the start screen's drawing as a tilted lit display with a spotlight on the candle, a struck 3D gold title, metal-rimmed crests with icons for the stakes (`ui/startLooks.module.css`, `ui/study.module.css`) |

## 13. Rulings that are standing rules

| Notes | Ruling | Status |
|---|---|---|
| N097 | Do not fire the failed events | Done (bank v2) |
| N098 | Examples under the liquidity rule only if they are great visuals | Done (bank v2) |
| N107 | The trade rules and the Go Signal come from the app, not from him | Done (`TRADE_PLANS.md`) |
| N108, N109 | One design, uniform in every section | Done (rule 21) |
| N081 | "High Volume Edge example on CRBU" | No action: a note on the example shown (CRBU is kept in pass 3) |

## 14. His rulings on questions and examples (the bank)

About 300 more rows in the same file are his rulings on individual questions and chart examples (bank passes 1 to 4,
the fixtures, the scanner, the Go Signal hourly and the Bear gap sets). Checked against the bank files 2026-11-08
(`scripts/study/check_rulings.py`, his latest ruling on each item standing; the rail `tests/test_study_rulings_rail.py`
keeps it so): all 153 keeps are still in the bank; 90 cuts were still drafts in the bank on no retire list (73 setup
examples, 7 fixtures, 7 Bear gaps, 3 Go Signal hourly), now listed in `docs/study/audits/2026-11-08/retire_ruled_cuts.json`.
The live half is one dry run on the pod after the merge
(`scripts/study/retire_ids.py docs/study/audits/2026-11-08/retire_ruled_cuts.json --dry-run`): it writes nothing and
names any of the 90 that is not a draft. A cut that is APPROVED there would be shown to members as a good example, so
that list goes to him before the real run.

## The open list, in the order it will be built

1. Done 2026-11-08: the chart key and Hard mode's pointer in the lesson player (N116, N117); the risk to the stop in
   the key (N003); Blitz drawing a fresh, deeper pool every run and naming only verified setups (N042).
2. Done 2026-11-08 on his "Yes and Yes": the ticker on the lesson card (N029) and the full-screen answer (N071).
4. Done 2026-11-08: Spot the Setup's candidates brought in with one soft fade (N040).
5. Done 2026-11-08: the Study home and the course path (N021, N022, N027, N030), the station page.
6. Done 2026-11-08: a short tutorial at the start of each game (N036).
7. Done 2026-11-08: the reward system (N035).
8. Done 2026-11-08: Draw it in the product (N039, N045, N052, N057).
9. Drafted 2026-11-08: the setups in plain words, waiting on his approval (N087, N096, N116, N118).
10. Built 2026-11-08: the replay within the day (N010, N014, N019, N025); the server fill runs after the merge.
11. Done 2026-11-08: the replay stops and asks at 2R and 3R (N033); the pointer asks the question at the candle (N068);
    the trade's action items as bar markers (N072, N102).
12. Drafted 2026-11-08: 19 questions that lead, waiting on his approval (N008).
13. Checked 2026-11-08: the bank against all his question and example rulings (section 14); 90 cuts to retire on the pod.

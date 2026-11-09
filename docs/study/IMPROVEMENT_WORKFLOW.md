# Study: the workflow for improving everything

The owner, 2026-11-08: *"We have so much work to do to enhance games, questions, app development, teaching, graphics,
production, everything!"* and *"lets keep going and develop the further plans to build a workflow for improving all of
the things i have in my objective."*

This is that workflow. The standard every screen is held to is `docs/study/OWNER_PRINCIPLES.md` (21 rules from his
notes). The loop below is how each round gets built, checked, ranked and shipped. The tracks after it are what the rounds
work through.

## 1. One round, start to finish

1. **Plan the batch (10 to 20 spots).** Pick from the tracks below, biggest gaps first: anything he ranked Cut or Weak,
   then anything that breaks a rule. One round covers the whole course, not one screen (his ruling, 2026-11-07).
2. **Fix at the kit, not the screen.** A change goes into the shared piece (`app/src/pages/study/ui/`: the button, the
   tile, the status line, the lesson card, the coin, the start and end frames), so every screen gets it. A one-off fix is
   allowed only when nothing can be shared.
3. **Pre-flight, before he sees anything:**
   * the **principles rails** (`app/src/pages/study/principles.test.js`) check the rules a machine can check: no
     "the firm" on screen, no hand-rolled buttons, every chart the member's own widget, 1 to 2 candles of room on the right;
   * **every spot on a real screen**, desktop and phone, captured by the rig (`local_study/capture_r*.py`) and looked at
     before it goes out; anything ugly, cramped or broken is fixed first;
   * **correctness**: every example swept by the setup detectors (`api/services/study_hard.py`), every number read off
     the bars, never a sentence that is not true of the chart;
   * the full Study test suite green (vitest `src/pages/study`, pytest `tests/test_study_*`).
4. **He ranks the batch** in the workbench (`127.0.0.1:8793`): every spot 1 to 5, pins on the pictures, words. His ranks
   reach the session as he works; Save marks the batch done.
5. **The same day:** every note goes verbatim into `docs/study/audits/2026-10-24/owner_verdicts.jsonl` and is pushed; a
   note that applies beyond its spot updates `OWNER_PRINCIPLES.md`; every note is fixed everywhere it applies, and that
   fix list is the next batch.
6. **Ship** when a round has no Cut and he says ship: one PR per round, tested locally first (Actions is billed), he
   merges, the web service deploys, members get it. Bank changes ship with `import_bank.py` (and a redeploy from source
   when the merge touches only docs or scripts).

## 2. The tracks (his objective, one by one)

### Games
* **Now:** Hard mode (round 22), Blitz, Boss, Spot the Setup (every setup, from round 23), the daily drill.
* **Next:**
  * a short tutorial at the start of each mode (rule 12);
  * a real reward system: XP, streaks, tiers, coins that mean something across runs (rule 14);
  * replays that teach, tick by tick, slower on the days that matter (rule 5);
  * Blitz drawing from hundreds of charts, never the same three (rule 7).
* **Then:** new games built on the same kit (draw the entry, name the stage of the cycle, place the stop), each tested
  before it reaches him.

### Questions (the bank)
* **Now:** about 740 approved items and more than 9,000 drafts across the setups, candles, chart words, the cycle, bases,
  levels and lines.
* **Next:**
  * questions that ask without leading, with the detail to know where to look (rule 10);
  * examples a trader would want, liquid and orderly (rule 7);
  * the review queue cleared in batches he can do in a sitting;
  * "the firm" taken out of the bank's own text at the source. It is already hidden on screen.

### Teaching
* **Now:** the lesson leads with a one-line takeaway; the trade on the Kicker's rules; numbers in gold; the chart marks
  BOUGHT and STOPPED OUT.
* **Done 2026-11-08:** every setup's entry, stop, trims (2R, 3R) and trail come from the app's own detectors, the Kicker
  on his rulings (`docs/study/TRADE_PLANS.md`, `api/services/study_trade.py`); the lesson reviews the trade against what
  followed, and the chart marks BOUGHT, 2R, 3R and STOPPED OUT.
* **Next, not waiting:**
  * the chart explains itself, with levels, action items and why, at every reveal in every mode, not only Hard (rule 3);
  * simpler lesson text where the bank allows (rule 9).

### Graphics and production
* **Now:** kit v2 (the struck-gold button, the answer tile, the combined status line, the coin, the start and end frame)
  runs in the lesson player, the drills, Blitz, Boss, Spot the Setup and Hard.
* **Next:**
  * the screens kit v2 has not reached: the course path (SkillTrail), the Study home (StudyLanding), the practise
    sheet, the reveal takeover's frame, the tap, size and walkthrough drills;
  * our animated 3D logo wherever a mascot stands (rule 16);
  * calm, purposeful motion (rule 18).

### App development
* **Now:** 240 Study tests, the workbench with draft mirroring, capture rigs for every mode.
* **Next:**
  * phone layouts checked on every round (desktop and phone pictures for every spot);
  * the bugs list from his notes kept at zero (rule 19);
  * load time on the challenges (they fetch charts one setup at a time today).

### Scale
* **Now:** bank v2 (deep history since 1995, liquid names, every chart checked against the website's own bars and Yahoo).
* **Next:**
  * hundreds of examples per setup and per game;
  * new setups and patterns as he names them;
  * the levels and the Go Signal once he rules on them.

## 3. What only he can give (the blockers)

* Nothing on the rules any more: the trade plans and the Go Signal are in the app (`docs/study/TRADE_PLANS.md`); he
  corrects any he would trade differently.
* Whether a chart where two setups fire counts for both.
* His ranks on each batch, and "ship" when a round is ready for members.

## 4. The cadence

| Round | Batch | Focus |
|---|---|---|
| 22 | 24 | Hard mode rebuilt (ranked: 3 Cut, 14 Weak, 10 Okay) |
| 23 | 25 | The whole course on his principles: kit v2 everywhere, Spot the Setup for every setup |
| 24 | 26 | His batch-25 notes fixed everywhere, plus the screens kit v2 has not reached (course path, Study home, the rest of the drills) |
| 25 | 27 | Teaching: the chart explains itself in every mode; tutorials; tick-by-tick replays |
| 26 | 28 | Games: the reward system, Blitz at scale, a new game on the kit |

Each round ends in a batch he ranks. A round ships when it has no Cut and he says ship.

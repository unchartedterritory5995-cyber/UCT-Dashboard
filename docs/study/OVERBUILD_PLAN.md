# Study overbuild plan

Written 2026-11-11 for the owner. **Version 2 (same day): the owner said "analyze the full deep plan, improve it, then let's go for it", so v2 carries the improvements and Phase 0 starts now.**

What the owner asked for, in his words: *4 answers instead of 3 for every question; each question researched deeply
to give the most proper answer as well as the simplest; then review it all, everything; overbuild and take it to an
extreme in variety, scope, intelligence, teaching, scale, complexity, depth, examples and everything; after the whole
review, improve the system toward what fits him best, then scale back into the final version after deep testing.*

His answers when asked: **only the 1,443 three-answer questions get a 4th answer** (True/False, type-a-number and
fill-in-the-word stay in their own shapes), and **plan it completely first, then power through it all**.

---

## v2: what the analysis changed (and why)

I checked the plan against the real code and data. Fourteen changes, the first five matter most:

1. **Questions keep their ids.** A question's id is a hash of its source reference and its question text
   (`scripts/study/_common.py`). Adding a 4th choice, a simple answer or a better explanation does **not** change the id.
   Rewording the question text does. So the rule is: *do not reword a question unless it is wrong or ambiguous*, and every
   reworded one is written to a lineage map (old id to new id) so his verdicts, progress and feedback follow it.
2. **One field fewer.** The existing `why` **is** the proper answer; it is rewritten in place. New fields are only
   `simple`, `deeper`, `tier`, `batch` (and the owner-only `research` pointer). No parallel `proper` field, no migration
   of 5,296 explanations.
3. **Build on the engine that exists.** The Study engine already has mastery (age-weighted, difficulty-weighted), a due-date
   review ladder, difficulty bands (rungs 1-3 / 4-6 / 7-9) that lean each member to their level, a reveal card that already
   renders a six-part lesson, and a member feedback door on every reveal. The plan no longer rebuilds spaced repetition or
   mastery. New "intelligence" is limited to what is missing: **misconception tagging, a placement pre-test, and depth
   unlock by tier.** The reveal gets **Simple** as its first line; the rest of the card is unchanged.
4. **Research per fact, not per question.** Many questions share one fact (the lesson's fact list). Researching each of
   5,296 questions separately would re-fetch the same pages thousands of times. The Researcher now works **per lesson,
   per fact** (verify against the current page, find the disagreement, list the real misconceptions) and the Writer
   works per question from that sheet. Same depth, far less cost.
5. **Risk routing.** Not every question needs the full five roles. Each gets a **risk score** (single source, a number or
   date that changes, a rule from the owner's rulebook, a held decision, a long answer, a recent edit). **High risk** gets
   the full pipeline individually. **Low risk** (a stable definition with two or more Tier 1 or agreeing Tier 2 sources)
   gets the Writer plus a batched cold check and red team. Effort goes where mistakes are likely.
6. **Red team works per lesson as well as per question.** One agent reads a whole lesson and attacks every question, which
   also catches cross-question tells, duplicates and two questions that answer each other. High-risk questions
   additionally get an individual attack.
7. **Prove the checkers can fail.** Before any scale-up, seed the pilot with **30 known defects** (a wrong key, a second
   right answer, a longest-answer tell, an outdated number, a simple answer that overreaches). The pipeline must catch at
   least 90%; if not, the briefs are fixed first. (This is the repo's own rule: a test that has never been seen failing
   proves nothing.)
8. **His review time is the scarce resource.** 5,296 questions today and perhaps 10,000+ after the overbuild cannot all be
   read one by one. v2 adds a **review design** (section 7): a risk-sorted queue, a random-sample acceptance rule per
   lesson, a "machine-approved" tier for items that pass everything and are sampled instead of read, a daily review budget,
   and a **blind old-versus-new comparison** in the pilot.
9. **Agents never touch the repo.** Each agent writes only to its own scratch folder; the integrator (me) is the only
   writer of course files. This is how the earlier runs avoided conflicts and it stays.
10. **Decision-dependent items are tracked.** Questions that rest on a provisional default (the 134 open Part 3
    decisions, the held items) are tagged with the decision id. When he rules, the affected questions are found and re-keyed
    automatically instead of by memory.
11. **Stop conditions and numeric scale-back rules** are written down (sections 5 and 8), so we do not drift.
12. **Sources that block agents** are expected (some publishers bar them). The Researcher records "unreachable", the
    fact falls back to a second source or becomes a `conflicts` note, and it is never filled from memory.
13. **Reading level** is measured with a purpose-built check (sentence length, word length, a list of defined terms and
    unexplained jargon), not Flesch scores, which misread trading text.
14. **Overbuild economics:** generate roughly **twice** what we expect to keep, run every item through the same checks, then
    select. This is what makes the final scale-back a choice among good items rather than a rescue.

Scope guard: this plan changes the **course library** (131 lessons, hidden from members until he approves). It does not
touch the live candle items, the live challenge pools or any member's progress.

---

## 0. The shape of it in one page

| Phase | What happens | Output | Gate (he decides) |
|---|---|---|---|
| **0. Foundations** | New question format, stricter validator, the app shows a simple answer and a proper answer, review page shows both | Code + tests, no content change | Looks right on his screen |
| **1. Pilot, 3 lessons** | The full upgrade on 3 lessons of different kinds | Real numbers: quality, defects, cost, time | He reviews the 3 lessons and approves or changes the method |
| **2. Upgrade waves** | Every one of the 5,296 questions deeply researched, simple + proper answer, the 1,443 get a 4th answer | The whole library upgraded | He samples each wave in the review page |
| **3. Overbuild** | Variety, scope, examples, depth, intelligence, scale, all added next to the core, tagged by tier | An "everything" version | He reviews it all |
| **4. The big review** | He goes through everything; we mine his feedback for patterns and rewrite the standards | New standards, a fixed system | He says what fits |
| **5. Test and scale back** | Deep testing, then cut to the final version | The member-facing version | He signs off |

Rules that hold for every phase:
1. **Additive, never destructive.** New content lands beside the current content (tagged by tier and batch). The current
   library stays in git. Scaling back later is a filter, not a rebuild.
2. **Hidden from members until he approves.** Same gate as today.
3. **The accuracy rule does not loosen.** Every key traces to a quoted source (course README section 3). Overbuild
   means more material at the same standard, not a lower standard.
4. **His rulings win.** The account rulebook (sizing_rule.md section 9), his verdicts, and the Part 3 decisions in the
   review page override any writer's idea. Anything a writer could not source goes to the owner list, not into a lesson.
5. **The repo is public.** No private material: no Discord exports, no unpublished Substack, no account size, no member
   data. Quotes stay at 40 words or fewer.
6. **Nothing ships on a green test alone.** Every phase ends with a real-screen look (desktop and phone) and he sees it.

---

## 1. What "researched deeply" means for one question

Today a question has a key, a one-paragraph `why`, wrong-answer notes, and 1 to 5 cited quotes. The upgrade puts
**every question through five roles**, each a separate agent so no one grades their own work.

| Role | Job | Must produce |
|---|---|---|
| **Researcher** (once per lesson, per fact) | Re-open the sources. Find the strongest, most current statement of each fact. Look for a second source that disagrees. Find the common misconceptions people actually hold about it (these become the wrong answers). | A fact sheet: quotes, URLs, access dates, any disagreement, 3 to 5 real misconceptions per fact |
| **Writer** | Turn the fact sheet into the question. | The 4 answers, the **simple answer**, the **proper answer**, a note on each wrong answer |
| **Cold checker** | Never saw the writer's reasoning. Re-derives the right answer from the sources alone. | pass / fix / cut with a reason |
| **Red team** (per lesson, plus per question for high risk) | Tries to break it: a second defensible answer, ambiguity, a trick wording, an answer that depends on date or market, a tell that gives the answer away, two questions that answer each other. | A list of attacks; every one answered or the question is fixed or cut |
| **Integrator (me)** | Runs the validator, recomputes numbers, fits it to his rulings, applies it, keeps the lineage. | The file change plus the log |

### Risk routing (who gets the full treatment)

Every question gets a risk score from 0 to 10 before any agent runs. Points for: one source only; a number, date or rule
that changes over time; a rule from his rulebook or a held decision; a numeric or calculated key; an answer longer than
60 characters; edited in the last two runs; touched by a seeded or earlier defect. **Score 4 or more = high risk:** the
full five roles, individually. **Under 4:** Writer, batched cold check, per-lesson red team. The pilot measures whether
the cheap path misses anything the full path catches; if it does, the threshold drops.

### The two answers, defined

- **Simple answer.** One sentence, plain words, a beginner can follow it with no jargon. Target 25 words or fewer,
  reading level about grade 8 (checked by a script). It says *what the answer is and the one reason*.
- **Proper answer.** The full, precise answer a professional would sign: the exact rule or number, the conditions, the
  exceptions, what it does not mean, the source. This is the existing `why` field, rewritten in place to be complete. No
  hedging words where the source is firm, and the hedge stated plainly where the source is not. The simple answer may
  never claim anything the proper answer does not.
- **Go deeper (optional, for Extended and Expert tiers).** A worked example, a counter-example, a chart, or "what
  traders get wrong here".

### One question, before and after (a real one, F1.06 q16)

**Now** (3 answers)
> A stock went public about six months ago. Its insiders signed a 180-day lockup, and it ends next week. What should
> you watch for as that date gets close?
> A) A guaranteed drop in price  B) Fewer shares in the float  C) **More shares free to sell**
> Why: More shares able to hit the market. When the lockup ends, insiders can start selling...

**After**
> Same story and question.
> A) A guaranteed drop in price  B) Fewer shares in the float  C) **More shares free to sell**  D) The company being forced to buy back stock
> **Simple:** When the lockup ends, insiders are allowed to sell, so more shares can hit the market.
> **Proper:** A lockup agreement bars insiders (employees, early holders, large shareholders) from selling for a set
> period after an IPO, commonly 180 days. When it expires those shares can be sold, which adds supply to the float and
> can weigh on the price. The SEC notes the price may fall ahead of the date; nothing makes it certain.
> Wrong answers: A) nothing guarantees a drop, the SEC says *may*. B) it is the reverse, locked shares *join* the float.
> D) no rule forces a buyback at lockup expiry; a buyback is the company's own choice.
> Sources: SEC Investor.gov, Initial Public Offerings: Lockup Agreements (quote on file), plus one more publisher.

---

## 2. The 4th answer (the 1,443)

Applies to the 370 multiple-choice and 1,073 scenario questions that have three choices. The other 1,856 choice
questions already have four. True/False (1,108), type-a-number (613) and fill-in-the-word (276) keep their shape.

**Rules for the new wrong answer** (the validator and the red team both enforce them):
1. It is a **real misconception**, taken from the researcher's list or a cited source, not a filler. "A plausible wrong
   idea someone actually holds" beats "a silly option".
2. It is wrong for a **different reason** than the other wrong answers (no two distractors fail the same way).
3. It is **not obviously wrong by tone or length.** Within about 25% of the key's length, same grammar, same register.
   The existing "no longest-answer tell" audit stays on.
4. It has its own **one-line explanation** in `wrong` that cites the fact it fails against.
5. **Exactly one answer is right.** The red team's first job is to find a second defensible answer; if it can, the
   question is rewritten or cut.
6. No "all of the above", "none of the above", "both A and B" (already banned).
7. The right answer's slot stays balanced across the unit (existing `choice_orders` dealing).

Because adding a choice changes a question's text, **every one of the 1,443 is cold re-checked**, not just edited.

---

## 3. Phase 0: foundations (code, no content)

**Schema v2** (all fields additive and optional until a question is upgraded):
- `simple` (string, 25 words or fewer). **`why` stays and becomes the proper answer** (rewritten in place).
- `deeper` (optional object: `example`, `counter`, `chart`, `trap`)
- `tier`: `core` | `extended` | `expert`
- `batch`: which run produced it (so scale-back can filter by batch)
- `risk`: the 0 to 10 score and the reasons (owner-only)
- `depends_on`: decision ids (D-nnn) the question rests on, so a ruling finds its questions
- `misconceptions`: the researcher's list per question (owner-only, never shown)
- `research`: a pointer to the saved per-lesson fact sheet under `docs/study/research/` (owner-only)
- `lineage`: the previous text, and the old id when the question text had to change (`docs/study/library/lineage.json`
  already exists for drift; the old-to-new id map is added there)

**Validator** (`scripts/study/courses_lib.py`):
- an upgraded mcq/scenario must have exactly 4 choices and a `wrong` entry for each wrong one
- `simple` length and reading-level check; `why` must contain the key's number or term when the key is a number
- `simple` and `why` must not contradict the key (checked by the cold checker, flagged by a keyword diff)
- id stability: a question whose text changed must appear in the lineage map
- distractor checks (length band, duplicates, banned phrases, same-failure-mode flag for the red team)
- recompute `calc` as today

**Importer and bank** (`api/services/study_import.py`, `gen_courses.py`): carry `simple`, `deeper` and `tier` through to
`reveal_json` (`simple` joins `REVEAL_PROSE_KEYS`, so the voice and grounding checks apply to it); old questions keep
working unchanged. **Games check:** every game that reads course items (Word Match tiles, True/False, History Detective,
Spot the Mistake and the rest) is run against upgraded items so a 4th choice or a long answer cannot break a tile.

**App** (`app/src/pages/study/RevealCard.jsx` and `revealCardHelpers.js`): the reveal shows **Simple** first (one line,
big), a **"Full answer"** disclosure for the proper answer (the card's existing "Why" disclosure), then "Why the others
are wrong", then sources. The six-part lesson and the member feedback door stay as they are. Games keep using the simple answer on small tiles.
Mobile checked at 390 px. A `?tier=` filter and a per-member depth setting come later (Phase 3).

**Review page** (`tools/study_review`): shows both answers side by side, the 4th answer tagged "new", the research
sheet one click away, the red-team log, new reason tags ("Simple answer is not simple", "Proper answer is missing a
condition", "Fourth answer too obvious"). `read_feedback.py` learns the new tags.

**Tests**: validator unit tests (each new rule proven able to fail), importer round-trip, vitest for the reveal,
audit report extended (counts of upgraded questions, reading level, distractor stats).

---

## 4. Phase 1: the pilot (3 lessons)

Pick three that stress different things:
- **SET.07 Flat Base Breakout** (71 questions): a setup with rules, numbers, examples and the owner's criteria.
- **F9.02 sizing math** (numeric-heavy, recomputed answers): proves the proper answer on calculations.
- **F6.x an options concept lesson**: heavy on official sources and on definitions that change over time.

Run the full five-role pipeline on all three. Measure and report:
- tokens and minutes per question, per role (so the full run has a real price instead of a guess)
- % of questions changed, fixed, cut; defects the red team found that the old checker missed
- reading level of the simple answers; distractor quality (a sample he rates)
- what the researcher found that the old sources missed (new facts, disagreements)

**Seeded-defect proof:** 30 known defects are planted in the pilot (wrong key, second right answer, length tell, outdated
number, overreaching simple answer, cut-and-paste explanation) and the pipeline must catch at least 90%.
**Blind comparison:** old versus new, he picks the better one.

**Gate:** he reviews the three lessons in the review page. He says what to change in the method. We fix the briefs
before any scale-up. This is the cheapest place to be wrong.

---

## 5. Phase 2: the upgrade waves

All 5,296 questions through the pipeline (the 43 setup lessons hold 2,850 of them). Order and size (questions):

| Wave | Tracks | Questions | Why this order |
|---|---|---|---|
| 1 | F1, F5, F7, F10, F10b | ~660 | Foundations, official sources, fewest dependencies on his rulings |
| 2 | F6, V | ~1,160 | Options and vocabulary: definition-heavy, most stable |
| 3 | F8, F9, F11, F12 | ~620 | Psychology, risk, styles, process: touches his rulebook, so cross-checked against it |
| 4 | SET.07 to SET.27 (21 setup lessons) | ~1,410 | Setup lessons, first half |
| 5 | SET.28 to SET.54 (22 setup lessons) | ~1,440 | Setup lessons, second half, uses the decisions he made in Part 3 |

Each wave = a Workflow run: per unit, researcher then writer then checker then red team, with a track auditor at the end
(cross-unit contradictions and duplicates, as before). Waves are sized to fit inside about one usage window and are
**resumable** (finished agents replay from cache, the way the earlier runs were). After each wave: integrator applies,
validator, audit, tests, review-page data rebuilt, and he samples it.

**Stop conditions (a wave pauses and comes to me and him):** more than 5% of questions fail the answer-key attack; the
seeded-defect catch rate drops below 90%; more than 15% of a lesson is cut; his sample of a finished wave shows 3 or
more defects in 10; or the projected cost of the next wave is more than 25% over the estimate.

**Checkpoints inside a wave:** a unit is applied only when the red team's list is empty or answered. A unit with more
than 15% cuts stops the wave and comes to me.

---

## 6. Phase 3: the overbuild (variety, scope, intelligence, depth)

Everything here is **extra, tagged by tier, and cut or kept at the end.** Each idea lists what it costs.

### 6.1 Depth (more per skill)
- **Three tiers per skill.** Core (what every member needs), Extended (the why and the edges), Expert (judgment, traps,
  edge cases, the numbers behind the rule). Target per skill: 8 core, 8 extended, 6 expert questions.
- **Go-deeper layer on the reveal**: a worked example, a counter-example, and "what traders get wrong".
- **Source depth.** For every rule we teach as ours, the originator's words, the competing view, and the owner's own
  version side by side (the setup dossiers already hold this).

### 6.2 Variety (more ways to learn the same thing)
Using what the app plays today (no new engine): multiple choice, scenario, true/false, fill-in-the-word, type-a-number,
chart-based questions, the 14 games. New formats to build (each is app work):
- **Order the steps** (entry, stop, trim, trail, advance), **match the rule to the setup**, **spot the mistake in this
  trade plan** (extend the existing game), **grade this setup A+/A/B/B-** against real charts, **place the stop** on a
  chart (tap the price), **size the trade** from a story, **what changed since last week** (regime reads), **read the
  chart cold** (no ticker, name the setup), **earnings reaction replay**.
- **Parametrised generators** for every calculation: the same idea with endless fresh numbers, answers recomputed.
- **Mirror questions**: the same fact asked four ways (definition, scenario, number, mistake), so memory is tested, not
  wording.

### 6.3 Examples (more real cases)
- **10 real chart examples per setup** (44 setups = 440), with entry, stop, what happened, and the owner's verdict. The
  dossier example work already scans our bar database; it resumes here.
- **Counter-examples**: look-alikes that fail the rule, each with the one thing that disqualifies it.
- **Worked trades**: the full plan (entry, stop, size, trims, trail) on a real chart, step by step.
- **Dated market cases** with the real chart under them (History Detective), regime by regime.

### 6.4 Scope (more topics)
Candidate new tracks, each a proposal he picks from (nothing built until he says):
- Market regime (the Green/Yellow/Orange/Red reading, breadth, how it changes sizing)
- Earnings (the reaction, the gap, holding through, the 3-day rule)
- Sector and theme leadership; relative strength (the RS indicators)
- Journaling and the weekly review; reading your own statistics (win rate, R, expectancy)
- Options for swing traders; hedging with them; leveraged ETFs (his rulings: preferred, no extra rules)
- Shorts and parabolic shorts (below the 200-day, his rule)
- Using every tool in the dashboard (Screener, Model Book, Charts, Morning Wire) as a short guided lesson each
- Trading psychology drills tied to his own rules (the monthly 8% limit, the drawdown ladder)

### 6.5 Intelligence (smarter teaching, with no runtime AI, as already decided)
- **Already built, so reused, not rebuilt:** mastery per skill (age- and difficulty-weighted), the due-date review ladder,
  difficulty bands that lean each member to their level, and the member feedback door. This phase tunes and extends them.
- **Misconception tracking**: each wrong answer is tagged with *which misconception* it was; a member who keeps picking
  one gets a targeted mini-lesson on that misconception, not a generic retry.
- **Adaptive depth**: Core first; Extended and Expert unlock on mastery; a "challenge me" switch.
- **Placement**: a short pre-test that skips what a member already knows.
- **Pattern feedback for the owner**: which questions members miss, which wrong answers attract them, which setups are
  under-learned (for the dashboard, not shown to members).

### 6.6 Teaching quality
- A **mentor walk-through** (2 to 4 sentences, unscored) before every unit and a one-line "why this matters" on each
  lesson, in the owner's own voice (his published words and his rulings, never invented).
- **Concept map** per track and a **glossary link** on every term.
- **Reading level** held at about grade 8 for simple answers; the proper answer may be as technical as the topic.

### 6.7 Scale and complexity
- Target per skill as above; overall the library roughly **doubles to triples** in this phase (an upper bound, not a
  promise; cut at the end).
- **Multi-step cases** (a trade from idea to exit in 8 linked questions), **portfolio cases** (heat, correlation,
  the 200% book), **scenario trees** (what you do if it gaps, if it stalls, if the market flips).
- **Capstones** per track and an **exam mode** (timed, mixed, no hints).

**Phase 3 is run in the same waves as Phase 2**, one capability at a time, each shown to him before the next.

---

## 7. Phase 4: the big review (his part, with the page we built)

### How his review stays possible at this scale

Reading every question of an "everything" library is not realistic and not the best use of his judgment. So:
- **Risk-sorted queue.** The page shows the highest-risk and the most-changed questions first.
- **Sample acceptance per lesson.** He reviews a random sample of **10 questions per lesson** (the page picks them).
  If all 10 are good, the rest of the lesson is **machine-approved** (it passed the validator, the cold checker and the
  red team) and is only re-sampled later. One defect in the 10 widens the sample to 25; three defects send the lesson
  back to the pipeline with his notes.
- **Review budget.** He sets a daily number (for example 150). The page stops there and shows what is left.
- **Blind old-versus-new comparison** in the pilot: the page shows the old and the upgraded version of a question
  in random order and he picks the better one. This is the cleanest evidence for whether the upgrade is worth its cost.
- **Everything he flags still goes through the existing feedback loop** (tags, rule feedback, decisions, lesson notes).

- He goes through it all in the review page: Part 1 (what Claude changed), Part 2 (every question), Part 3 (the
  decisions behind the rules), plus rule feedback, lesson notes and general notes. The page records every verdict with
  reason tags.
- **Order that saves him time:** pilot lessons first, then a random 5% sample of each wave, then the lessons he cares
  most about, then the rest. Questions he approved in a sample are not re-asked.
- **Then we mine it.** `read_feedback.py` plus the tag tally show patterns ("answers too easy" in F6, "simple answer
  not simple" in SET). I turn each pattern into a **standard** (added to `docs/study/LIBRARY.md`), then re-run only the
  affected units, so the system improves and not just the items.
- **Retrospective report** at the end: what fit, what did not, in his words.

---

## 8. Phase 5: deep testing, then scale back

**Testing, all required before anything is member-facing:**
1. **Content:** validator, strict library audit, source re-fetch (every quote still on its page), `calc` recomputation,
   cross-unit contradiction scan, duplicate scan, reading-level scan, a second full cold re-read of a random 10%.
2. **Answer-key attack:** an independent red-team pass over every question that is going to ship.
3. **Code:** the Study pytest and vitest suites, the importer, the reveal, every game, the review tools.
4. **Real screens:** desktop and phone, light and dark, slow connection, every question type and every game.
5. **Behaviour:** a full member journey on a test account (placement, lessons, mastery, repeat, exam), a pod-copy import
   dress rehearsal, and a rollback drill.
6. **Pool health:** every game has enough distinct items; no pool drains.

**Scale back, with numbers (his choices, our tools):**
- Keep an item only if: it passed every automated check, it is not a duplicate of a stronger item, **and** it was either
  in his sample and good, or machine-approved in a lesson whose sample passed. Anything he marked Change or Remove and was
  not fixed is out.
- Per skill, keep the best 6 to 10 core, 4 to 8 extended and 3 to 6 expert items, ranked by his verdicts, then risk score,
  then variety (no format over 40% of a skill).
- Per track, a lesson stays only if it teaches something no other lesson teaches.
- Filter by tier, batch and his verdicts. Keep what he marked good, cut what he marked weak.
- Keep depth where it teaches and drop it where it only adds length.
- Final target is set by him once he has seen the "everything" version: a size per skill, a number of lessons per track.
- The cut material stays in git (a branch and a tag), so nothing is lost and a later expansion is easy.

---

## 9. Cost, time and resuming (estimates; the pilot replaces them with measurements)

- Earlier measurements: the 3-lesson pilot of the original build cost about 1.5M subagent tokens; the full original
  content run (86 units) cost roughly 40M tokens and took about two days across usage limits.
- **Phase 2 (upgrade every question)** is heavier per question than the original writing (research, red team, 4th
  answer): estimate **50 to 80M tokens**, about **5 to 8 usage windows**.
- **Phase 3 (overbuild)** is open-ended. I will cap it **per capability** (for example "10 examples per setup") and show
  the price of each before running it.
- Runs are **resumable** (same script and run id, finished agents replay from cache). A usage limit pauses the run; it
  does not lose work. State is written to `docs/study/OVERBUILD_STATE.md` after every wave so any new window can resume.
- **Model use:** helper agents for research and writing; the cold checker and the red team on the strongest model
  available, since they are the accuracy rail.
- **You can pause or cut a wave at any gate.** Nothing downstream is wasted if a phase stops.

---

## 10. Risks and what stops them

| Risk | Stop |
|---|---|
| A confidently wrong answer key | Cold checker plus red team on every question; one Tier 1 or two agreeing Tier 2 sources; his review |
| A second defensible answer | Red team's first job; validator rejects "all of the above"; ambiguous wording is cut |
| Simple answer is simplistic or wrong | The cold checker reads the simple answer against the proper one; script checks length and level; his tag "not simple" feeds back |
| Stale facts (rules that change) | `as_of` dates; official pages re-fetched; the source re-fetch test |
| Writers drift from his rules | Every wave cross-checked against `sizing_rule.md` section 9 and the Part 3 decisions; conflicts go to him |
| Source terms (some publishers bar AI use; Bulkowski asks not to train AI) | Those sources stay out; the 28 held criteria stay held; his decision on the F5 sourcing policy is still open |
| Public repo leaks | Hygiene check before every push; no private text in any file; quotes short |
| Usage limits stall a run | Resumable runs, waves sized to a window, state file |
| Overbuild bloat | Everything tagged by tier and batch; cutting is a filter; the final size is his call |
| App regressions | Additive fields only, old questions unchanged, tests plus real-screen checks each phase |

---

## 11. Decisions that are his (with my default if he says "your call")

1. **The pilot lessons:** SET.07, F9.02 and an options lesson. *Default: as written.*
2. **Which new tracks** from section 6.4 to build first. *Default: market regime, earnings, and the guided tool lessons.*
3. **Which new formats** from section 6.2 to build first. *Default: spot-the-mistake extended, place-the-stop, size-the-trade.*
4. **Depth targets** per skill (8 / 8 / 6). *Default: as written.*
5. **The held items** from the earlier work: the F5 sourcing policy and his open Part 3 decisions. *Default: unchanged until he rules.*

---

## 12. Order of work once he says go

0. **Right now:** the plan (this file) is final for v2. Phase 0 starts immediately; the pilot starts the moment Phase 0 is green.
1. Phase 0: schema, validator, importer, reveal UI, review page (one working session, tests green, he sees it on screen).
2. Phase 1: the pilot, then the report with real numbers and the three lessons in the review page.
3. His gate. Fix the briefs.
4. Phases 2 and 3 in waves, each wave ending with a sample he can review.
5. Phase 4: the big review and the standards rewrite.
6. Phase 5: deep testing and the scale-back, then the owner's sign-off.

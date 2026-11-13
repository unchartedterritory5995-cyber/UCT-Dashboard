# Study library: the standards, the variety rules and how it grows

Owner, 2026-11-10: *"solidify all the rules and format and variety for games and questions. Ultimately I want an
evergrowing library of questions as we experience new data and information that fits within, so we can establish a very
robust library based on history and forward. Ultimately I want to take each one one by one."*

This page is the one place that says what a good question, a good unit and a good game look like, how we measure it,
and how new material enters. The file contract for a unit is `docs/study/courses/README.md`; the build contract for a
game is `docs/study/GAMES.md`; the owner's screen rules are `docs/study/OWNER_PRINCIPLES.md`. This page adds the variety
rules, which a machine checks, and the growth lanes.

Measure it: `python -m scripts.study.library_audit` (the report), `--strict` (exit 1 on any flag), `--json`.

## 1. What the library holds

| part | where | what it is | who writes it |
|---|---|---|---|
| Course units | `docs/study/courses/<track>/<unit>.json` | Hand-authored questions with sources, a walk-through and a cold check. Tracks F1 to F12, V (vocabulary) and SET (one unit per setup card). | a writer, then a second reader |
| Chart and event banks | `docs/study/bank/chart.*`, `cycle.*`, `spot.*`, `candles.*` | Generated from our own price bars by the `scripts/study/gen_*` scripts, swept by the setup detectors. | a script, then the owner's review |
| Recall banks | `docs/study/bank/recall.*`, `size.*`, `vocab.*` | Short items from the house rulebook, glossary and playbooks. | a script from the source documents |
| Games | `app/src/pages/study/challenges/` | Built from the Study kit; fed by the banks above or computed by tested code. | built to `GAMES.md` |

The built course bank (`docs/study/bank/course.*.json`) is never edited by hand. It is rebuilt from the unit files by
`python -m scripts.study.gen_courses`. Fix a question in its unit file, then rebuild.

## 2. A good question (the rules a reader checks)

1. **True and sourced.** Every fact traces to a verbatim quote or to our own rulebook; every number in a
   `why`, lesson or wrong-answer note appears in a cited quote, the story or the calc. (Contract, README §3.)
2. **One thing tested, no tell.** The right answer must not be findable without knowing the subject. The tells we
   measure are in section 3.
3. **Teaches on a miss.** The `why` leads with the verdict, then the reason, in the voice of `VOICE.md`. Every wrong
   choice has a note saying why it is wrong.
4. **Ours, not theirs, when it is a house rule.** A question about a house rule says so and cites the rulebook id. A
   pending-owner number is never keyed (it goes in the unit's `conflicts` with its decision id).
5. **Tied to a criterion.** A setup question carries the `criterion` id of the one rule it tests, so coverage can be counted.

## 3. Variety: the rules the audit enforces

Each rule is a threshold in `scripts/study/library_audit.py`. Change the number here and there together.

| rule | threshold | why |
|---|---|---|
| Format mix | at least 20% scenario, at least 15% true/false, choice questions (multiple choice plus scenario) at most 75% | a unit that is all multiple choice trains one skill |
| Difficulty | each of Learn, Practise and Prove holds at least a fifth of a unit | a learner needs a ramp and a ceiling |
| Where the right answer sits | no slot above 45% or below 8% of a unit's choice answers | a streak of one slot is a tell. **Dealt by the builder, not the author** (see below) |
| The longest choice | the right choice is the single longest in at most 40% of choice questions (chance is about 25%) | picking the longest wins otherwise |
| True/false balance | between 35% and 65% of a unit's true/false answers are True | always answering True wins otherwise |
| Absolute words | "always", "never", "only" may not mark the false statements far more than the true | the same tell, one level down |
| Stem repetition | no three-word opening starts more than 10% of a unit's questions (and not fewer than four) | variety of ask. A unit built to repeat one ask (Spot the Mistake) says so with `"variety_exempt": ["stems"]` |
| Banned choices | no "all of the above", "none of the above" or "both A and B" | they test test-taking |
| Coverage | every settled or proposed criterion on a card has at least one live question | the card is the spec; a criterion without a question is untaught |

**Where the right answer sits.** Writers put the right answer first (the README's example does). The bank builder
(`courses_lib.choice_orders`) deals it to a slot: the questions with the same number of choices take slots A to D in
shuffled blocks, in file order, so a unit is balanced and a run of one slot is never longer than two. The order is
stable: appending a question never moves an earlier one, and a question the checker cut keeps its place. A question
whose choices have a real order (a ladder, a sequence) opts out with `"order": "fixed"`; choices that are all one kind
of number are shown lowest to highest.

## 4. Formats and where each plays

| format (unit file) | plays as | feeds |
|---|---|---|
| `mcq`, `scenario` | multiple choice, with a story for a scenario | the course player, Blitz, Boss, Mistake |
| `tf` | true or false | True or False |
| `fill` | tap a word into the blank | the course player |
| `numeric` | type the number (checked against a recomputed calc) | the course player, Size It's rules |
| vocabulary (`term` + short meaning) | word and meaning | Word Match |
| a card's `question_seeds` of kind recall, scenario, numeric | become unit questions | course units |
| a card's seeds of kind spot, discriminate, grade | need a chart or a graded example, so they feed the chart games, not the text units | Spot the Setup, Weekend Watchlist, Hard mode, Draw it |

A new game or format enters the table here first, with the data it reads and the skill it teaches.

## 5. Games: the variety rules

1. Every game is built to `GAMES.md` §1 (one design, never wrong, teach on every miss, deterministic).
2. A game's pool is deep enough that a member does not meet the same item twice within a week of daily play. A game
   with a thin pool says so in `GAMES.md` and is filled before it is promoted.
3. A game never repeats one ask: a run mixes the kinds its pool offers (Blitz is the model).
4. The same item can feed more than one game, but each game states which formats it takes, so a new item lands in the
   right places without a code change.

## 6. How the library grows

Nothing is added by hand-waving. Every addition enters through one of five lanes, and each lane ends at the same
gate: the checker, the audit, then the owner.

| lane | trigger | what we do | command |
|---|---|---|---|
| New ruling | the owner answers a decision in `DECISIONS.md` or a review | list the units that rest on it, re-key them, record the ruling verbatim in `owner_verdicts.jsonl` | `library_audit --decision D-nnn` |
| Card change | a criteria card gains, loses or changes a criterion | the units written from it show as drifted; revise them, then stamp | `library_audit --drift`, then `--stamp` |
| New data | new earnings quarters, a market event, new bars | regenerate the chart and event banks; add the new quarter or event as a candidate; sweep it with the detectors | the `scripts/study/gen_*` scripts, then `import_bank.py` |
| New setup or source | a new setup, a better source for an old fact | research dossier, then card, then unit (the criteria programme, `CRITERIA_PROGRAMME.md`) | `scripts/study/criteria_lib.py`, `gen_courses` |
| Member signal | a wrong answer rate, a note from the quiz or Discord | ingest, review, fix at the source | `feedback_loop.md`, `ingest_feedback.py` |

`docs/study/library/lineage.json` records which version of its card each unit was written from. It is the library's
memory of what is stale. Run `--stamp` when a unit is written or re-checked against its card, never to silence a drift.

**Life of an item:** draft (in a unit file) → checked (`verify` pass) → built into the bank as draft → owner approves →
live on the pod. A live item is changed by a new version, never silently; one the owner cuts is retired
(`retire_ids.py`) and its id never reused.

## 7. Taking it one by one

The owner reviews item by item. The loop for one unit:

1. Run `library_audit` and read that unit's flags and uncovered criteria first, so the review spends time on judgment,
   not on mechanics.
2. Open the unit's review page (one page per unit, questions in order, each with its source quote and verdict control).
3. Each verdict (keep, fix, cut, a note) goes verbatim into `docs/study/audits/2026-10-24/owner_verdicts.jsonl` the
   same day, with the item id.
4. Fixes go into the unit file, never the bank; rebuild; run the audit and the tests; push once the unit is clean.
5. A ruling that applies beyond the item updates the card, `DECISIONS.md` or `OWNER_PRINCIPLES.md`, and the other
   units it touches are found with `--decision` or `--drift`.

## 8. Definition of done

* **A question:** true and sourced, no tell, a reason for every wrong choice, tied to a criterion, voice rules clean.
* **A unit:** passes `unit_problems`, has no audit flag, has a question for every settled or proposed criterion on its
  card (or says why not), a second reader's `verify` on every question, and is stamped.
* **The library:** `library_audit --strict` exits 0, the Study tests are green, `tools/check_repo_hygiene.py` is clean.

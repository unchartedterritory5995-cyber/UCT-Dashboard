# Study overbuild: final report

Finished 2026-11-12. Every lesson in the Study library is upgraded and verified. Everything is committed locally on
`feat/study-content` and **nothing is pushed**. Nothing is member-facing until you approve it.

## What you asked for, and what is done

| You asked for | Status |
|---|---|
| 4 answers instead of 3 | **Done.** 0 choice questions have 3 answers (it was 1,443). 3,233 choice questions now have 4. True/False, number and fill-in stayed in their own shape, as you chose. |
| Each question researched deeply, with the most proper answer and the simplest | **Done.** All **5,232** live questions (after the polish pass) now have a one-line plain answer, and a rewritten full answer. 2,095 have a "go deeper" note (example, the other side, or the common trap). |
| Review it all, everything | Every question went through independent agents: writer, cold checker, red team (risky questions), resolver, a fresh re-check, then a **separate verification round** on every question the re-check changed. |
| Overbuild, then scale back after your review | Every question carries a tier (core 2,492 / extended 1,867 / expert 856) and a risk score, so scaling back later is a filter. |

## How it was checked

- **Safety test:** 30 known mistakes were planted before the run started; the checkers caught **30 of 30**.
- **Verification rounds:** after each wave, a fresh agent re-checked every question the last round touched. Across all rounds
  they found **no wrong answer keys** in the end. What they kept catching was quality: one answer giving away another
  question's answer, a "tell" (the right answer is the longest, or the lone Yes), a claim no source supports, a number with
  no source.
- **Gates passed at the end:** the validator (0 problems across 131 lessons), the strict library audit, 237 tests, the repo
  hygiene check. The right answer is now spread evenly: A 25%, B 25%, C 25%, D 24% (it was 87 to 100% in slot A once).
- **Usage limit:** the weekly limit hit once. Three lessons that lost their check at that moment were held and re-run from
  scratch, and the run was fixed so that can never slip through again.

## Size and cost

- 131 lessons, 9 waves plus the pilot, roughly 1,000 helper agents, about **200 million tokens** in total
  (risk-routed, as you approved; about 38k tokens per question).
- 5,296 live questions went in; 5,215 came out (duplicates and unfixable ones cut, a few new ones added to fill real gaps).

## What needs you

1. **Your review.** Open the review page (http://127.0.0.1:8794/, or the Desktop shortcut "Start Library Review"). Because
   every question changed, use **Part 4, the sample review**: 10 random questions per lesson, riskiest first. All 10 good
   approves the lesson; one bad widens it to 25; three send it back. The **lesson status board** in the menu shows where you
   are, and you can set a daily budget.
2. **Your rulings.** The agents raised questions only you can answer instead of guessing. The big ones:
   - B22: are "3 days before a report" calendar days or trading days?
   - Gap rule: is the new stop exactly the first 30-minute low, or a few cents under it?
   - Several setup cards use numbers that are only proposals (flat-base first or second base, the 3% first week,
     the 1.5 ATR chase cap, the 50-day as a gate or a grade cue).
   - 569 questions rest on a decision you have not ruled on yet (the 134 open decisions in Part 3 of the review page).
     Each is tagged, so when you rule, the affected questions can be found and re-keyed.
3. **Merge.** When you are happy, merge PR #1046 (I can push the branch when you say so).

## Polish pass (done 2026-11-12, after the main run)

- **Style flags: 0 of 131 lessons** (was 8). Stems no longer repeat the same opener, and true/false answers are balanced.
- **Lost setup criteria:** new questions restored most of the 27 that duplicate cuts had removed. A few the checkers
  refused to cover, for good reasons (for example the flat-base "three taps = A+" question was cut because grading A+/A/B
  is your call by your rulebook, and it gave away another question's answer).
- **Source quotes:** the library-wide re-check found 9 quotes that did not match their source word for word; all 9 fixed.
  Every polished lesson re-checks with 0 missing quotes.
- **Answer-length give-away fixed.** Before your review I found the right answer was the longest choice only 2% of the
  time, so "never pick the longest" would have beaten the quiz. Two writer + checker passes (pass 2 only trims wrong
  answers) plus my own checks for odd-one-out wording: the right answer now sits shortest/2nd/3rd/longest
  825/821/815/786 times. No answer key changed.
- **Still uncovered on purpose: 39 criteria on 15 setup cards**, mostly short-side rules (bear gap, short ORB, parabolic
  short), numbers you hold, and rules waiting on your ruling. These need your call before anyone writes questions on them.
- Library now: **5,232 live questions**, all with a plain one-line answer, 0 with three answers, answer slots A25/B25/C25/D24.

## Where everything lives

- Resume guide: `docs/study/OVERBUILD_RESUME.md` (and `_study-resume\overbuild\RESUME.md`).
- Every agent's output is backed up in `_study-resume\overbuild\waves\`.
- Plan: `docs/study/OVERBUILD_PLAN.md`.

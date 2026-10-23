# Audit A: recall.bible, recall.concepts, recall.glossary

Date: 2026-10-21. Read-only audit of every non-approved item in three bank segments of the
study-import worktree. Per-item verdicts: `auditA_verdicts.jsonl` (same folder), one line per item.
Builder and validator: `auditA_build.py` (same folder).

**In scope: 108 items, all `draft`** (bible 32, concepts 22, glossary 54). The JSONL has 108 lines,
one per in-scope id, none missing, none repeated.

## Counts

| Segment | keep | fix | cut | total |
|---|---|---|---|---|
| recall.bible | 0 | 19 | 13 | 32 |
| recall.concepts | 0 | 5 | 17 | 22 |
| recall.glossary | 0 | 52 | 2 | 54 |
| **all** | **0** | **76** | **32** | **108** |

Codes: bible: duplicate 13, other (giveaway format) 10, thin_lesson 8, ambiguous 1 ·
concepts: duplicate 13, long_choices 5, trivia 2, unsupported_lesson 2 ·
glossary: unsupported_key 24, thin_lesson 17, ambiguous 6, framing_term 2, model_jargon 2, voice 2, other 1.

**No item is a plain keep.** Every one of the 108 lessons is a one-line source sentence or a bare
formula. That fails the owner's standing rule of 2026-10-19 (every lesson answers the follow-up
questions). Every fix carries a full lesson.

## What I checked

- Every key was matched against the source file, not the item's own quote field:
  `uct-intelligence/prompts/01_methodology_bible.txt` lines 22-45, `conceptVocabulary.json`, and the
  brief's glossary. All verbatim keys exist in their sources.
- Where the cited source disagrees with another firm source, I opened that source and quote it in
  `source_line` / `reveal_json.support`. The sources used: the Morning Wire engine
  (`calculate_exposure` and the phase logic), the Setup Library catalog and playbooks, `sizing_rule.md`,
  the owner's corrections, the screener's `filters.py` and `methodology.py`, the uct-intelligence
  scanner and `05_market_health.txt`, and the owner's own Sunday Scans sentences in
  `morning-wire/data/voice/voice_exemplars.json`.
- Every proposed q, choice, quote and lesson was run through the importer's own checks
  (`api/services/study_import.py` `voice_check` and `grounding_check`). Result: 0 problems, no
  "tape / regime / dial / the loop", and every sentence I wrote is 22 words or fewer. Owner quotes are
  kept verbatim.

## Main patterns

1. **The bible's "Which line is one of O'Neil's 23 rules" format is a giveaway (23 items).** The three
   distractors are always playbook named mistakes ("Chasing...", "Buying...", "Ignoring..."). The key is
   the only line written as a rule, so a member can answer without knowing O'Neil. The distractors also
   come from the playbook prose the owner put on HOLD on 2026-10-18. That pool includes the
   "high-of-day break" and "before a candle holds the 20-EMA" lines, both things he says he trades. The
   stem is the same on all 23 items, and the choices run 50-119 characters.
   - 9 are cut because the rule's own fill-in already tests its content.
   - 4 are cut as restatements of another rule: 11 and 22 repeat rule 3, 18 repeats rule 2, 20 repeats rule 6.
   - 10 are rewritten without inventing anything. Six become a cloze: the rule's own second half is the
     key, and the second halves of other O'Neil rules are the distractors (all under 40 characters).
     Four become fill-ins on the rule's key phrase.
2. **Bible rule 13 contradicts its own source.** It says "determines 75% of a stock's outcome", but the
   same file's CANSLIM M section says "3 out of 4 stocks follow the general market". I re-keyed it to the
   M sentence.
3. **The concepts quiz screener code, not trading.** The choices are raw expressions such as
   `rs_rank >= 80 && pct_vs_ema20 >= -3 && ...` (up to 117 characters).
   - 12 of the 22 terms are already taught on real charts in `vocab.chart`, built from the same
     formulas. They are cut as duplicates, and `duplicate_of` names the vocab.chart item.
   - Oversold and overbought are cut. The source gives only the number, so no lesson can say what the
     desk does with such a stock. For a desk that buys strength, that gap could teach the opposite of the
     method.
   - Large cap and mega cap are cut as preset trivia.
   - The 5 that remain get plain-English choices and full lessons from the vocabulary notes and the
     screener's methodology: leader, leaders pulling back, tight base, liquid and closing strong.
4. **The glossary is the AI-written brief, and the firm's own sources contradict many of its keys.**
   - **Exposure Rating:** "computed from breadth...". The engine's calibration v2 (2026-08-21) says
     breadth no longer moves the score, and the score IS the recommended exposure %.
   - **Distribution day:** "4-6 ... end of an uptrend". The bible says 5-6, and the wire says 4-5 means
     Uptrend Under Pressure and 6+ means Correction.
   - **Launchpad:** the brief gives 9>20>50>200. The playbook uses 8/21/30/50 bunched after a correction.
   - **PEG:** the brief's definition is actually the catalog's Gap Support setup.
   - **Wedge Drop:** the brief says "descending coil". The playbook describes a rising wedge.
   - **Heat:** "capped at 10%" conflicts with the owner's 2026-10-19 ruling: the 10% is a guardrail,
     "you decide".
   - **EP trail:** the brief's "10/20-day" conflicts with the playbook's 9-EMA.
   - **HVC:** the owner writes "HVC (High Volume Close)", while the brief says "High Volume Edge (HVC)".
   - **Course-only inventions that are not in the product:** the five-number scorecard, the Winners
     Gallery, Compass "pre-grading the capstone plan", the "eight-question Stage-2 gate" and "pilot size".

   Compass is cut. The other 25 terms are re-keyed to the firm's own wording, with owner example
   sentences wherever he has used the word.
5. **Near-identical definitions.** U&R, Remount, 2B/Oops and Kicker all read as "a trap or shakeout,
   then a reclaim" in the brief. The fixes use the catalog's distinctions: a prior low, a moving average,
   any prior extreme, a gap above a weak close.
6. **Answer leakage in reverse glossary items.** The quote for R begins "One R is...", and I fixed that
   one. Milder leaks are noted but not fixed: "undercuts" in U&R, "twenty names" in UCT 20, "weekend scan"
   in Sunday Scans, and the ADR% acronym.
7. **Cross-segment overlaps:**
   - Distribution-day counts: the glossary is fixed to drop its number.
   - Follow-Through Day day 4-7 is quizzed in both the glossary and bible rule 14. They are related, not
     cut.
   - "Heavy volume" is 2x average in the screener but 40-50% above average for O'Neil. The rule-4 lesson
     now states the difference.
   - Bible rules 3, 11 and 22 are merged.

## Notes for applying the fixes

- **Fix shape.** Each fix is `{"field", "after"}` for the main edit, plus `also: [{field, after}]` for
  the other edits the same repair needs. Field names:
  - `q`, `choices` (`null` removes the choices for a fill-in), `answer` (the whole `answer_json`)
  - `lesson_text`, `prompt.quote` (this is the corrections.py name), `prompt_json.format`
  - `reveal_json.support`
- **New numbers need `reveal_json.support`.** Every number a new lesson uses is carried in
  `reveal_json.support`, as quoted source lines. Without it, the importer's grounding check flags the
  lesson. Where a definition changes, `reveal_json.quote` should also move to the new source line.
- **Glossary distractors are copies of other terms' definitions.** A fixed or cut definition still shows
  up as a distractor in other items unless every copy is changed. The JSONL re-draws those choices. The
  cleaner path is to fix the definition once where gen_recall reads it, because corrections.py applies
  per item.
- **Fill-in accept lists are my proposal.** They need the owner's eye, especially "fails to follow
  through" and "industry group".

## 5 best

1. `si_6aa3c69c58b9` (bible rule 14 fill-in, FTD "Day 4-7"). The key is exact, and the bible's own FTD
   section answers every follow-up (what counts, which days are stronger, failure, what to buy). It only
   needs the lesson.
2. `si_3fd4578bd6cb` (bible rule 15 fill-in, "5-6" distribution days). The key is exact, the source
   section is rich, and the firm's wire thresholds give the desk's own version.
3. `si_f6c5b2e8c2c2` (bible rule 1 fill-in, "7-8%"). The key is exact, the bible has a worked example
   ($50 → $46.00-$46.50), and there is a natural desk contrast in the owner's "I almost never take a loss
   greater than 3%."
4. `si_20859c2e7bf4` (glossary Slingshot, reverse). The four choices are all sibling setups, nothing
   leaks, and the definition matches the catalog.
5. `si_a9506f79b3dd` (concept "leader"). The key is the firm's own RS-rank preset, and the methodology
   explains the rank. Only the code-syntax choices need translating.

## 5 worst

1. `si_1cf86a2d3d0e` / `si_ba47fef1fbf5` (Compass). They define a course feature the AI invented
   ("pre-grades the capstone trade plan"), with no trading value.
2. `si_f2a5dbcf1885` (Exposure Rating, forward). The firm's headline number is taught wrong: an
   out-of-date computation plus the permission-band framing, in a 154-character key.
3. `si_7b05a3f0b4d2` (Wedge Pop / Wedge Drop, forward). "One descending-coil skeleton with two
   resolutions" is model jargon, and it is wrong for the Drop.
4. `si_cdd726be8fd5` (concept "pullback to the 20ema"). The key is a 117-character code formula, and the
   item only checks whether you know -3..+1 from -2..+2.
5. `si_2dec6ccfa011` (bible rule 20). A giveaway MCQ whose key is a slogan, "the tape never lies".

Runner-up: `si_2b0b868c69b1` (PEG). The key is the definition of a different setup.

## Could not verify

- **The O'Neil rules themselves.** I verified them only against the bible file, not O'Neil's books.
  The bible was committed by Patrick on 2026-04-17 in a triage commit, and it reads like a
  model-compiled knowledge-base prompt ("UCT Intelligence Engine, File 1 of 8").
- **Authorship of the Setup Library essences and of `05_market_health.txt`.** I treated both as firm
  sources because they are published or used in the firm's engine.
- **Which EP trail the owner actually uses.** The playbook says the 9-EMA; the dossier (via
  sizing_rule.md) says the 10/20-day.
- **Morning Wire timing and contents.** These come from repo docs, not the live product.
- **The concept cuts depend on the vocab.chart drafts.** If the owner rejects those, 12 terms lose their
  quiz coverage.

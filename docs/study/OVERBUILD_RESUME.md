# Study overbuild: RESUME GUIDE (read this first in any new window)

Last updated 2026-11-11 (evening). The owner (Patrick) wants this run **hands-off until done**, then a dedicated full review
by him. He asked for everything to be saved locally (not in artifacts) so he can switch windows and resume easily. This file,
`docs/study/OVERBUILD_STATE.md` (the dated log), `docs/study/OVERBUILD_PLAN.md` (the design) and the memory file
`project-study-resume.md` hold the state. Local backups of everything that is not in git live in
`C:\Users\pgosz\uct-worktrees\_study-resume\overbuild\`.

## 1. What this is, in his words

"4 answers instead of 3 for every question" (decided: only the 1,443 three-answer mcq/scenario questions; True/False, number and
fill-in stay in their shape). "Each question researched deeply to provide the most proper answer as well as the simplest" (each
question gets `simple` = one plain line, and `why` = the full proper answer). "Overbuild and really take this to an extreme in
variety, scope, intelligence, teaching, scale, complexity, depth, examples ... then after we review it all and improve the system
we can scale back into the final version after deep testing." Then: "no you do it all fully ... I need to be a bit hands off for
this and we can push through until it is done and full me review time that I can dedicate to it all."

So: run every wave, integrate, validate, commit locally; DO NOT PUSH (he merges). He reviews at the end in the local review page.

## 2. Where everything is

| What | Where |
|---|---|
| Worktree and branch | `C:\Users\pgosz\uct-worktrees\study-hve-overlay`, branch `feat/study-content`, PR #1046 (unpushed overbuild commits, tag `overbuild-base`) |
| Design | `docs/study/OVERBUILD_PLAN.md` (v2) |
| Dated log | `docs/study/OVERBUILD_STATE.md` |
| Lessons | `docs/study/courses/<track>/<unit>.json` (131 lessons, 5,296 live questions at the start) |
| Merge tool | `scripts/study/apply_upgrade.py` (layered files; cuts last; sets calc/chart; cannot change `format`) |
| Wave tools | `scripts/study/wave_plan.py` (risk routing and chunking) and `scripts/study/integrate_wave.py` (merge a wave, report problems) |
| Wave workflow script | `C:\Users\pgosz\uct-worktrees\_study-resume\overbuild\overbuild-wave-routed.js` (args `{wave: "waveN", chunks: [...]}`) |
| Agent output (temp, backed up) | scratch `...\scratchpad\agents\<wave>\<chunk>\` and the backup `_study-resume\overbuild\waves\<wave>\`; refresh the backup with `_study-resume\overbuild\sync_scratch.sh` |
| Review app | installed at `C:\Users\pgosz\StudyReview` (page http://127.0.0.1:8794/, Desktop shortcut "Start Library Review"); source `tools/study_review/` |
| His verdicts | `C:\Users\pgosz\StudyReview\verdicts\verdicts.jsonl` (read with `python tools/study_review/read_feedback.py`) |
| Pilot report page | `C:\Users\pgosz\StudyReview\plan\Pilot-report.html` (and `Study-overbuild-plan.html`) |
| Python | `C:\Users\pgosz\uct-worktrees\study\.venv\Scripts\python.exe` (system python lacks matplotlib/pytest setup) |

Open pages in **Chrome**, never Edge (he said so): `Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" <url>`.
Local files and a local server, not Artifacts (he cannot use them).

## 3. Status table (update this as waves finish)

| Wave | Lessons | Questions | Status |
|---|---|---|---|
| Pilot | SET.07, F9.02, F6.04 | 117 in, 113 live | DONE, commit 8d38c1f902. 33 agents, 6.03M tokens. Owner has not yet reviewed it. |
| 1 | SET.08 to SET.11 | 287 (49 full path, 238 light) | RUNNING, workflow run `wf_30dcada7-1b0`, scratch `wave1`. Next: integrate. |
| 2 | SET.12 to SET.21 | 652 | not started |
| 3 | SET.22 to SET.31 | 667 | not started |
| 4 | SET.32 to SET.46 | 670 | not started |
| 5 | SET.47 to SET.54 | 503 | not started |
| 6 | Foundations: F1, F5, F7, F10, F10b | 663 | not started |
| 7 | F6 (except F6.04) and V | 1,141 | not started |
| 8 | F8, F9 (except F9.02), F11, F12 | 596 | not started |

Exact unit lists: `_study-resume\overbuild\wave_units.json`. The full-library cost estimate is about 120 to 150M tokens for option B
(risk routed); wave 1 measures the light path's real cost (estimate 20k tokens per question vs 44k for the full path in the pilot).

## 4. The loop for ONE wave (do exactly this)

1. **Plan.** `python -m scripts.study.wave_plan SET.12 SET.13 ... --out <scratch>/waveN_args.json` (prints the full/light split).
2. **Launch.** `Workflow({scriptPath: "C:\\Users\\pgosz\\uct-worktrees\\_study-resume\\overbuild\\overbuild-wave-routed.js", args: {wave: "waveN", chunks: <the chunks list from the args file>}})`.
   Pass the REAL chunk list (an earlier launch once used a placeholder list by mistake; it was stopped at once). Never run two waves at once.
   If a usage limit stops it: relaunch the SAME script and args with `resumeFromRunId: "<run id>"`; finished agents replay from cache.
3. **When the notification arrives** run `_study-resume\overbuild\sync_scratch.sh` (backs up the agent files).
4. **Integrate (dry run first).** `python -m scripts.study.integrate_wave <scratch>/agents/waveN SET.12 SET.13 ... --batch waveN --report <scratch>/waveN_report.json`
   Then with `--write`. It names every chunk that produced no files (those are skipped, never guessed).
5. **Repair.** Fix every validator problem in the report. Usual causes: a number in `simple`/`why`/`deeper` that is not in a quote, the
   calc or the question (say intermediate results in words); a `format` change (cut it and add a new question instead); `simple` longer
   than 25 words or with a semicolon; a lone Yes against three No. Small ones by hand; many at once by a repair agent that writes a
   `repair.json` in the `final.json` shape, layered on with `apply_upgrade`.
6. **Verify the questions edited after the last independent check** (the pilot's round 3 still found 10 fixes in 24): one fresh cold-check
   agent per lesson over only those keys (see `overbuild-pilot-verify` in the pilot scripts; copy it, change the file paths and keys), then
   apply with `apply_upgrade <lesson> empty.json --check <their check file> --write`.
7. **Gates.** `python -m scripts.study.gen_courses`, `python -m scripts.study.library_audit --strict`, `python -m pytest tests/test_study_courses.py tests/test_study_library_audit.py tests/test_study_apply_upgrade.py tests/test_study_wave_tools.py -q`,
   `python -m scripts.study.check_course_quotes <lesson files>` (0 MISSING; "unreachable" is fine if no live question depends only on it),
   `python tools/check_repo_hygiene.py`. Run vitest only with `--maxWorkers=1`.
8. **Commit locally** (never push). Trailer: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
9. **Rebuild the review data** (see section 7) and update section 3 here, `OVERBUILD_STATE.md` and the memory file.

## 5. Stop conditions (pause and tell the owner)

More than 5% of a wave's questions fail the final check after repair; a lesson loses more than 15% to cuts; the light path's defect
rate (questions the final re-check still sends back) is clearly worse than the full path's; a wave's cost is more than 25% over its estimate;
anything that needs a rule decided (those go in `owner_flags`, never decided by an agent).

## 6. Facts learned (do not relearn these)

- **Cost lesson from wave 1 (measured):** the 4 FULL-path chunks (49 questions, 24 agents) cost 4.57M tokens, about 93k per question. Each agent
  carries a large fixed read (contract, lesson, up to 125 facts, the pilot notes), about 190k tokens, so SMALL chunks are expensive per
  question. The pilot's bigger chunks (22 to 36 questions) cost about 44k each. So chunk size, not just the route, drives cost: keep chunks
  near 30 to 36 questions, and do not split a lesson's risky questions into a separate small chunk unless the saving is real.
  Wave 1's light path (about 25 to 29 questions per chunk, 4 agents) is the measurement for the other half.

- **Workflow gotcha (bit us in wave 1):** in a `pipeline()`, a stage that returns `null` DROPS the item (its later stages never run). The
  light route's first stage once returned null, so the 9 light chunks silently never started. The script now returns `{skipped: true}`.
  After any wave launch, confirm the agent counts by role in the run's journal (every route should show its agents) within a few minutes.

- A course item's id is the unit reference plus the question KEY (not the text): rewording a question keeps its id.
- The Study engine already has mastery, a due-date review ladder, difficulty bands and a six-part reveal: do not rebuild them.
- Cost: pilot about 44k tokens per question for the full path (51k with the one-off safety test). Per-question agents would cost MORE
  than per-chunk (repeated reading); batching 25 to 35 questions per agent and risk routing is the cheap form. All agents are Sonnet 5.5.
- Quality: the 30-defect seeded test was caught 30/30. Even so, four rounds still left small fixes; his sampled review is required.
- The agents found real flaws in the ORIGINAL questions (roughly one in six): tells, unsupported wrong-notes, keys that taught a web
  view his rulebook replaced (B22: no buys in the 3 days before a report, hold only if up 5R), a lesson relying on the 40% cap it never taught.
- `apply_upgrade` quirks: layered files override field by field; cuts are applied LAST; it can set `calc` and `chart` but not `format`.
- Course lesson files are written with indent 1, UTF-8, LF. Check `python tools/check_repo_hygiene.py` before any push.
- Items that rest on provisional defaults carry `depends_on: ["D-nnn"]`; when he rules a decision in Part 3 of the review page, find
  the questions with that id and re-key them.

## 7. Review app: rebuilding it after a wave

```
cd C:\Users\pgosz\StudyReview
copy tools\study_review files from the repo if they changed (index.html, *.py), then:
python build_data.py <repo> <StudyReview\data_new> ; python first_pass.py <repo> <data_new> ; python build_rules.py <repo> <data_new>
then replace data\ with data_new\   (the Desktop shortcut "Start Library Review" does all of this on launch)
```
The server (port 8794) reads data per request, so no restart is needed unless `server.py` changed. If it is not running:
`cd C:\Users\pgosz\StudyReview ; python server.py --home . --no-browser`, then open http://127.0.0.1:8794/ in Chrome.
It shows each upgraded question against its pre-overbuild version (`first_pass.py` compares with tag `overbuild-base`), the
rule behind each question, Part 3 (the 134 open decisions), tags, lesson notes, a feedback summary and copy-as-text.
BUILT 2026-11-11 (commit 8bdd83595d) for his dedicated review: **Part 4 sample review** (10 random upgraded questions per lesson, riskiest
first; all good approves the lesson; one defect widens the sample to 25; three send it back to the pipeline), a **lesson status board**
(menu), a **daily review budget** (default 150, shown in the progress line), and a **"Which is better? old / same / new" row** on every
upgraded question (records `ab:<id>`, kind `ab`; the feedback screen tallies them). `read_feedback.py` does not yet list `ab` records or
lesson approval status: add that when acting on his feedback. A truly BLIND old-vs-new (hiding which is which) is not built.

## 8. After all waves (the plan's phases 3 to 5)

- **Phase 3, the overbuild proper** (variety, examples, new tracks, new formats): the plan section 6 lists the options and the defaults
  (new tracks: market regime, earnings, tool lessons; formats: spot-the-mistake extended, place-the-stop, size-the-trade; depth targets
  8/8/6 per skill). Not started; waves 1 to 8 (the upgrade of the existing library) come first.
- **Phase 4:** his big review with the review page; mine his feedback with `read_feedback.py`; turn patterns into standards in
  `docs/study/LIBRARY.md`; re-run only the affected lessons.
- **Phase 5:** deep testing and scale back (numeric rules in plan section 8). Owner signs off.

## 9. Owner facts and preferences

Non-technical: explain plainly. Wants everything in plain local files and pages opened in Chrome. Granted full autonomy on the programme
("you do it all fully"). Pushes, purchases, credentials stay his. He is happy to spend the tokens but wants real numbers first; the pilot
numbers are in `Pilot-report.html`. Save progress often; he may switch windows at any time.

## 10. Open items for him (collect, do not decide)

The agents' `owner_flags` (per chunk) are in each chunk's `upgraded.json` and `final.json`. Known ones: flat-base first/second base gate;
gap rule stop exactly at the first 30-minute low or a few cents under; one close under the 200-day ends a base for good?; 3% first-week
number is only the card's proposal; B22 "3 days" calendar vs trading days; 11 pilot questions rest on undecided decisions; the F5 sourcing
policy (some publishers bar AI use, Bulkowski asks not to train AI) is still open; SET.44 q66/q67 buy-stop wording; the 134 Part 3 decisions.

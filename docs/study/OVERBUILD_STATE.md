# Overbuild state (resume file)

Plan: `docs/study/OVERBUILD_PLAN.md` (v2). Owner said "analyze, improve, then let's go for it" on 2026-11-11.

## Done
- Plan v2 written and improved (14 changes, section "v2" at the top).
- **Phase 0 (code), commits 553090e6d4 and 2d502dac05, tag `overbuild-base`:** new optional question fields `simple`, `deeper`, `tier`,
  `batch`, `risk`, `depends_on` (validator rules in `scripts/study/courses_lib.py`, each proven by a planted-defect test); an
  upgraded mcq/scenario (one with `simple`) needs exactly 4 choices; `simple` is grounded and voice-checked like `why`; the
  reveal card leads with "In one line" and keeps the full answer in a disclosure; the audit prints the upgrade progress line;
  the review page shows simple/tier/deeper and "was / now" against `overbuild-base`.
- `scripts/study/apply_upgrade.py` merges a Writer's upgrade (and a checker's pass/fix/cut) into a lesson file and validates it.

## Pilot (Phase 1), started 2026-11-11
- Workflow run `wf_e70513a7-597`, script `docs/study/../_study-resume/overbuild/overbuild-pilot-wf_e70513a7-597.js`
  (copy in `C:\Users\pgosz\uct-worktrees\_study-resume\overbuild\`), args in `pilot_args.json` there.
  Resume: `Workflow({scriptPath: <the .js>, resumeFromRunId: "wf_e70513a7-597", args: <pilot_args.json as {chunks: [...]}>})`.
- Lessons: SET.07 (two chunks of 36 and 35), F9.02 (24), F6.04 Delta (22). Per chunk: Researcher, Writer, then Cold checker and
  Red team in parallel. Agents write only to the scratch folder `.../scratchpad/agents/pilot/<chunk>/`
  (`research.json`, `upgraded.json`, `merged.json`, `check.json`, `redteam.json`).
- Seeded-defect test: 3 doctored lessons (F6.06, F5.02, F1.05) with 30 planted defects; the answer key is
  `seeded_ground_truth.json` in the resume folder (kept OUT of the repo so agents cannot read it). Gate: catch rate of at least 90%.

## Pilot round 1 result (wf_e70513a7-597: 22 agents, 0 errors, about 20 min, 4.09M tokens)
- Seeded-defect gate: **30 of 30 caught (100%)** by the cold checker alone and by the red team alone, every defect type. Untouched
  questions flagged: 5 of 32 by the checker, 13 by the red team; read by hand, they are REAL flaws in the original lessons (a
  length tell, a wrong-note no cited fact supports, an unsupported first-person rule), so the old library has roughly one flaw per
  six questions that the first cold check missed.
- 117 pilot questions upgraded (SET.07 x2 chunks, F9.02, F6.04). Cold check: 75 pass, 42 fix, 0 cut. Red team: 0 blockers,
  43 majors, 89 minors. Majors were real (tells; a key that taught a web view the owner's B22 replaced; F9.02 never teaches the 40% cap).
- Only 3 fourth answers were needed in SET.07a (most SET questions already had 4); every chunk's writer needed validator fixes.
- Cost per question about 35k tokens for the full path.

## Pilot round 2 (running): wf_87fab828-c56, script `overbuild-pilot-resolve-wf_87fab828-c56.js` (copy in the resume folder)
Per chunk: Resolver (fold in checker fixes; fix or rebut every red-team major; close lesson-level gaps; max 4 new questions) writes
`final.json`; a fresh Recheck agent checks the merged result (`merged_final.json`) into `check_final.json`.
Then integrate with `apply_upgrade <lesson> upgraded.json final.json --check check_final.json --batch pilot-1 --write`.

## Next
1. Read the workflow result; score the seeded catch rate; read the per-chunk reports.
2. Integrate each chunk with `python -m scripts.study.apply_upgrade <lesson> <upgraded.json> --check <check.json> --batch pilot-1 --write`,
   resolve red-team blockers, run `gen_courses`, the strict audit and the tests.
3. Show the pilot to the owner in the review page (it highlights every upgraded question with "was / now"); blind old-versus-new.
4. Fix the briefs from his feedback, then Wave 1 (see the plan, section 5).

## PILOT DONE (2026-11-11), commit 8d38c1f902 (local, not pushed)
- Rounds: 1 (research/write/check/red team + 30-defect test), 2 (resolve + recheck), 3 (final verify of the 24 questions edited since).
  Workflows wf_e70513a7-597, wf_87fab828-c56, wf_fd3d02b2-9b6. 33 agents, 6.03M tokens, about 45 min.
- Result: 113 live questions with `simple` (66 SET.07, 25 F9.02, 22 F6.04); 27 three-answer questions now four; 55 deeper notes; 8 cut,
  4 new. Validator, strict audit, quote check (0 missing) and 231 tests green. Cost about 44k tokens per question (51k with the one-off test).
- Finding: four independent rounds still left small fixes (round 3 found 10 of 24), so the owner's sampled review is required; the
  full library at this cost is about 230M tokens, risk-routed about 120-150M. Report for the owner: StudyReview/plan/Pilot-report.html.
- Tool facts: apply_upgrade applies cuts LAST; it can set calc and chart; it cannot change `format` (change by hand, as for SET.07 q33).
- Open: the owner's choice of scale (A all / B risk-routed / C priority first) and his pilot review. Do NOT launch a full wave before he picks.

## WAVE 1 RUNNING (started 2026-11-11, option B risk-routed, Sonnet high effort): SET.08 to SET.11, 287 questions
- Workflow run `wf_30dcada7-1b0` (an earlier launch with a placeholder args list was stopped at once and its scratch cleared).
  Script `overbuild-wave-routed-wf_c1ee93a9-04f.js` and args `wave1_args.json` are in `C:\Users\pgosz\uct-worktrees\_study-resume\overbuild\`.
  Resume: Workflow({scriptPath: <that .js>, resumeFromRunId: "wf_30dcada7-1b0", args: {chunks: <wave1_args.json>}}).
- 13 chunks: 4 FULL (the 49 high-risk questions: research, write, check + red team, resolve, recheck) and 9 LIGHT (238 stable
  questions: write, one combined check-and-break agent, resolve, targeted recheck). Scratch: `.../scratchpad/agents/wave1/<chunk>/`.
- Why: the owner asked whether to "delegate to Sonnet on high effort with a strong prompt"; the pilot already ran that way. Per-question
  agents would cost MORE (fixed re-read overhead each time), so batching ~25-35 questions per agent plus risk routing is the cheaper form.
  This wave also MEASURES the light path's real cost (estimate: about 20k tokens/question vs 44k for the full path).
- After it finishes: integrate each lesson with `apply_upgrade <lesson> <chunk>/upgraded.json <chunk>/final.json ... --check <chunk>/check_final.json --batch wave1 --write`
  (all chunks of a lesson in one command; cuts apply last), fix any validator problems by hand, run gen_courses, strict audit, tests,
  quote check; consider a verify pass on questions edited after the recheck; then report cost and quality (the light path's defect rate vs full).

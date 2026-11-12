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

## Next
1. Read the workflow result; score the seeded catch rate; read the per-chunk reports.
2. Integrate each chunk with `python -m scripts.study.apply_upgrade <lesson> <upgraded.json> --check <check.json> --batch pilot-1 --write`,
   resolve red-team blockers, run `gen_courses`, the strict audit and the tests.
3. Show the pilot to the owner in the review page (it highlights every upgraded question with "was / now"); blind old-versus-new.
4. Fix the briefs from his feedback, then Wave 1 (see the plan, section 5).

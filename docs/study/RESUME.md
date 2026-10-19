# Study — RESUME HERE

**What this is.** Study = the interactive trading-education product inside The Desk → Courses: a
"Duolingo for stocks" (Foundations, 13 tracks + Vocabulary) and the firm's own system (The UCT
Method) drilled on real charts, with no AI at runtime, every item reviewed by the owner.

**Authority, in order:** `docs/superpowers/specs/2026-10-17-desk-practice-interactive-education-design.md`
(§13 overrides earlier sections; §11 + §13.9 hold every owner decision) → `docs/study/plan-review.html`
(the owner-facing plan page, saved locally) → this file (state + next actions).

**Owner rulings that govern the work (2026-10-17):**
- Launch Study **only when it is all done and complete** (not tied to the site's 2026-11-14 opening).
- Owner is **full time** on review until it is done; reviews **every item of a type until 20-30 clean
  examples**, then the review screen asks whether to switch that type to auto-approve + sample.
- **Save everything locally, resumably** — this branch/worktree is the save file. Commit at every
  checkpoint. Artifacts are copies, never the only copy.
- No AI in the product at launch; lessons written in sessions; no model writes a market fact.

## State (update this block at every checkpoint)
- Branch `feat/study`, worktree `C:\Users\pgosz\uct-worktrees\study` (owner file present), based on
  master `f2e816e042` (2026-10-17). Nothing merged to master. Nothing deployed. **PUSHED 2026-10-18**
  (origin/master merged in at 6d19526e41, one trivial AuthContext.jsx conflict, both flags kept);
  PR #417 open: https://github.com/unchartedterritory5995-cyber/UCT-Dashboard/pull/417 (merge AFTER #416).
- Python: `.venv/` in this worktree (Python 3.12, requirements + pytest installed 2026-10-17).
  Run tests as `.venv/Scripts/python.exe -m pytest tests/<named files> -q -p no:cacheprovider`.
- Commits so far: c8edff5363 spec+plan+RESUME · 22980148dc five Phase 0 files · b568f4d580 RESUME ·
  ad2f95cbf9 wire_archive market_call (blocker B2) · ab7a0efbbe UNITS-foundations (129 units) ·
  1a6b3da6cb scans image-copy job (blocker B1) + UNITS-method (96 units) + skill_map.json ·
  aab8042648 RESUME · 47476c0328 Phase 1 backend skeleton (+3,401 lines, 125 tests) · b32489bf08/c10a54a78a/
  efb8812ad9/9395cbb976 lane F1 (StockChart studyMode, hub hides under fullscreen Sheet, StudyPanel,
  SkillTrail, ProgressRing, Courses integration, Settings card; 50 tests) · 75bc05e44c/ab298a0754 lane F2
  (DrillPlayer, 7 drills, RevealCard, EndCard, PractiseSheet, useStudySession, outbox; 42 tests) ·
  e565b0620e integrator wiring of the drill + practise sheet into CoursesSection (reachable rail green) ·
  lane G (importer, templates, jobs, generators): 777d3adfd9 templated lessons · 024e58e7e3 scheduler jobs
  (reminders claim-row, weekly close + boot catch-up, nightly detection drafts) · 755ac7bbf3 near-dup diff ·
  c534a8dd25 generators + first bank (661 drafts) · lane F3: 5cacb84001/7e077a3e64 StudyReview admin card
  (PatternReview `?mode=study`, 20 tests) · 5a14ade449 every item has a lesson, no em-dash in member copy ·
  052aae57e4 drills read the bank's shape (`q`, `quote` block, free-text `format: fill`).
- Later 2026-10-17: lane W walk-throughs 74d40640b2/869cf54739/b169f6547a (type `walkthrough`, unscored
  "seen" attempts, unit sessions `POST /sessions {kind:'unit', skill_id}`, WalkthroughDrill, 25 items in
  walk.method from the brief; 13 framing terms left the glossary quiz, 80 -> 54) · 3f76d0bb61 research
  lane (docs/study/research: 77 cited definitions, candle + bottoms coverage) · corrections overlay
  (scripts/study/corrections.py; docs/study/corrections/*.jsonl; owner-approved items import approved).
  Integrator re-ran lane W: backend 6 files 177 passed; WalkthroughDrill 5, DrillPlayer 9,
  useStudySession 12, CoursesSection 14. Bank now 660 (walk.method 25).
- **2026-10-19 BANK IMPORTED (live):** #417 merged (a2b75be153), Study live in web deploy 7d0ee0e300.
  Owner ran `scripts/study/import_bank.py` (then a scratchpad copy of it) on the pod: 660 sent, 660
  inserted, 0 flagged / misses / rejected, 205 bar snapshots. Read back from `/data/study.db`: 660 drafts
  (recall 374, spot 132, size 48, family 42, regime 39, walkthrough 25; lanes deterministic 401 / manual
  259), `study_terms` 0 (no terms posted yet), every `bars_ref` resolves. The StudyReview admin screen
  (PatternReview `?mode=study`) now has content; nothing is approved, so members still see nothing.
  The importer + its 8 unit tests ride in `scripts/study/import_bank.py` /
  `tests/test_study_import_bank.py` (PR from branch feat/study-import-bank). Re-runs upsert by id.
- **2026-10-18 HOLD (owner):** item 2 in its third shape was still "improper": "these are very nuanced".
  Quiz items built from playbook PROSE (rules / named mistakes) are on hold: the prose does not carry
  the owner's real rules (he buys ahead of a HOD break, buys under the 20 EMA on an undercut). Proposal
  put to him: prose sources (playbooks, principles, brief, concepts) = teaching material; judgment
  items only from rules he states himself (per-setup workshop in chat, verbatim into
  docs/study/sources/owner/<setup>.md) with `accept` lists for nuance, or from chart ground truth
  (fixtures, recorded calls, outcomes). Quiz stays valid for textbook facts (candles, O'Neil's rules
  attributed to O'Neil), sizing math, and recorded data. Awaiting his choice.
- **Owner review position:** item 1 (THE LOOP) rejected -> became a walk-through; item 2 (Bull Flag
  named mistake, si_1291bfa801ba) = a FIX in the owner's words, logged as `proposed` in
  docs/study/corrections/recall.playbooks.jsonl; awaiting his confirmation of the exact wording and
  whether setupPlaybooks.js (the Setup Library source) gets the same wording. Next item after that:
  recall.playbooks #2.
- Research follow-ups (docs/study/research/coverage.md): StockCharts unreachable from this box; IBD
  paywalled past the lead; candle catalog has 66 records, ~35 Bulkowski names missing, 10 textbook
  biases flip in Bulkowski's data (kept classic by owner decision 2026-08-24); BOTTOMS lacks 1990,
  1998 and the April 2025 low. `reveal_json.depth` wiring (summary + sources under the reveal) not built yet.
- Early-merge branch `fix/wire-archive-market-call` in worktree `C:\Users\pgosz\uct-worktrees\wire-call`
  (from origin/master d0c406824d): 8f5a530f72 (cherry-pick of ad2f95cbf9) + 0dbadeef29 (scans copy script +
  test). PR #416 MERGED 2026-10-19 12:22 ET (ea07799f08, web deploy SUCCESS 12:4x ET after a GitHub
  Actions/Webhooks degradation delayed the promote by ~10 min). **Scans copy DONE on the pod 2026-10-19:**
  3096 sunday_scans images, 3095 stored in R2 `study/scans/<sha256>.<ext>`, ledger `/data/study_scans_ledger.json`;
  1 permanent failure (`url-sha256:4da8be83fa8e…`, "Theory of Reflexivity" diagram on a dead Amazon bucket,
  http 403; not a chart, nothing to retry). Every ledger `ticker_hint` is unconfirmed until the owner
  confirms it on the review screen.
- Phase 0: ALL 8 FILES DRAFTED. Awaiting the owner's one-session review (see "Owner review packet").
- Phase 1 backend: SKELETON LANDED 47476c0328 (study_store/scoring/select + router + 6 test files,
  125 tests). Integrator re-ran all six in this session (125 passed) plus the four rails
  test_feature_flag_ledger / test_hub_preview_flag / test_no_shadowed_definitions /
  test_shared_data_root_guard (532 passed). Follow-ups from the lane's deviations: streak
  currently counts on the first scored attempt of the day (spec: finishing the 10-item set);
  mastery constants are provisional in study_store; import resolves bars synchronously (fine,
  index seek only) with misses stored as unresolved drafts; /items/{id}/image and /intro/{unit}
  wait on R2 assets; review_lane assignment left to generators.
- Content bank: **661 draft items** in `docs/study/bank/*.json` (recall.glossary 80 · principles 36 ·
  bible 32 · concepts 22 · playbooks 29 · size.house_rule 68 · spot.fixtures 132 · family.fixtures 42 ·
  regime.bottoms 48 · regime.wire 0 (archive lives on the web pod; run `gen_regime` there) ·
  candles.catalog 172). Every item has a lesson (371 source, 290 template); no em-dash in member copy.
  Regenerate: `.venv/Scripts/python.exe -m scripts.study.run_all`; rail `tests/test_study_generators.py`
  asserts the committed bank == a fresh run. **Owner review: batch 1 = recall.glossary items 1-10,
  presented in chat 2026-10-17; verdicts not yet recorded.** Corrections go to
  `docs/study/corrections/<segment>.jsonl` (to create on the first verdict).
  Unit plan: Foundations 116 units (~2,970 q) + Vocabulary 13 units (~2,920 q) + Method 96 units (~5,605 q).
- **Source rulings (owner, 2026-10-17, after item 1 was rejected: "i have never heard of THE LOOP"):**
  (1) The Presenter's Brief (docs/curriculum/uct_method_presenter_brief.json, AI-written 2026-07-27) is
  fine as a source but is TEACHING, not quiz material: "it is essentially exactly how everything is
  supposed to be analyzed" but "we dont exactly emphasize that". Its framing terms become unscored
  walk-through items (type `walkthrough`, to build); real desk terms stay quiz items.
  (2) voice_kb/trading_principles.json: "fine, good to have, might need some adjusting" -> keep, review one by one.
  (3) setupPlaybooks.js: "yes that is good" + "sweep reliable websites to gain full complete detailed
  definitions to make the answer perfect and detailed" -> research lane: cited external definitions
  (docs/study/research/), used to deepen reveals/lessons, every one still owner-reviewed.
  (4) candle catalog + bottoms catalog: keep ("well researched and reliable"), "make sure nothing is
  missed and all the stuff is properly defined explained and emphasized" -> coverage check in the same lane.
  LESSON: check a source's authorship (`git log --format=%an` + its header) before calling it "the firm's";
  a document a model wrote is not the desk's vocabulary.
- Review flow (owner decision 2026-10-17): in chat, question form, ONE item at a time (he asked for one by one, not groups); after 20-30 clean
  items of a type the StudyReview card offers auto-approve + 10% sample for that type.
- Owner answers 2026-10-17: Scans image copy = yes (run on the pod after the early merge); early merge =
  "whatever is optimal for hands-off" (done as the branch above); voice-clone source = the whole library,
  compare and contrast a lot (research not started).

## Owner review packet (Phase 0 — read in this order, one session)
1. `docs/study/VOICE.md` — the voice rules derived from your Substack/Scans prose; §8 open items.
2. `docs/study/UNITS-foundations.md` — 129 units; read "Gaps for the owner" (8 content gaps +
   a thin-data table). Notable: 1929 and 1973-74 can only be authored (index bars start 1974);
   Greeks units need hand-frozen past chains; F7.05 waits on the wire-archive tier backfill.
3. `docs/study/UNITS-method.md` — 96 units; all 79 course lessons linked, 6 "covered in part"
   need your sign-off; the 28-setup roster with supply (6 good · 12 medium · 5 thin · 6 none);
   "Source facts that differ from the spec" (34 templates not 48; a 4th setup vocabulary in the
   archive; VCP/Flat Base/HTF/EP/PEG/U&R/Remount have 0 real-bar fixtures; 21- vs 17-mistake
   audit; course drawdown protocol vs your published ladder).
4. `docs/study/skill_map.json` — the machine map (28 setups with aliases, 106 lesson links).
5. `docs/study/sizing_rule.md` — confirm the drawdown ladder (§4) and "under 1% is normal".
6. `docs/study/pass_bars.md` — the proposed bars.
7. `docs/study/video_toolchain.md` — approve Option A and the voice source.
8. `docs/study/VOICE_CONSENT.md` — sign before any voice sample is used.

## Phase 0 checklist (owner signs off each file in one session)
- [x] `docs/study/VOICE.md` (draft 22980148dc, awaiting owner sign-off) — derived from the owner's own prose (toolkit cards, morning-wire
      `data/voice/voice_exemplars.json` + `voice_profile.json`, methodology bible, playbooks; Desk
      transcripts and Substack issues once read from the server).
- [x] `docs/study/UNITS-foundations.md` (draft ab7a0efbbe, 129 units) — every unit for F1–F12, F2b, V with what it teaches, rungs,
      example needs, course lesson covered.
- [x] `docs/study/UNITS-method.md` (draft 1a6b3da6cb, 96 units) — every unit keyed on the course JSON's 16 modules + Calls +
      Overlay, with the per-setup supply table (28 setups) and the loss source per setup.
- [x] `docs/study/skill_map.json` (draft 1a6b3da6cb) — curricula → tracks → units → skills, ids, lesson_key links,
      28-setup aliases to the other vocabularies.
- [x] `docs/study/sizing_rule.md` (draft 22980148dc, owner to confirm §4 ladder) — §4.11 as the single sizing authority; toolkit card regenerated from it.
- [x] `docs/study/pass_bars.md` (proposal 22980148dc) — proposed checkpoint bars for owner decision.
- [x] `docs/study/video_toolchain.md` (proposal 22980148dc) — intro-video pipeline proposal with per-video cost.
- [x] `docs/study/VOICE_CONSENT.md` (template 22980148dc; unsigned) — consent template for the voice clone (owner signs before any sample).

## Build checklist (Phase 1, per spec §7 + §13.2)
- [x] `api/services/study_store.py` (47476c0328) (schema §6.1/§7.1 + §13 corrections: literal STUDY_DB_PATH read,
      one BEGIN IMMEDIATE per attempt, study_terms, trust_state per item type)
- [x] `api/services/study_scoring.py`, `study_select.py` (3 due slots + random mix), `study_templates.py`
      (777d3adfd9), `study_import.py` (lane G: get_bars_before only, misses stored as unresolved drafts,
      grounding + VOICE §6 + near-dup + review lanes; VOICE.md §9 records exactly what it enforces).
      `study_mastery.py` is still inline in study_store (constants provisional).
- [~] `api/routers/study.py` (47476c0328; image proxy + intro redirect pending R2 assets) (local `require_paid`, `STUDY_ENABLED` default ON read per request,
      bars-by-item, image proxy, attempts, step, today (bars inline), practise, leaderboard, review,
      import, corrections export)
- [x] `api/main.py` lifespan init + jobs (024e58e7e3): study_reminders */15 claim-row, study_weekly_close
      Sun 23:59 ET + boot catch-up, study_gen_detections Mon-Fri 02:30 ET; NO 06:30 fan-out (daily set is lazy).
- [~] Outside-Study prerequisites (their own small merges): wire_archive persists `exposure_tier` (DONE ad2f95cbf9);
      StockChart `studyMode` / `armedTool` / `toolsAllowlist`; hub hidden under a fullscreen Sheet;
      `/api/ticker-meta` short-circuits non-universe symbols; one-time Scans image copy to R2 (SCRIPT DONE 1a6b3da6cb: `scripts/study/copy_scans_images.py`, not yet run on the pod).
- [~] Frontend: StudyPanel + trail + DrillPlayer + 7 Phase-1 drills + reveal + end card + Practise
      sheet + Settings card LANDED and wired (e565b0620e). StudyReview admin card LANDED (lane F3,
      `app/src/pages/admin/StudyReview.jsx`, mounted as PatternReview's third tab `?mode=study`; the
      chart draws live bars for the revealed ticker, cutoff as a marker, forward strip as a caption;
      a multi-field Fix posts one `{action:'fix', field, after}` per field — not atomic on the wire).
      Still open: intro cover card (D15), Grade/Levels/Next/Family/Listen drills (Phase 2),
      size-answer key shape (`dollars` = risk $ vs position $) to confirm with the bank, lesson-link
      param (`?section=courses&lesson=<lesson_key>`), daily `xp_today` for the XP bar, a real
      `misses` session kind, an admin bars endpoint so the review chart can show the member's exact
      frozen bars.
- [x] Generators (lane G, `scripts/study/`): `_common.py` (make_item, dedash, quote_lesson,
      fallback_lesson, validate), gen_recall / gen_size / gen_fixtures / gen_regime / gen_candles,
      `run_all`. Not yet: VCP gold-standard, curriculum (course JSON), modelbook, scans (needs the R2
      copy), wire regime items (run on the pod), Foundations F1-F12 + Vocabulary authoring sessions.
- [x] Tests (6 files, 125 passing): `tests/test_study_store.py`, `test_study_scoring.py`, `test_study_no_sym_leak.py`,
      `test_study_import.py`, `test_study_flags.py`; frontend `StudyPanel.test.jsx`, `DrillPlayer.test.jsx`.

## Owner commands
Pushes + PRs DONE 2026-10-18 (#416 wire-call, #417 feat/study; the AI push went through once the owner
asked for it directly). #416 merged + deployed + scans copied 2026-10-19. The AI session CANNOT merge a PR
(server-side classifier refuses `gh pr merge` even with an allow rule); the owner runs it as a `!` line:
`! gh pr merge 417 --merge --repo unchartedterritory5995-cyber/UCT-Dashboard`. Railway builds only after the
"master deploy gate" workflow passes and "promote to production" pushes the `production` branch; watch
`railway deployment list --service web --json` (from C:\Users\pgosz\projects\UCT-Dashboard, the linked
checkout) until the merge commit reads SUCCESS. `railway ssh` must run from PowerShell (Git Bash mangles
`/opt/venv/bin/python` into a C:/Program path).
The AI session is ALSO refused `railway ssh` when the remote command writes ("Remote Shell Writes"), so
every pod-side import/copy is the owner's `!` line too. Both of these are DONE (2026-10-19); keep for re-runs:
```
# from PowerShell (not Git Bash), in C:\Users\pgosz\projects\UCT-Dashboard
railway ssh --service web -- /opt/venv/bin/python scripts/study/copy_scans_images.py            # scans -> R2 (done)
railway ssh --service web -- /opt/venv/bin/python scripts/study/import_bank.py --dry-run         # count only
railway ssh --service web -- /opt/venv/bin/python scripts/study/import_bank.py                   # bank -> /data/study.db (done)
railway ssh --service web -- /opt/venv/bin/python scripts/study/import_bank.py --only recall.glossary
```

## Resume procedure
1. feat/study is MERGED; branch new work off origin/master (e.g. `git worktree add -b feat/study-<x>
   C:\Users\pgosz\uct-worktrees\study-<x> origin/master`). The old worktree `uct-worktrees\study` is history.
2. Read this file's State block, then the spec §13 and §11/§13.9.
3. Continue the first unchecked item above. Commit at every checkpoint with a message starting `study:`.
   If the owner review is mid-batch, re-present the batch from the State block (segment + item range)
   and record verdicts to `docs/study/corrections/` before anything else.
4. Re-measure every count cited in the spec before relying on it (they drift).

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
  master `f2e816e042` (2026-10-17). Nothing merged to master. Nothing deployed.
- Phase 0 (all files at once): IN PROGRESS — see "Phase 0 checklist".
- Phase 1 backend: IN PROGRESS (skeleton) — see "Build checklist".
- Content bank: 0 items. Targets: 5,000+ Method · 2,500+ Foundations · 2,000+ vocabulary terms /
  4,000+ vocabulary questions. Both curricula authored in parallel, interleaved.

## Phase 0 checklist (owner signs off each file in one session)
- [ ] `docs/study/VOICE.md` — derived from the owner's own prose (toolkit cards, morning-wire
      `data/voice/voice_exemplars.json` + `voice_profile.json`, methodology bible, playbooks; Desk
      transcripts and Substack issues once read from the server).
- [ ] `docs/study/UNITS-foundations.md` — every unit for F1–F12, F2b, V with what it teaches, rungs,
      example needs, course lesson covered.
- [ ] `docs/study/UNITS-method.md` — every unit keyed on the course JSON's 16 modules + Calls +
      Overlay, with the per-setup supply table (28 setups) and the loss source per setup.
- [ ] `docs/study/skill_map.json` — curricula → tracks → units → skills, ids, lesson_key links,
      28-setup aliases to the other vocabularies.
- [ ] `docs/study/sizing_rule.md` — §4.11 as the single sizing authority; toolkit card regenerated from it.
- [ ] `docs/study/pass_bars.md` — proposed checkpoint bars for owner decision.
- [ ] `docs/study/video_toolchain.md` — intro-video pipeline proposal with per-video cost.
- [ ] `docs/study/VOICE_CONSENT.md` — consent template for the voice clone (owner signs before any sample).

## Build checklist (Phase 1, per spec §7 + §13.2)
- [ ] `api/services/study_store.py` (schema §6.1/§7.1 + §13 corrections: literal STUDY_DB_PATH read,
      one BEGIN IMMEDIATE per attempt, study_terms, trust_state per item type)
- [ ] `api/services/study_scoring.py`, `study_select.py` (3 due slots + random mix), `study_mastery.py`,
      `study_templates.py`, `study_import.py` (get_bars_before only; misses reported; number-grounding
      + banned-phrase checks)
- [ ] `api/routers/study.py` (local `require_paid`, `STUDY_ENABLED` default ON read per request,
      bars-by-item, image proxy, attempts, step, today (bars inline), practise, leaderboard, review,
      import, corrections export)
- [ ] `api/main.py` lifespan init + jobs (reminders claim-row, weekly close w/ catch-up,
      gen_detections after 02:00 ET; NO 06:30 fan-out)
- [ ] Outside-Study prerequisites (their own small merges): wire_archive persists `exposure_tier`;
      StockChart `studyMode` / `armedTool` / `toolsAllowlist`; hub hidden under a fullscreen Sheet;
      `/api/ticker-meta` short-circuits non-universe symbols; one-time Scans image copy to R2.
- [ ] Frontend: StudyPanel + trail sub-view inside CoursesSection, fullscreen DrillPlayer (one chart
      per session), drills, reveal panel, end card, Practise sheet, StudyReview admin mode.
- [ ] Tests: `tests/test_study_store.py`, `test_study_scoring.py`, `test_study_no_sym_leak.py`,
      `test_study_import.py`, `test_study_flags.py`; frontend `StudyPanel.test.jsx`, `DrillPlayer.test.jsx`.

## Resume procedure
1. `cd C:\Users\pgosz\uct-worktrees\study && git status && git log --oneline -5`
2. Read this file's State block, then the spec §13 and §11/§13.9.
3. Continue the first unchecked item above. Commit at every checkpoint with a message starting `study:`.
4. Re-measure every count cited in the spec before relying on it (they drift).

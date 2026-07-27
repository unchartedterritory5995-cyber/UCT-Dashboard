# Desk Courses (Learning Paths v2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** DB-backed courses with admin editing, member progress/resume, a syllabus PathView, and a PUSH_SECRET apply rail — seeded with today's six paths so day one changes nothing visible.

**Architecture:** Mirrors the shipped taxonomy build: additive tables in education.db + service functions under the non-reentrant `_WRITE_LOCK`, endpoints on the existing education router auth tiers, frontend consumes via SWR and derives all progress client-side from the existing progress store. Spec: `docs/superpowers/specs/2026-07-26-desk-learning-paths-courses-design.md` (read it first — schema, endpoint shapes, and UI intent live there).

**Tech Stack:** FastAPI + SQLite (education.db), React 18 + CSS modules + SWR, pytest, vitest (`--pool=threads`).

## Global Constraints
- Worktree `C:\Users\Patrick\uct-dashboard\.worktrees\desk-taxonomy`; ABSOLUTE paths in shell (cwd drifts); explicit-path `git add` only; focused pytest FILES synchronously.
- `_WRITE_LOCK` is NON-REENTRANT: no function holding it calls another that acquires it. `contextlib.closing` every connection. `PRAGMA foreign_keys=ON` on connections that touch edu_path_steps.
- Frontend LOCKED: VideoDockSlot FIRST child; playback only `playVideo(list, index)`; `?v=` effect untouched (and wins autoplay over `?path`); `?cat`/search flat-grid behavior unchanged; `/`+Esc untouched; breakpoints 640/1024; UIcon only; 44px touch; no page horizontal scroll; useScrollEdges contentKey stays in deps; all URL writes merge existing params (functional setSearchParams form).
- paths-apply rail: ONE transaction, pre-validate everything before any write, upsert-by-slug + full step replace; never touches edu_videos.
- Nothing member-visible changes until the seeded six paths render identically-or-better; curriculum content applies only after owner approval (outside this plan).

---

### Task 1: Schema + service CRUD + seed migration

**Files:** Modify `api/services/education_service.py` (schema block + new functions after the category section) · Create `api/services/education_paths_seed.py` (the six paths' data, transcribed VERBATIM from `app/src/pages/desk/learningPaths.js` — id→slug, name, blurb, steps youtube_ids in order) · Test `tests/test_education_paths.py`.

**Interfaces (produces):**
- `list_paths(include_disabled=False) -> list[dict]` — each `{id, slug, name, blurb, kind, sort_order, enabled, steps:[{youtube_id, module_label, note}]}`, paths ordered `(kind='course' first, sort_order, name)`, steps by sort_order.
- `create_path(payload) -> dict` (slug required unique/kebab, name required; ValueError on bad kind/slug collision) · `update_path(id, payload) -> dict|None` (partial; slug immutable v1) · `delete_path(id) -> bool` (cascade steps).
- `replace_path_steps(path_id, steps: list[dict]) -> int` — full replacement, sort from array order, ValueError on empty youtube_id; returns count.
- `bulk_apply_paths(paths: list[dict]) -> {"paths": n, "steps": n}` — validate ALL first (slug/name/kind/steps shapes), then ONE `_WRITE_LOCK` acquisition + ONE connection + ONE commit: upsert each by slug (update name/blurb/kind/sort_order/enabled), delete+reinsert its steps. Reuse the `_upsert_*_conn(c, ...)` no-lock-helper idiom from `_upsert_category_conn`.
- `ensure_default_paths()` — flag-file `.edu_paths_migrate_v1` one-shot: seeds the six paths from education_paths_seed.py (kind='track', enabled=1, sort_order = file order) ONLY when the flag is absent AND edu_paths is empty; writes flag either way after success. Wire it where `ensure_default_videos()` is called from (find the caller — main lifespan or module init — and add alongside).

Steps: TDD — tests first covering: schema creates + FK cascade on delete_path; slug uniqueness ValueError; ordering contract; replace_path_steps ordering + validation; bulk_apply_paths upsert-by-slug + step replacement + all-or-nothing on invalid mid-list entry (DB unchanged after ValueError — mirror `test_bulk_apply_taxonomy_rolls_back_whole_batch_on_bad_category`); ensure_default_paths seeds 6 exactly once (flag respected, non-empty table respected). RED → implement → GREEN → run `tests/test_education_paths.py tests/test_education_taxonomy.py tests/test_education.py -q` (no regressions, exact counts) → commit explicit paths.

### Task 2: Router endpoints

**Files:** Modify `api/routers/education.py` · Test `tests/test_education_paths_router.py` (copy fixture pattern from test_education_router_taxonomy.py).

**Interfaces (produces):** `GET /api/education/paths` (require_paid) → `{"paths": [...]}` enabled-only; `POST /api/education/paths` + `PATCH /api/education/paths/{id}` + `DELETE /api/education/paths/{id}` + `PUT /api/education/paths/{id}/steps` (require_admin, Pydantic models per spec, ValueError→400, missing id→404); `POST /api/education/paths-apply` (require_push_secret) → bulk_apply_paths result. Route-order check vs existing literals (there is no `/paths/{...}` conflict but verify like Task 2 of the taxonomy plan did).

Steps: TDD (auth-tier negatives for every write incl. paid-user-not-admin; happy paths; 404/400 mapping; apply transactional via router) → implement → focused files green → commit.

### Task 3: Backend gate
Run the education family test files synchronously (exact counts) + boot local uvicorn (port 8085, throwaway EDUCATION_DB_PATH, heavy-jobs-off env per prior rounds) and curl-verify: seeded six paths appear in GET /paths; paths-apply round-trips a two-path payload; admin CRUD works with the admin cookie. No commits unless fixes needed.

### Task 4: Frontend — API paths + course cards + continue-strip

**Files:** Modify `app/src/pages/desk/VideosSection.jsx` (+ its module.css) · Delete `app/src/pages/desk/learningPaths.js` + its test · Test updates in the landing test file.

- New `useSWR('/api/education/paths')`; resolve steps against the loaded library exactly as the old `paths` memo did (skip unknown youtube_ids, hide path if <2 resolve). Replace the Learning Paths block with course/track cards per spec (name, blurb, N lessons, total duration when ≥70% of steps have parseable durations, progress bar + "n of M" once started — progress from the existing `progress` store: done flag per youtube_id; in-progress = any step with t≥8).
- "Continue your course" strip ABOVE Continue Watching when ≥1 path has (some done or in-progress) and (not all done): course name + next lesson (first step not done, preferring the in-progress one) + Resume button → `playVideo(pathVideos, nextIndex)`.
- Card click sets `?path=<slug>` (functional setSearchParams, replace:false here — a course open is a navigation, Back should return; document the deliberate contrast with ?cat's replace:true).
- Tests: cards render from mocked /paths; unknown-id skipping; progress math (0 started / partial / all done); strip appears only mid-course and resumes the right index; learningPaths.js fully gone (no import remains — grep in test or just build).

### Task 5: PathView (syllabus) + URL state

**Files:** Create `app/src/pages/desk/PathView.jsx` (+ module.css) · Modify VideosSection.jsx (render PathView INSTEAD of landing/flat content when `?path` matches a loaded path — VideoDockSlot stays first child ABOVE it; unknown slug → ignore param, render landing).

- Per spec: header (kind eyebrow COURSE/TRACK, name, blurb, "n of M · ~Xh Ym left", Start/Continue CTA); module groups by consecutive module_label (label null → no group header); lesson rows (index, title 1-line, duration, dim AI headline, state: gold check done / thin progress bar in-progress / quiet otherwise); row click `playVideo(pathVideos, idx)`; `?v=` present → its existing effect still wins (no PathView autoplay). Back link clears ?path (merge-preserving).
- House language: rows on page background, one surface max, 640/1024, 44px, no emoji.
- Tests: module grouping; resume CTA targets first-unwatched (prefer in-progress); row click passes full ordered list + index; unknown slug graceful; dock slot still first child with PathView open; ?v priority.

### Task 6: Admin editor on PathView
Admin-only (user.role==='admin') edit mode on PathView: edit name/blurb/kind; per-row remove / move up / move down / edit module_label + note inline; "Add lesson" via predictive library-title search (reuse the pattern the admin VideoForm uses, or a simple filtered dropdown over the loaded library); Save → PUT /paths/{id}/steps (whole list) + PATCH meta; optimistic close + SWR mutate; failure → inline error, no data loss (keep local draft). "New course/track" + Delete (confirm) in the section header for admins. Tests: gated rendering, reorder produces correct PUT payload, add/remove, meta PATCH.

### Task 7: Polish + audit + ship gate
`npm run build` clean → boot preview (port 8086, seed post-taxonomy DB per prior recipe) → Playwright desktop+390px pass over: cards, PathView (module groups, checkmarks, resume), admin editor, continue-strip, theater interplay (open lesson → docks; scroll-to-theater intact) → screenshots pv-*.png → `python tools/mobile_audit.py --base http://localhost:8086 --auth --routes /desk` zero new findings → full frontend suite `npx vitest run src/pages/desk src/pages/EducationalVideos.test.jsx --pool=threads` + backend family files → fix anything found → commits explicit paths.

### Task 8: Ship + verify (controller)
Fetch+rebase+push in one command (broker_sync grep ≥7 first); deploy-watch bundle swap; live verify: GET /paths on prod serves the seeded six; browse Desk as admin — cards render, PathView opens, member progress shows. Curriculum paths-apply happens LATER, owner-gated, outside this plan.

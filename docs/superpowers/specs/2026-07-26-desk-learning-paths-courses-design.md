# The Desk — Learning Paths → Courses (product) + Curriculum Blueprint (content)

**Date:** 2026-07-26 · **Status:** Approved by owner (scope Q&A: full course experience;
two-pronged curriculum = reorganize existing paths + comprehensive topical course
structure; Claude drafts / owner reviews; full recording briefs + schedule).
**Depends on:** Desk taxonomy initiative (shipped 7/26): 290 videos, tags, transcripts,
chapters, episode labels, deep search. Theater/player remains OUT of scope.

## Problem

Learning Paths are six hardcoded lists in `app/src/pages/desk/learningPaths.js` —
frontend-only, no admin editing (a deploy per tweak), no progress/resume, no structure
beyond a flat video queue. Meanwhile the library now has everything a real course
experience needs (per-member watch progress synced server-side, durations, AI headlines,
topic tags). The owner wants (1) the product to present curated sequences as real
courses and (2) an owner-reviewable, comprehensive curriculum: which existing videos
form which courses, what's missing, and a recording plan to fill the gaps.

## Track 1 — Product: DB-backed Courses

### Data model (education.db, additive — mirrors edu_categories pattern)
- `edu_paths(id INTEGER PK, slug TEXT UNIQUE, name TEXT NOT NULL, blurb TEXT,
  kind TEXT NOT NULL DEFAULT 'track' CHECK(kind IN ('course','track')),
  sort_order INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER)`
  — `course` = flagship multi-module curriculum; `track` = shorter topic sequence.
- `edu_path_steps(id INTEGER PK, path_id INTEGER NOT NULL REFERENCES edu_paths(id)
  ON DELETE CASCADE, youtube_id TEXT NOT NULL, sort_order INTEGER NOT NULL,
  module_label TEXT, note TEXT)` — `module_label` groups consecutive steps into
  modules (no third table); `note` = optional one-line teaching note per step.
  `PRAGMA foreign_keys=ON` per connection (modelbook precedent).
- Same `_WRITE_LOCK` (non-reentrant) + `contextlib.closing` discipline as the rest of
  education_service. Search index untouched (paths carry no searchable text of their own).

### Seeding / migration
One-shot flag-file migration (`.edu_paths_migrate_v1`) seeds the six existing
`LEARNING_PATHS` entries from learningPaths.js content into the DB (kind='track'),
preserving current behavior on day one. After the frontend flips to the API,
`learningPaths.js` is deleted.

### API (education router, existing auth tiers)
- `GET /api/education/paths` (require_paid) → `{paths:[{id, slug, name, blurb, kind,
  sort_order, steps:[{youtube_id, module_label, note}]}]}` — steps ordered; videos
  resolved client-side against the already-loaded library (today's pattern; unknown
  youtube_ids skipped client-side, path hidden if <2 resolve).
- Admin CRUD: `POST /api/education/paths`, `PATCH /api/education/paths/{id}`
  (name/blurb/kind/sort_order/enabled), `DELETE /api/education/paths/{id}`,
  `PUT /api/education/paths/{id}/steps` (bulk replace — the editor's whole-list save;
  validates youtube_ids non-empty strings, sort assigned by array order).
- `POST /api/education/paths-apply` (PUSH_SECRET, mirrors taxonomy-apply): one-shot
  transactional apply of the whole curated set `{paths:[{slug, name, blurb, kind,
  sort_order, enabled, steps:[...]}]}` — upsert by slug, replace steps; all-or-nothing
  under one lock acquisition; validates before writing (taxonomy-apply lessons:
  single transaction, pre-validation, create-only never applies here — full replace is
  the contract for this rail, documented).

### Frontend (VideosSection + new components; theater untouched)
- **Courses section on the landing** (replaces the Learning Paths block, same position):
  course/track cards with name, blurb, lesson count, total duration (sum of parseable
  durations; omit when <70% of steps have one), and a quiet progress bar + "N of M"
  when the member has started. Card click → PathView.
- **PathView (syllabus)** — the course page, URL state `?path=<slug>` (merges with
  existing params per the ?cat pattern): header (name, blurb, progress, Start/Continue
  CTA = plays from first unwatched step), then modules as quiet groups (module_label
  header) of lesson rows: index, title, duration, AI headline (dim, 1 line), watched
  checkmark / in-progress bar. Row click plays THAT step with the full path list in
  course order (`playVideo(pathVideos, index)` — Up Next walks the syllabus).
  Back affordance returns to the landing (clears ?path).
- **"Continue your course" strip** on the landing (above Continue Watching) when ≥1
  path is in progress: course name, next lesson title, resume button. Hidden otherwise.
- **Admin editing** on PathView (role==='admin'): edit name/blurb/kind, add step via
  the existing predictive search pattern (library title match), remove step, move
  up/down, set module_label/note inline; Save = PUT steps bulk replace. No drag-drop v1.
- Progress derivation is 100% client-side from the existing progress store (done flags
  + t/d per youtube_id). No new progress backend.
- All styling in VideosSection.module.css / a new PathView.module.css — house language
  (quiet, YouTube-adjacent), 640/1024 only, UIcon only, 44px targets, rails/rows
  contained (no page horizontal scroll).

### Constraints (inherited, LOCKED)
VideoDockSlot first child; playback only via videoStore.play(list, index); ?v= deep link
once-per-mount untouched (?path coexists; ?v wins the autoplay); search/?cat flat-grid
behavior unchanged; `/` shortcut + Esc untouched; useScrollEdges contentKey stays in deps.

## Track 2 — Curriculum Blueprint (owner-gated content plan)

### Canonical curriculum skeleton (from the firm's own system; agents refine, don't invent)
M1 Foundations & Market Structure · M2 Market Regime & Exposure (UCT 0-150, distribution
days, phases) · M3 Breadth & Internals · M4 Relative Strength & Leadership · M5 Scanning
& Watchlist Building · M6 The Setup Playbook (24 setups / 4 families) · M7 Entries &
Execution · M8 Risk & Position Sizing (Account Risk % = Position Size % × Stop Distance %,
max 2%, regime-adjusted) · M9 Trade & Portfolio Management · M10 Psychology & Discipline ·
M11 Options & Flow · M12 Review Process & Journaling.

### Pipeline (workflow over existing classifier batches — tools/taxonomy_out/batches/)
1. **Per-video curriculum assessment** (15 batch readers): for every video —
   `{id, modules_taught:[M#…], depth: intro|core|advanced, format_quality:
   structured_lesson|stream_segment|reference, one_line_fit}`.
2. **Synthesis** (barrier): (a) **flagship course** "UCT Foundations" — modules →
   ordered lessons from existing videos (structured lessons preferred; streams only
   where nothing better exists, flagged); (b) **topic tracks** (~4-6: Setups Mastery,
   Risk & Sizing, Options & Flow, Psychology, Market Reading, +as warranted);
   (c) **verdict on each of the six existing paths** — keep/merge/retire/rebuild with
   reasoning; (d) **gap list** — every module slot with no adequate existing video.
3. **Recording briefs** (per gap): title, 5-8 talking points grounded in the firm's
   actual vocabulary (setup names from setupCatalog, sizing formula, exposure model),
   target length, depth level, course placement, suggested order.
4. **Schedule**: weekly recording calendar (owner cadence TBD in review; default
   1 lesson/wk, flagship gaps first), as a table the owner can follow.
5. **Owner review artifact** (same loop as the taxonomy): full structure, every
   slotted video with reasoning, every gap brief, the schedule. NOTHING applies to
   production paths until explicit approval; then `paths-apply` ships it in one call.

### Rollout order
Code (Track 1) ships first seeded with the CURRENT six paths → zero member-visible
content change. Curriculum applies only after owner approval of the artifact.

## Testing
Service/router tests per new table + endpoints (incl. paths-apply transactionality +
auth tiers + FK cascade); frontend tests for PathView (progress math, resume target,
module grouping, admin gating, URL state), landing cards, continue-strip; existing
landing/playback tests stay green; mobile audit /desk clean; live DOM verify post-deploy.

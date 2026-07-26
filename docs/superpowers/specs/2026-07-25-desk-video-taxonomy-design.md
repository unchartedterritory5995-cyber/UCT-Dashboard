# The Desk — Video Taxonomy Restructure + Landing Redesign

**Date:** 2026-07-25
**Status:** Approved by owner (structure, taxonomy depth, review gate, visual scope confirmed via Q&A)
**Scope:** THE DESK → Videos section only. The theater/player experience (VideoDockSlot,
GlobalVideoLayer, chapters/recap/tickers/notes/transcript rails, background audio,
scroll-to-theater) is explicitly OUT of scope and must not change.

## Problem

The 295 videos in `edu_videos` are grouped by a free-text `category` column that mixes
two different kinds of content:

1. **Evergreen education** — ~13 topic categories bulk-imported 2026-06-19/20
   (The Mental Game 39, Interviews 35, Workshops & Fireside Chats 29, Market Analysis &
   Breadth 24, Options & Flow 24, Setups & Strategies 23, …). Assignments were never
   validated against actual content.
2. **Recurring shows** — auto-published Zoom recordings whose *webinar name* becomes the
   category verbatim (`desk_daily_session._route`). This produced the flagship
   "Live Trading Sessions" (20) but also a legacy duplicate "Live Sessions" (31), and six
   junk one-video categories ("Tonight", "Daily Sessions", "Market thoughts w/ Bracco &
   BucketHead", "Thoughts on the mkt TSDR", "Workshop with ChartMaster", "Workshop with Zen").

Category display order is doubly defined: the API returns categories alphabetically and
`VideosSection.jsx` re-sorts with a hardcoded `CATEGORY_ORDER` list that is out of sync
with the auto-publish names — so the flagship live sessions sort at the bottom of the page.

The landing page is a flat dump of category sections; the owner wants a curated,
aesthetic browse experience. The playing/theater experience is liked as-is.

## Decisions (owner-confirmed)

- **Shows + Library split.** Recurring date-based recordings stay chronological under
  their show identity ("Live Trading sessions can be called live trading sessions").
  Evergreen content is topic-organized from transcript analysis.
- **The Mental Game is a Show** (branded episodic series), not a Library category.
- **Library = categories + tag filters.** One primary category per video; controlled tag
  vocabulary (~25 tags) as filter chips.
- **Review-before-apply.** The full 295-row old→new mapping is reviewed by the owner
  before anything is written to production categories.
- **Visual scope = landing page only.** Theater untouched.

## Target taxonomy (draft — final list emerges from the transcript pass + owner review)

**Shows** (kind=`show`, chronological, newest first):

| Show | Sources folded in | Est. count |
|---|---|---|
| Live Trading Sessions | current 20 + legacy "Live Sessions" 31 + "Daily Sessions" 1 | ~50 |
| The Mental Game | current 39 | 39 |
| Post-Market Recaps | current 10 | 10 |
| Thoughts on the Market | current 3 + "Tonight" + "Bracco & BucketHead" + "TSDR" singletons | ~6 |
| Evening Update | (route exists; 0 rows yet) | 0 |

**Library** (kind=`library`, curated order): Mindset & Psychology · Market Analysis &
Breadth · Setups & Strategies · Risk & Trade Management · Scanning & Stock Selection ·
Options & Flow · Interviews · Workshops & Fireside Chats (+ ChartMaster/Zen singletons).
"Technical Analysis & Relative Strength" (7) likely merges into Setups/Market Analysis
based on transcript content.

**Tags:** controlled vocabulary across dimensions: setup names (from the `setups`
column), format (lesson / workshop / interview / stream), level (starter / intermediate /
advanced), and themes (psychology, risk, breadth, options, scanning, …). Cap ~25;
the consistency pass consolidates synonyms.

## Classification pipeline

1. **Transcript gap-fill (local, $0).** 21 videos lack transcripts; all but at most one
   have 96k AAC in R2 at deterministic key `desk_audio/<youtube_id>.m4a` (7/25 backfill).
   Download from R2 (local `DATA_SYNC_*` creds), transcribe with faster-whisper
   `base.en` int8 on CPU (segment-level, no word timing), render the load-bearing
   `[h:mm:ss] text` block format (mirror `_timestamped_block`, keep the 600k-char cap),
   POST via existing `POST /api/education/videos/{id}/insights-store` (PUSH_SECRET +
   browser User-Agent — Cloudflare blocks raw curl UAs). Model chapters/headline via the
   same `generate_insights` path used by `scripts/backfill_video_insights.py`.
   Gap enumeration: sweep `GET /videos/{id}/transcript-cues` across all ids — the
   `/insights-backfill/pending` endpoint misses "chapters-but-no-transcript" rows
   (ids 60, 267 confirmed).
2. **Dump.** Export all 295 rows (id, youtube_id, title, description, category,
   duration, created_at, chapters, summary, setups, ticker_moments) via a read-only
   `railway ssh` query; pull transcripts per id via `transcript-cues` (PUSH_SECRET).
   Store locally as JSON for the classification workflow.
3. **Multi-agent read.** A workflow reads every transcript and proposes per video:
   `{zone: show|library, show_or_category, tags[], confidence, reasoning}`.
   Show-zone videos keep chronology; classification only decides *which* show for the
   fold-ins (e.g. each legacy "Live Sessions" row → Live Trading Sessions vs elsewhere).
4. **Adversarial verify.** Every low-confidence or category-*changing* assignment is
   re-read by an independent verifier; a consistency pass normalizes the tag vocabulary,
   checks category balance, and finalizes the category list (incl. the TA&RS merge call).
5. **Review artifact (OWNER GATE).** Private artifact page: all 295 rows, old → new +
   tags + one-line reasoning, grouped by proposed category with counts and flags for
   every category change. Nothing is applied until the owner approves.
6. **Apply.** Backup `/data/education.db` on Railway (timestamped copy on the volume),
   then a one-shot local script PATCHes category (admin API) and writes tags. Progress /
   notes / deep links key on `youtube_id` and are unaffected. Seeds only insert missing
   `youtube_id`s, so recategorization is never clobbered on boot.

## Backend changes (additive)

- **`edu_categories` table:** `(name TEXT PK, kind TEXT CHECK(kind IN ('show','library')),
  sort_order INTEGER, blurb TEXT, created_at INTEGER)`. Seeded from the final taxonomy.
  Categories present in `edu_videos` but missing here are appended at the tail (kind
  inferred `show` if created by auto-publish, else `library`) so the system never hides
  a video.
- **`tags` column** on `edu_videos` (TEXT JSON array, nullable, via `_EXTRA_COLUMNS`).
- **API:** `GET /api/education/videos` response becomes
  `{categories:[{name, kind, sort_order, blurb, videos[]}], total}` — ordered
  server-side by `(kind, sort_order)`. Additive fields; `name`/`videos` unchanged for
  back-compat. Videos gain `tags` in the payload.
- **Frontend `CATEGORY_ORDER` is deleted** — server order is the single source of truth.
- **Auto-publish hardening** (`desk_daily_session._route`): normalize case/whitespace;
  alias table maps webinar-name substrings to canonical shows ("live trading"/"daily
  session" → Live Trading Sessions; "thoughts on the m"/"market thoughts" → Thoughts on
  the Market; "post market"/"post-market" → Post-Market Recaps; "evening update" →
  Evening Update (existing host-aware title kept); "workshop" → Workshops & Fireside
  Chats). Unknown names still auto-create a section (owner-liked behavior) but now also
  insert an `edu_categories` row (kind=show, tail order) so it renders ordered, and the
  existing publish Discord notification already surfaces it.
- **Admin category ops:** `POST /api/education/categories/rename {from, to}` (updates
  `edu_videos` rows + `edu_categories`, admin-only). Reorder/blurb edits via a simple
  `PATCH /api/education/categories/{name}`.

## Landing page redesign (`VideosSection.jsx`)

Kept exactly as-is: `VideoDockSlot` first (theater + pinning contract), search, deep-link
`?v=` autoplay, `videoStore.play()` as the only playback entry point, progress store,
admin add/edit/delete, Discussion links.

New layout below the dock slot:

1. **Hero** — latest Live Trading Session (or most recent show episode): recap poster
   (`/videos/{id}/poster`) as the backdrop, headline, date, Play/Resume CTA. Falls back
   to YT thumb when no poster.
2. **Continue Watching** rail (existing logic, restyled).
3. **Shows** — one horizontal episode rail per show with poster-style cards
   (poster > YT thumb, date, headline subtitle, duration pill, progress bar).
   "View all →" expands that show into a chronological grid (client-side state).
4. **Library** — tag filter chips (from the controlled vocabulary + counts), then one
   block per category: header (icon via UIcon, blurb, count) + card grid. Selecting a
   tag filters all Library grids; selecting a category chip focuses it (existing chip
   behavior generalized).
5. **Learning Paths** kept, restyled to match the rail language.

Styling: existing tokens only (gold eyebrows, `--bg-surface` cards, 12px radius, pill
chips, Instrument Sans, 44px tap targets, 640/1024 breakpoints). New rules live in
`app/src/pages/desk/VideosSection.module.css`; the theater-era classes stay in
`EducationalVideos.module.css` untouched to avoid disturbing dock styling. Search spans
Shows + Library (flat result grid, as today). Rails use the house pattern
(flex + overflow-x auto) with snap points; phone keeps 2-col grids for Library.

## Constraints / invariants

- One player entry point (`videoStore.play`); `VideoDockSlot` stays mounted first in the
  section; never let React write `transform` on the video host.
- `?v=<youtube_id>` deep link fires once per mount — preserved.
- Progress/notes key on `youtube_id`; recategorization never rewrites `youtube_id`.
- The stored transcript format `[h:mm:ss] text` is load-bearing for ticker backfill and
  the transcript panel — the whisper gap-fill must emit exactly that.
- Web deploys ≥4:20 PM ET or <9:15 AM ET only (pre-push hook).
- Shared-repo hygiene: explicit-path commits only, ship via
  `git push origin feat/desk-taxonomy:master` after rebase; never `git add -A`.
- Data apply happens *after* the code deploy (new API tolerates old data: rows whose
  category lacks an `edu_categories` entry render at the tail).

## Testing

- Backend: education_service tests for `edu_categories` CRUD/ordering/rename, tags
  round-trip, `_route` alias table, payload shape.
- Frontend: VideosSection tests updated for hero/rails/library rendering, tag filter,
  server-order rendering (CATEGORY_ORDER removed), existing playback/progress/deep-link
  tests stay green.
- Classification: spot-check sample + full adversarial verify pass inside the workflow;
  the owner review artifact is the final gate.
- Live verification post-deploy: real DOM check on uctintelligence.com (admin account),
  phone + desktop breakpoints.

## Rollout order

1. Transcript gap-fill (prod-additive, invisible except transcripts appearing).
2. Classification workflow → review artifact → **owner approval**.
3. Code: schema + API + landing redesign in `feat/desk-taxonomy` worktree, tests green.
4. Deploy in allowed window; verify.
5. Backup education.db → apply mapping (categories + tags) → verify live grouping.
6. Update seeds' category strings opportunistically? NO — seeds only insert missing
   youtube_ids; leave seed files alone to avoid churn.

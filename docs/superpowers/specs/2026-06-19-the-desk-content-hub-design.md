# The Desk — Unified Content Hub (design)

**Date:** 2026-06-19
**Status:** approved (brainstorm), implementing

## Summary
One new **paid + admin** tab, **The Desk** (`/desk`), consolidating the firm's
first-party content into four sub-sections: **Videos · Articles · Posts · Team**.
Replaces the standalone Educational Videos nav entry; `/educational-videos`
redirects to `/desk`.

## Access
Whole tab paid + admin (reuses Educational Videos gating). Left out of
`FREE_PAGES` in NavBar / MoreSheet / AuthGuard. New `desk` UIcon glyph (no emoji).

## Sections

### Videos
The existing Educational Videos library, moved in unchanged. The page component
is extracted to `app/src/pages/desk/VideosSection.jsx`; backend + admin UI
(`/api/education/*`, `education.db`) are untouched. `EducationalVideos.jsx`
becomes a thin re-export so existing tests/imports keep working.

### Articles (Substack) — new
- **Store:** `api/services/desk_store.py` → SQLite `/data/desk.db`:
  - `substack_publications(id, name, feed_url, enabled, sort_order, added_at)`
  - `substack_posts(id TEXT PK = guid/url, publication_id, title, excerpt, url,
    hero_image, author, published_at, ingested_at)`
- **Poller:** `api/services/substack_poller.py` — fetch each enabled publication's
  RSS (`/feed`), parse with stdlib `xml.etree` (same approach as
  `news_aggregator`), upsert posts deduped on guid/url. Best-effort per feed
  (one bad feed never kills the run).
- **Presentation:** link-out cards (hero image, title, excerpt, author, date) →
  open the post on Substack in a new tab. No inline reading.
- **Schedule:** APScheduler hourly, gated `SUBSTACK_ENABLED=1`. Free (no API cost).

### Posts (official Twitter) — extends existing system
- Add `is_official INTEGER DEFAULT 0` column to `twitter_accounts` (ALTER +
  try/except migration) + `set_account_official()` + `feed(official_only=True)`.
- `GET /api/tweets/feed?official=1` → chronological tweets from official-flagged
  accounts only. The existing market-news tape on the dashboard is untouched.
- Admin toggles "Official" per account in the existing `/admin` Twitter panel.
- No new polling cost — accounts already polled by the existing pipeline.

### Team (Meet the Team) — new
- **Store:** `team_members(id, name, role, bio, photo_ext, twitter_url,
  substack_url, email, link_url, sort_order, enabled, created_at, updated_at)` in
  the same `/data/desk.db`.
- **Photos:** uploaded server-side, Pillow→WebP to `/data/team_photos/{id}.webp`
  (mirrors `avatar.py`). Served public at `GET /api/desk/team/{id}/photo`.
- **Presentation:** grid of member cards (photo, name, role, bio, optional
  Twitter/Substack/email/link). Admin add/edit/delete/reorder + photo upload.

## Backend wiring
- `api/routers/desk.py` — paid reads (`/articles`, `/team`) + admin CRUD for
  publications, team, and photo upload/serve. Local `require_paid` dep
  (pro/premium/lifetime + admin).
- `main.py`: include `desk` router; init `desk_store._init_db()` in lifespan;
  hourly substack poll job (gated). Preserve the `broker_sync` invariant
  (`grep -c broker_sync api/main.py >= 7`).

## Frontend
- `app/src/pages/desk/Desk.jsx` (+ `Desk.module.css`) — shell + sub-tab bar
  (Videos/Articles/Posts/Team), active section persisted (localStorage + `?section=`).
- `VideosSection.jsx` (extracted), `ArticlesSection.jsx`, `PostsSection.jsx`
  (reuses `useTweetFeed` with an `official` option), `TeamSection.jsx`.
- Custom gold SVG icons (extend `pages/education/icons.jsx`); `desk` glyph added
  to the shared `UIcon` set.
- Nav: `/desk` "The Desk" replaces the Educational Videos entry in NavBar +
  MoreSheet + MobileNav title map. `/educational-videos` → redirect to `/desk`.

## Tests
- BE `tests/test_desk.py`: desk_store substack CRUD + post upsert/dedupe; team
  CRUD; substack RSS parse from a sample XML string; tweets `official` filter.
- FE `Desk.test.jsx`: sub-tab render + section switch + admin gating.

## Out of scope (YAGNI)
No inline article reading, no mixed chronological feed, no comments/likes, no
in-app publishing, no per-section access tiers, no team-photo cropping UI.

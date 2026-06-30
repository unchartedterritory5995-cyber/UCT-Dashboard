# Evening Update from TSDR — design

**Date:** 2026-06-29
**Status:** approved (thumbnail B · Editorial Dusk picked; website link; reuse existing `DISCORD_WEBHOOK_URL`)

## Goal

Add a new daily show, **"Evening Update from TSDR"**, to the existing Live Trading
Sessions auto-publish pipeline. A Zoom webinar named *Evening Update from TSDR*
auto-records → uploads to YouTube unlisted → gets a distinct **branded evening
thumbnail** → publishes to **The Desk → Videos → "Evening Update"** → posts a
**Discord announcement** with a link to the website. Zero per-episode effort, by
name — exactly like Live Trading Sessions. The operator owns the Zoom template.

## Approach

Extend, don't rebuild. Everything routes through the proven
`desk_daily_session.process_pending_jobs` flow. Four small additive changes:

### 1. Thumbnail — new "evening" theme + layout (`api/services/desk_thumbnail.py`)
- New `_EVENING_THEME` (navy→dusk gradient, gold accents, `layout="evening"`) +
  `_THEMES["evening"]`.
- `_resolve_theme` returns it when the eyebrow contains `"evening"` (mirrors the
  existing `"thought"` → emerald rule). Explicit `variant="evening"` also works.
- New `_render_evening(theme, date_text, eyebrow_label)` — the approved
  "Editorial Dusk" layout: 2× super-sampled, twilight navy card (cool light
  upper-left, warm dusk lower-right), gold **THE EVENING BRIEFING** kicker pill,
  metallic-gold auto-fit headline (eyebrow with "FROM TSDR" stripped) on a gold
  spine, `FROM TSDR · {DATE}` subline, a glowing gold candlestick uptrend on the
  right, compass mark + locked tagline. Reuses the existing `_draw_uptrend`,
  `_gradient_bg`, `_radial`, `_vignette`, `_compass`, `_balanced_two_lines`,
  `_tracked*` helpers.
- `render_session_thumbnail` dispatches `layout == "evening"` → `_render_evening`.

### 2. Routing (`api/services/desk_daily_session.py`)
- Add a `_RULES` entry **before** the auto-derive fallback:
  `("evening update", "Evening Update", "Evening Update", "EVENING UPDATE FROM TSDR")`
  → section **"Evening Update"**, title prefix **"Evening Update"**, thumbnail
  eyebrow **"EVENING UPDATE FROM TSDR"** (which trips the evening theme).
- Result: a Zoom webinar named "Evening Update from TSDR" → video titled
  `Evening Update — {Month D, YYYY}` in the "Evening Update" section with the
  evening thumbnail.

### 3. Website section (no code beyond the route)
- `category = "Evening Update"` is a free-form `edu_videos.category` — the Videos
  tab derives sections dynamically, so it appears automatically.
- Cosmetic: add `'Evening Update'` to `CATEGORY_ORDER` in
  `app/src/pages/desk/VideosSection.jsx` so it sorts near the other show sections.

### 4. Discord announcement (`_notify_published`)
- Today `_notify_published` already posts to `DISCORD_WEBHOOK_URL` with a "Open
  The Desk" link — but its header is hardcoded "Live Trading Session" and it shows
  no image. **Generalize it** (improves every show, incl. Live Sessions):
  - header/text uses the actual show name (derived from the published `title`),
  - embed shows the **YouTube thumbnail** (`https://i.ytimg.com/vi/{id}/maxresdefault.jpg`),
  - keeps the website link (`https://uctintelligence.com/desk?section=videos`),
  - pass the `section` through so the body reads "→ Videos → {section}".
- Reuses the existing `discord_notify._send_webhook` and the single
  `DISCORD_WEBHOOK_URL` (operator chose to reuse, not add a separate webhook).

## Out of scope / non-goals
- No separate public webhook env var (operator chose to reuse the existing one).
- No new DB tables, no schema change (category is free-form text).
- No allowlist change — the pipeline still auto-posts every cloud recording by name.

## Risks / invariants preserved
- Thumbnail render stays **non-fatal** (try/except in the processor) — a bug in
  `_render_evening` can never break a publish.
- `_notify_published` stays **best-effort** (never raises).
- Idempotency unchanged (queue PK + `youtube_id` dedup).
- Live Trading Sessions + Thoughts on the Market routes/thumbnails untouched.

## Tests
- Thumbnail: `render_session_thumbnail(date, "EVENING UPDATE FROM TSDR")` returns
  non-empty JPEG bytes; `_resolve_theme` picks the evening layout; explicit
  `variant="evening"` works.
- Route: `_route("Evening Update from TSDR")` == `("Evening Update", "Evening
  Update", "EVENING UPDATE FROM TSDR")`; Live/Thoughts/empty routes unchanged.
- Notify: `_notify_published` builds an embed whose image URL contains the video
  id and whose text contains the show name + section (monkeypatch `_send_webhook`).
- Frontend build stays green.

# The Floor — In-Dashboard Community & Mentorship Space

**Date:** 2026-07-09
**Status:** Design approved by owner (section-by-section), awaiting spec review
**Route:** `/community` (display name "The Floor" — working label, owner may rename; route is stable)

## 1. Purpose & positioning

A native, members-only community space inside the UCT Intelligence dashboard: Reddit-style
threaded discussion led by a visually distinct mentor voice, with UCT's educational content
(The Desk) seeding the conversation. Long-term home for the community — the existing Discord
is not bridged in; members are migrated over time.

**Decisions made during brainstorming:**

- **Native build** (Approach A), not a Discord bridge and not a hosted product (Circle/Discourse).
  Community inside the subscription wall is a retention feature; canceling means losing the room.
- **All members can post; mentor leads.** One mentor account (owner) with a visually distinct
  voice. No broadcast-only model, no tiered cohorts in v1.
- **Threads first, chat later.** V1 is async threaded discussion. Live market-hours chat is v2.
- **The Desk stays the library; the community is the room.** No second content system. Desk
  publishes seed discussion threads automatically (see §4). Mentor's original teaching posts are
  pinned threads, not a CMS.

## 2. Spaces & data model

### Spaces (fixed, defined in code — exactly four at launch)

| Space | Thread creation | Purpose |
|---|---|---|
| **Mentor Desk** | Mentor only | Lessons, trade breakdowns, homework; auto-seeded daily session threads. Members reply only. |
| **Trade Ideas** | All members | Setups, tickers, charts. Ticker tags link to `/charts/{ticker}`. |
| **Questions & Reviews** | All members | "Grade my trade," process questions. Mentor can mark threads **Answered** (✓). |
| **Wins & Lessons** | All members | Post-trade reflections, green and red. |

Spaces are not user-creatable. Adding one later is a code change.

### Storage

`/data/community.db` — SQLite, WAL mode, house pattern (same shape as `auth.db`).
New service module `api/services/community_db.py` + router `api/routers/community.py`.

### Tables

- **threads** — `id`, `space`, `author_id`, `title`, `body` (markdown), `ticker_tags` (JSON),
  `pinned`, `locked`, `answered`, `desk_content_id` (nullable — Desk seed key), `deleted`
  (soft), `created_at`, `last_activity_at`
- **posts** — `id`, `thread_id`, `author_id`, `parent_post_id` (nullable — **one level of
  nesting only**, no infinite trees), `body`, `mentor_highlight`, `deleted` (soft),
  `created_at`
- **reactions** — `post_id`, `user_id`, `kind` (small fixed set; custom on-brand gold SVG
  icons per the no-generic-emoji rule)
- **reports** — `id`, `post_id`/`thread_id`, `reporter_id`, `reason`, `status`
  (`open`/`hidden`/`dismissed`), `created_at`
- **read_state** — `user_id`, `thread_id`, `last_seen_post_id` — powers unread badges

Identity from existing auth (display name + avatar); `is_mentor` flag on the owner's account.
No anonymous posting.

### Deliberately excluded from v1

Upvote ranking/sorting (recency + pins suffice), DMs, user-created spaces, deep nesting,
edit history, search (v2).

## 3. Mentor tools

All gated by `is_mentor`:

- **Badge:** gold "UCT Mentor" chip on name + subtle gold left border on mentor posts.
- **Pin / lock** threads per space.
- **Highlight a reply** in any thread — marks it as the mentor take and floats it directly
  under the original post. Core mentorship mechanic.
- **Mark Answered** on Questions & Reviews threads.

## 4. Desk seeding (the auto-heartbeat)

- The existing Zoom → YouTube → Desk publish pipeline gains one final step: on session-recap
  publish, create a Mentor Desk thread — title from session date + recap headline; body from
  the polished recap bullets (existing `polish_recap` output); video renders via the existing
  mini-player embed.
- Education videos and workshops seed threads the same way on publish.
- **Idempotent by `desk_content_id`** — republish/repolish updates the thread in place, never
  duplicates (same discipline as calendar `external_id` keying).
- Desk content pages get the reverse link: "Discussion (n) →" into the thread.

## 5. Member experience & UI

- **Placement:** top-level nav item → `/community`.
- **Layout:** left rail (4 spaces + unread badges, Mentor Desk first) · main column (thread
  list: pinned-with-gold-pin first, then newest activity; rows show title, author+avatar,
  ticker chips, reply count, last activity, ✓ if answered) · thread view (OP, one-level
  nested replies, highlighted mentor reply floated to top, sticky composer).
- **Composer:** TipTap (as shipped in Notebook; use the latest-callback-ref pattern —
  `onUpdate` stale-closure gotcha). Bold/lists/links, image paste, `$TICKER` autocomplete
  rendering chips that link to `/charts/{ticker}`.
- **Images:** v1 ships chart-screenshot upload — images only, size-capped, stored to the
  existing R2 bucket.
- **Mobile:** left rail collapses to a space-switcher header; layout via CSS media queries,
  **not** `useMediaQuery` (first-paint gotcha).
- **Visual language:** existing dark theme + gold tokens + Instrument Sans; custom gold SVG
  reactions. Must feel native to UCT, not a bolted-on forum.
- **Notifications (v1):** unread-count badge on the nav item + in-page "replies to you"
  indicator. No email/push in v1.

## 6. Moderation, safety & compliance

- **Report** button on every post/thread → Community queue in the existing `/admin` page:
  item, reporter, reason; one-click hide/dismiss.
- **Soft-delete everywhere** — hidden content shows "removed by moderator"; data retained.
- **Member mute** — admin flag: can read, cannot post. No billing entanglement.
- **API rate limits** — threads/hour and posts/hour per member; kills spam floods.
- **Sole moderator in v1:** the owner. Trusted-member mod tools are v3.
- **Compliance:**
  - One-time first-visit acknowledgment: posts are member opinions, not financial advice,
    performance claims unverified. Stored per user; standing disclaimer in page footer
    thereafter. **Open item (owner):** wording pass by whoever reviewed the existing
    Terms/disclaimer page.
  - No broker-data auto-attach ever. Any future "share from Journal" shares only what the
    member explicitly composes (broker-mirror-fidelity principle).
- **Excluded from v1:** automated content filtering, block-user, DM abuse surface (no DMs).

## 7. Phasing & launch

### V1 — "The room opens" (this build)

Everything above, behind a **`COMMUNITY_ENABLED`** env flag (check Railway vars before
adding, per standing rule). Deploy dark.

**Launch sequence:**

1. Dark deploy. Seed Mentor Desk: backfill ~2 weeks of session threads from existing recaps,
   3–5 original mentor posts, pinned "Welcome to the Floor" rules thread.
2. Flip the flag; announce in the morning Wire + on the dashboard.
3. First month: mentor engages daily — the auto-seeded session thread guarantees one post a
   day; highlight and answer everything early. Communities take the shape of their first
   hundred threads.

### V2 — "Market hours"

Live chat lane (single market-hours room; likely existing SSE infra — mind the
single-process constraint from the 524 incident), email/push digests, upvotes + sorting if
volume warrants, thread search.

### V3 — only if earned

Trusted-member moderators, mentorship cohorts / tiered spaces, explicit-compose "share to
community" from Journal, culture features (leaderboards etc.) if tone supports them.

## 8. Testing & shipping

- Vitest component tests per house pattern.
- API permission tests: member cannot pin/lock/highlight; muted member cannot post;
  Mentor Desk rejects member-created threads; rate limits enforced.
- Seed idempotency test: double-publish of same `desk_content_id` yields one thread.
- Build in an isolated worktree; ship via `push origin <branch>:master`.
- Deploy outside 9:15 AM–4:20 PM ET (LiveFlow window); `grep -c broker_sync api/main.py` ≥ 7
  before push.

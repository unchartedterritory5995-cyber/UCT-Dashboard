# #tsdr video lessons — library v2 (owner decisions 2026-10-18)

The lesson archive (`api/services/tsdr_lessons.py`) works: every video file or
YouTube link Patrick or Bracco shares in #tsdr / #bracco becomes a recap post in
one of five section threads, with the video and a link to the original, and an
unlisted YouTube copy on Desk > Videos. This is the second pass the owner asked
for: easier to browse, less clutter, better recaps. Declined by the owner: a
"Start Here" pin and a weekly roundup post.

## What ships, in three pull requests

### PR 1 — the recap gets richer (`feat/tsdr-lessons-recap-v2`)
* **Level.** Every recap carries `level` ∈ beginner / intermediate / advanced
  (the model picks; default intermediate). Stored in `tsdr_lessons.level`.
* **Key moments.** The model names 2–3 moments, each as an exact short quote
  from the transcript plus a 3–7 word label. The quote is located in the
  transcript and turned into a time: from the transcription's part offsets
  (`segments`, one per 5-minute Whisper part) when the video was transcribed
  here, else proportionally by position (clearly approximate). A lesson with a
  YouTube copy or link gets a seek link (`?t=`); a Discord-forwarded video shows
  the time only. Shown in the embed, the YouTube description and (PR 3) as
  chapters on Desk > Videos.
* **Duplicates.** Before posting, a transcript is compared with every posted
  lesson by the same speaker (word 5-gram Jaccard ≥ 0.8). A repeat is recorded
  as `status='duplicate'`, `duplicate_of=<attachment id>` and is NOT posted.
* **Clips stay off the website.** `run_youtube` skips `section='clips'`
  (`is_lesson` false). Rows already on the TSDR Lessons shelf for clips are
  removed from the library once (`remove_clips_from_library`); the unlisted
  YouTube videos stay.

### PR 2 — a Forum channel replaces the five threads (`TSDR_LESSONS_FORUM_ENABLED`)
* The bot creates (or finds by name) a FORUM channel under EDUCATION, members
  read-only, with tags for the five sections, the three levels and the two
  speakers. One forum post per lesson: the title is the post name, the starter
  message is the recap embed (search line + key moments + "See also"), the
  video forward / YouTube link follows inside the post. `applied_tags` carry
  section + level + speaker, so Discord's own tag filter and sort do the
  browsing.
* **Migration.** Lessons already in the threads are re-posted into the forum
  oldest first, N per tick; a duplicate found on the way is recorded, not
  posted. The old #video-lessons channel is left for the owner to delete.
* **Index.** One pinned forum post, "Index", whose thread holds one embed per
  section listing every lesson as `• [title](post link) · Mon D` — edited in
  place when anything changes, split across messages past 4,096 characters.
* **See also.** Each post ends with up to 3 related lessons (3×shared ticker +
  2×shared tag + 1×same section; clips excluded). Refreshed for a lesson when
  its `related_at` is older than 30 days, so early posts gain links as the
  library grows.
* **✏️ = rewrite.** Each tick the bot checks a rotating slice of posts for a ✏️
  reaction from Patrick or Bracco; a marked lesson is rewritten from its stored
  transcript (no re-download), the old post deleted, a new one made. Deleting
  a post by hand still means "not this one".

### PR 3 — Desk > Videos mirrors the sections
* Five library categories ("TSDR Lessons · Setups & Entries", …) replace the
  single shelf; existing rows are moved once. Video tags gain the section and
  the level (so the existing Filters chips work). Description = recap +
  takeaway + key moments; key moments also go in as chapters
  (`set_video_insights(chapters=[{t, title}])`), which the player's scrubber
  already draws.

## Owner steps
Merge each PR (`gh pr merge N --merge`). After PR 2: set
`TSDR_LESSONS_FORUM_ENABLED=1` on web; if the bot cannot create channels, create
a Forum channel named `lesson-library` under EDUCATION (it finds it by name).
Delete the old #video-lessons channel once the migration count reaches zero.

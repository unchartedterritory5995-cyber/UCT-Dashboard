# Study feedback loop — review from the quiz, from Discord, then ingest

Owner, 2026-10-21: "lets build a system for reviewing in site or in the discord and giving
feedback for the quiz and test so we can manually do this and ingest and update the
information."

The review used to be one item at a time on the admin screen (or screenshots in chat). Now
the quiz itself is a review door, Discord is a second one, and everything said lands in one
table that the session carries into the save file.

## The three doors

**1. The reveal card (site).** After every answer, under the lesson, a link reads
*Something off?* (for an admin: *Review this one*). It opens a row of chips — Wrong answer ·
Chart is bad · Question unclear · Lesson unclear · Too easy · Too hard · Great example ·
Other — an optional note, and Send. The card also prints the item's short ref
(`ref 872a0a`), the six characters a note from Discord names. The six-part lesson
(shape / story / where / confirm / cancel / desk) now renders with headings on the card,
so the lesson is reviewed where the member reads it.

An admin's card carries a second row: **Approve · Needs fix · Reject**. Approve publishes
the item on the spot, Reject retires it, Needs fix leaves a note for the next build. A
member's row never carries a verdict (a verdict sent by a member is dropped server-side).

Route: `POST /api/study/items/{id}/feedback` `{kind, text?, attempt_id?, verdict?}`
(`api/routers/study.py`). The attempt is attached only when it belongs to the same member
and item, so the row records what they answered and whether they were right.

**2. `/study` in Discord.** `/study ref:872a0a say:the lesson never says where the stop goes
[verdict:approve|fix|reject] [kind:...]`. Admin-only twice: `default_member_permissions: 8`
at registration, and the handler reads the administrator bit off the invoking member. The
reply is private and names the item (subject, ticker, date, ref) and what was applied.
Handler: `study_feedback_reply` in `api/routers/discord_interactions.py`; command:
`build_study_command` in `api/services/discord_interactions.py`.

Registering the command (one-shot, local, needs the bot token in `.env`):

    python tools/discord_chart_commands.py register

**3. The review screen.** `/admin/pattern-review?mode=study` has a **Feedback (n)** button
beside *Example gallery*. The panel lists every open row with the item (ticker, date,
subject, the question), the kind, the note, who said it through which door, the verdict,
and what they answered. *Open* selects the item in the queue when it is a draft; *Handled*
clears the row; *Show handled* brings them back; *Export feedback* downloads the JSON the
ingest reads. Queue rows show `· 2 notes` when an item has open feedback.

## The table

`study_feedback` in `/data/study.db` (`api/services/study_store.py`): item, version, who
(`user_id`, `role` owner|member, `channel` site|discord|review), `kind`, `text`, `verdict`,
`answer_json` + `correct` + `attempt_id` when known, `handled_at/by/note`, `at`. The store's
`add_feedback` applies an owner approve / reject through `review()`, so it is logged in
`study_corrections` like a screen verdict (`reason` = `discord feedback #12 · bad chart: ...`).

Admin routes: `GET /api/study/admin/feedback?unhandled=1`, `POST /api/study/admin/feedback/handle`
`{ids, note}`, `GET /api/study/admin/feedback/export?since_id=N`. The queue response
(`GET /api/study/admin/review`) carries `feedback.open` per item.

## Ingest (the session's job)

1. Save the export under `docs/study/feedback/exports/<date>.json` (the panel's *Export
   feedback* link, or the route above from the logged-in tab).
2. `python -m scripts.study.ingest_feedback` writes
   * `docs/study/corrections/feedback.jsonl` — one standard verdict record per OWNER row with
     approve / reject (the shape `scripts/study/corrections.py` applies on regeneration, with
     `feedback_id` for idempotence), so the bank keeps what the pod already applied;
   * `docs/study/feedback/REPORT.md` — every open row grouped by item with the question, the
     note, who said it, the verdict, what they answered: the session's worklist.
3. Act on the report: fix the lesson in `docs/study/terms/candle_lessons.json` (or the
   generator / corrections for other segments), replace a bad chart, re-run
   `scripts.study.run_all`, import, then mark the rows handled on the screen (or through
   the handle route) so they leave the report.

A member's "wrong answer" is never applied by itself; it is a flag for the session to check
against the catalog. A member's "great example" is read as "keep this one" when examples
are pruned.

## Notes on a whole screen, and the review hub (owner 2026-10-21)

The owner asked to review "the overall layout and visual and effects and interactive and
learning and everything", not only single questions. Two more doors, both admin-only:

- **Feedback on this screen.** A small button on every Study screen: the Courses landing,
  the skill trail, the practise sheet, the quiz (its top bar names the question, the reveal
  or the end card it was left on), the review screen, the example gallery and the lesson
  reading view. One tap says what the note is about (layout, visuals, effects, how it works,
  teaching, broken, great, other), plus a note. What the screen was showing rides along as
  `context` (the item id and question number in the quiz, the open unit on the trail).
  `POST /api/study/admin/screen-feedback`. It is a `study_feedback` row with `screen` set
  and an empty `item_id`: it never counts against an item (`feedback_counts()["open"]`) and
  is never applied; it shows in the review screen's Feedback list marked "Screen · ...",
  with a scope select (everything / on questions / on screens).
- **The review hub** (review screen → "Review hub", `GET /api/study/admin/hub`): every
  skill's counts (live / waiting / rejected) laid on the course map, curriculum → track →
  unit, plus the skills the map does not place; then every candle lesson as members read
  it on the reveal card, with how many live examples carry it and a verdict door on the
  LESSON (Approve lesson / Needs fix + note). That verdict is a screen note on the
  `lessons` screen with `context.lesson_key`; it changes no item, because one lesson is
  shared by every example of its name.

The review screen's A / F / R keys act on the card only: while the gallery, the feedback
list or the hub covers the card they do nothing (before this, A could approve a draft no
one could see).

The ingest carries both: screen notes get their own "Screens" section in REPORT.md,
grouped by screen with what each was showing; a lesson verdict is appended to
`corrections/feedback.jsonl` as a `source_ruling` with `about: "lesson"`, `lesson_key`
and `lesson_verdict` (approve = confirmed; fix = build_required, a rewrite of
`docs/study/terms/candle_lessons.json`). A screen note is never written as an item verdict.

## Tests

`tests/test_study_feedback.py` (store + router), `tests/test_discord_study_command.py`,
`tests/test_study_ingest_feedback.py`, `app/src/pages/study/RevealCard.test.jsx` (lesson
parts + the door), `app/src/pages/admin/StudyReview.test.jsx` (the panel, the hub, the
key guard, screen notes in the list), `tests/test_study_screen_feedback.py` (screen notes,
lesson verdicts, the hub, the ingest), `app/src/pages/study/ScreenFeedback.test.jsx`,
`app/src/pages/admin/studyHubHelpers.test.js`, and the door rails in
`DrillPlayer.test.jsx` and `CoursesSection.test.jsx`.

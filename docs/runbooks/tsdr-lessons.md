# Video lessons (`/lesson` and the lessons job)

What it is: every video Patrick or Bracco posts in their Discord channels becomes a lesson
(transcript, recap, a post in the lessons threads, an unlisted YouTube copy). Members search
the library with `/lesson <words>` in `#uct-intelligence`.

Code: `api/services/tsdr_lessons.py`. The job is `tsdr_lessons.tick()`, scheduled from
`api/main.py` on the `web` service at minutes 4, 19, 34 and 49 of every hour.

## Is it running?

```sh
railway logs --service web --filter tsdr-lessons
```

A healthy job writes one line every 15 minutes (the counts here are placeholders):

```
[tsdr-lessons] tick: {'ran': True, 'scan:<channel>': {'pages': 1, 'added': 0}, ...,
                      'library': {'posted': N, 'skipped': N, 'failed': N, 'on_youtube': N}}
```

- No line at all for 30 minutes: the service was restarting at those minutes (a deploy), or
  the job is off. When it is off the log says so once per boot:
  `[tsdr-lessons] off: TSDR_LESSONS_ENABLED is not 1`.
- `'ai_budget': 'reached'`: the daily AI budget for this feature is spent
  (`/admin/ai-spend`). New lessons wait until tomorrow. Everything that does not call the
  model (edit requests, regrouping, video refill, YouTube uploads) keeps running.
- `'retrying_failed': N`: N failed videos were just given another round.

## The `library` counts

| Status | Meaning |
|---|---|
| `new` | Waiting to be processed. Three per run (`TSDR_LESSONS_PER_TICK`). |
| `posted` | In the library. This is what `/lesson` searches. |
| `duplicate` | The same talk as an earlier lesson. Recorded, never posted. |
| `skipped` | Nothing to process: the message or video was deleted, or a linked video is gone from YouTube. |
| `removed` | Taken out of the library: its post was deleted in Discord, or it was taken down. |
| `failed` | Used up its three attempts. See below. |

## A failed video

A video gets three attempts, one per run. After the third it is `failed`. A day later it is
given three more, up to five times (`reopen_failed`). So a short outage at Discord or the
model vendor costs a delay, not the lesson.

It is not retried when the failure cannot change: the video is over the size or length cap,
or the model declined to write the recap. Those stay `failed` on purpose.

The transcript is saved as soon as it exists, so a retry pays for the recap call only, never
for a second download and transcription.

To see why one failed, read its `last_error` (the WARNING lines `video <id> failed`).

## Switches (Railway, `web`)

All default OFF. Read the live values with `railway variables --service web --kv`.

| Variable | What it turns on |
|---|---|
| `TSDR_LESSONS_ENABLED` | The whole job. |
| `TSDR_LESSONS_THREADS_ENABLED` | Posting into the section threads. |
| `TSDR_LESSONS_FORUM_ENABLED` | Posting into the forum channel instead. |
| `TSDR_LESSONS_YOUTUBE_ENABLED` | The unlisted YouTube copy (`TSDR_LESSONS_YT_PER_DAY` per day). |
| `TSDR_LESSONS_SOURCE_CHANNELS` | The channels that are scanned. |
| `TSDR_LESSONS_AUTHOR_IDS` | Whose videos count. |

A second author needs BOTH their channel in `_SOURCE_CHANNELS` and their id in
`_AUTHOR_IDS`. With only the channel set, their videos are read past and never picked up.

## `/lesson` search, in one paragraph

Title and ticker matches count most, then tags and recap, then how often the transcript says
the words. Singular and plural match ("stops" finds "stop"). A ticker is matched exactly. A
ticker that spells a filler word or is one letter (`$BE`, `ON`, `F`) works when typed with a
`$`, in capitals, or alone. A question of three or more words needs half of them answered.
"Watch from" opens about 15 seconds before the estimated moment.

## Deploys

`web` only. `api/services/tsdr_lessons.py` is imported by flow-worker but never run there:
the job is scheduled in `api/main.py` and `/lesson` is a Discord interaction, which Discord
posts to `web`. A flow-worker watch-coverage red for this file is an INERT STRAND; no
flow-worker deploy.

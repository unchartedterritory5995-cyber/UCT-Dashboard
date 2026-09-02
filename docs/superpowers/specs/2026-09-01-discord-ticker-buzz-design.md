# Discord Ticker Buzz — design

**Date:** 2026-09-01
**Status:** design approved by owner, not yet planned
**Worktree:** `uct-worktrees/discord-buzz` (branch `feat/discord-buzz`)

## What members get

A bot that counts which tickers `#main-chat` is talking about, and answers
questions about it on demand and on a schedule.

```
/buzz                      the board, since the open
/buzz NVDA                 one name: count, people, when, jump link
/buzz window:week          the weekly board
/buzz NVDA window:month    one name over a month
```

Windows: `since open` (default) · `today` · `since noon` · `this week` · `this month`.

Plus one rendered image posted daily at 16:10 ET and a Friday weekly wrap.

## Decisions taken during brainstorming

| Question | Decision | Why |
|---|---|---|
| What does the number mean? | Two boards: ranked by **distinct people**, plus a **heat** board vs each ticker's own baseline | A raw count is owned by whoever talks most; and SPY/NVDA win a popularity board forever, so it goes stale in a week |
| History | Backfill **30 days** at launch | Both boards work on day one; the same pull is the corpus that settles the extractor |
| Channels | **`#main-chat` only** | One grant, one unambiguous meaning. `channel_id` is stored so adding channels later is config |
| Store chat text? | **No.** Store `message_id` and deep-link instead | A stored copy goes stale when a member edits or deletes; a jump link always resolves to the truth |
| Commands | **One** (`/buzz`), ticker optional, window optional | v19 lesson: a crowded picker is a real UX cost; one setting lives in one place |
| Where it runs | **Railway `web`**, REST polling | See below — this is not the obvious choice and the reason matters |

## Architecture

```
#main-chat --poll(after=<snowflake>)--> extract --> buzz.db (volume)
                                                       |
                    +----------------------------------+------------------+
                    v                                  v                  v
             /buzz (interactions)            scheduled digest      chart-renderer
                                             16:10 ET + Fri           board PNG
```

### Why polling, not a gateway

Measured 2026-09-01 against the live guild: `GET /channels/{id}/messages` returns
full `content` for messages authored by other users that do not mention the bot
(9 human-authored messages, up to 3,992 chars). **REST message reads are gated by
channel permissions, not by the `MESSAGE_CONTENT` privileged intent.** No portal
toggle and no gateway connection are required.

Polling is also *more* correct here than a gateway, not merely simpler. The stored
snowflake makes ingest **gap-free by construction**: a deploy, a crash or a
multi-hour outage loses nothing, because the next poll resumes at the exact
message. A gateway bot on `web` would silently drop every message during each
redeploy, and `web` redeploys on every push to master.

Measured rate limit on the messages bucket: **5 requests/sec**, so a 30-day
backfill of ~400-900 calls completes in roughly three minutes.

### Store

New SQLite DB on the volume, one row per (message × ticker):

```sql
CREATE TABLE mentions (
  message_id  TEXT NOT NULL,     -- Discord snowflake; also the dedupe key
  channel_id  TEXT NOT NULL,
  author_id   TEXT NOT NULL,     -- makes "14 people" possible
  ticker      TEXT NOT NULL,
  ts          INTEGER NOT NULL,  -- unix seconds, derived from the snowflake
  confidence  TEXT NOT NULL,     -- cashtag | alias | exact | contextual
  PRIMARY KEY (message_id, ticker)
);
CREATE INDEX idx_mentions_ticker_ts ON mentions(ticker, ts);
CREATE INDEX idx_mentions_ts        ON mentions(ts);

CREATE TABLE ingest_state (
  channel_id      TEXT PRIMARY KEY,
  last_message_id TEXT NOT NULL,
  updated_at      INTEGER NOT NULL
);
```

No message text is stored. A row reconstructs its own jump link from
`https://discord.com/channels/{guild}/{channel_id}/{message_id}`.

The composite primary key makes re-ingesting a window idempotent, so a retry or
an overlapping backfill can never double-count.

## The extractor is the hard part

### Measured failure of the current one

`uct_intelligence/ingestion/ticker_extractor.py` was written for `#tsdr` — one
disciplined trader. Run against six consecutive real `#main-chat` messages on
2026-09-01 it returned **nothing at all**, six times out of six:

| Real message | Current extractor |
|---|---|
| `Dell u ok` | nothing |
| `Hold Michael Dell` | nothing |
| `If DELL doesn't hold, probably means sellers are showing up...` | nothing |
| `watching Dell here` | nothing |
| `Spy looking heavy` | nothing |
| `Amazon reports tonight` | nothing |

The all-caps `DELL` case fails because the standalone-caps branch is gated behind
a `has_trading_context` check that looks for words like "chart"/"setup"/"breakout"
which ordinary conversation does not contain. The rest fail because members write
**`Dell`, `Spy`, `Amazon`** — mixed case, and often the company name rather than
the symbol.

**Conclusion: this is a rewrite, not a tune, and it is the bulk of the work.**

### Replacement design — four tiers, by confidence

1. **`cashtag`** — `$DELL`. Certain. Always counts.
2. **`alias`** — a company-name hit from a curated alias map (`Amazon`→AMZN,
   `Nvidia`→NVDA, `Tesla`→TSLA). Certain enough to always count.
3. **`exact`** — exact-case `DELL` where the token is a real symbol **and** is not
   an English word or house chart vocabulary. Always counts.
4. **`contextual`** — case-insensitive `Dell`/`dell` where the symbol is
   unambiguous (not an English word). Counts, but is the tier a future precision
   problem gets tightened on first.

An ambiguous token in lowercase (`open`, `all`, `play`, `real`, `cash`, `big`)
never counts at tier 3 or 4. It needs a cashtag or exact case plus corroboration.

`confidence` is stored per row, so a later precision fix can be evaluated against
data already collected instead of requiring a re-ingest.

### The stopword list must be derived, not typed

Per `lesson_a_symbol_universe_does_not_settle_a_ticker_match`: a universe check
cannot carry a match by itself, because the universe genuinely contains `RS`,
`EMA`, `MA`, `GAP`, `PEG` and every single letter. The current hand-typed
exclusion list has the mirror-image bug — it excludes `AI`, `OPEN`, `PLAY`, `BIG`,
`REAL`, `CASH`, `HOME`, `ALL`, `EV`, all of which are real tickers and several of
which this desk discusses.

So the collision list is **derived** by intersecting the symbol universe with an
English wordlist plus the house chart/setup vocabulary, and the result is
**measured against the 30-day backfill corpus** before ship. The junk the corpus
produces *is* the stopword list.

The universe must be asked in two places: `cap_universe.json` is a $300M+ equity
screen missing 84 of the 100 names in `prebuilt_etfs.json`, and missing sub-$300M
names entirely.

## Heat score

Two details decide whether this board is trustworthy.

**Matched denominator.** Today-so-far compared against a 30-day *daily* average is
apples to oranges at 09:45 — every ticker reads cold. The comparison is
same-elapsed-session against same-elapsed-session: mentions between the open and
now, versus the mean of mentions between the open and the same clock time across
the trailing 30 sessions.

**A volume floor.** A ticker mentioned once in 30 days and three times today is
"3x normal" and means nothing. A name qualifies for the heat board only with a
minimum absolute count in the current window **and** a minimum baseline presence.
Both thresholds are named constants derived from the backfill distribution, not
round numbers picked by hand.

## The graphic

One image, both boards fused — two images is clutter in a Discord message.

```
UNCHARTED TERRITORY - THE ROOM                Mon Sep 1 - 4:10p
Most talked about - since the open

NVDA  ######################  47   14 ppl   .:!||!:.
SPY   ################        38   11 ppl   .::||:.
TSLA  ##########              22    9 ppl   :|!:...
PLTR  ########                19    5 ppl   ...:!|   HOT 6.3x
AMD   #####                   11    6 ppl   :!::..   HOT 2.2x

318 messages - 63 members              uctintelligence.com
```

Rendered by the existing `chart-renderer` Playwright service from a new dashboard
route, the same path `/chart` already proves. The per-row sparkline is the point:
a count is a fact, but the shape shows *when* the chatter happened, which is the
part someone quotes back into chat. Timestamps are already stored, so it is free.

Visual design (palette, type, spacing) is a build-time pass with the dataviz
skill against the live house palette — not eyeballed. The `/chart` comparison
colours once shipped byte-identical to the EMA-20 line because they were picked
by eye against a palette nobody read.

## Scheduling

One post at **16:10 ET** (clear of the 15:45 index close post) and a **Friday
weekly wrap**. Three posts a day is noise people mute; one at a predictable time
becomes a ritual.

The scheduled post ships **disarmed**. The command lands first, runs for a few
days, and the owner arms the digest deliberately — posting into a 750-member room
is his call, not a default.

## Failure modes and switches

| Switch | Effect |
|---|---|
| `BUZZ_INGEST_ENABLED=0` | Stop polling. Existing data and queries keep working |
| `BUZZ_DIGEST_ENABLED=0` | No scheduled posts (**ships as 0**) |
| `BUZZ_IMAGE_ENABLED=0` | Text-only boards; skip the renderer |
| `BUZZ_CHANNELS` | Comma-separated channel ids; defaults to `#main-chat` alone |

Per `project_feature_flag_ledger`, each flag is registered so that "off by default
and set nowhere" is distinguishable from "off on purpose".

Degradation: if the renderer is busy or fails, the board posts as text rather than
not at all. If ingest is behind, every board states its own coverage ("counted
through 3:58p") rather than presenting a stale number as current.

## Testing

- Extractor measured against the 30-day backfill corpus, reporting precision on a
  hand-labelled sample. A rail that cannot distinguish a real ticker from house
  vocabulary is not a rail.
- Ingest idempotency: re-running an overlapping window changes no count.
- Resume: killing mid-backfill and restarting loses and duplicates nothing.
- Heat score: a fixture where the naive daily-average denominator gives a wrong
  answer and the matched denominator gives the right one — with a control proving
  the test can fail.
- Rendered board judged by counting pixels, not by "ready" returning true.

## Out of scope for v1

Trader-feed boards (`#tsdr`, `#bracco`, …) as a separate "the desk" view;
sentiment; per-member stats or leaderboards of *people*; DM alerts; linking
Discord identity to dashboard accounts.

## Owner actions

1. **Grant the `UCT Intelligence` role read access to `#main-chat`** — Channel
   Settings → Permissions → Add members or roles → `UCT Intelligence`. Measured
   2026-09-01: the role holds View + Read History at guild level, but the channel
   `@everyone` overwrite denies View and the role has no overwrite to override it,
   so the bot sees 3 of 70 channels and `#main-chat` is not one of them. Nothing
   ingests until this is done. (A `Perplexity` role already holds exactly this kind
   of read overwrite on the channel.)
2. **Arm the digest** when ready, after the command has run for a few days.

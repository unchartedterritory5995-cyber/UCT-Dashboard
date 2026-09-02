# Activating `/buzz` — the ticker-mention board

**The code is deployed and completely inert.** Five gates hold it, and you open
them one at a time. Every step has a check that proves it worked *before* the
next step depends on it — if a check fails, stop there; the later steps will
succeed while doing nothing, which is the failure mode this order exists to
prevent.

| Gate | State on arrival | Opened in |
|---|---|---|
| `DISCORD_BOT_TOKEN` unset → the poller has no credentials | closed | Step 0 |
| `BUZZ_CHANNELS` unset → the poller reads no channels | closed | Step 2 |
| bot cannot read `#main-chat` | closed | Step 1 |
| `/buzz` not registered with Discord → no member can invoke it | closed | Step 4 |
| `BUZZ_DIGEST_ENABLED` defaults `0` | closed | Step 5 |
| `BUZZ_IMAGE_ENABLED` defaults `1` — but only reachable via `/buzz` | moot until Step 4 | — |

Nothing posts to Discord and nothing is counted until Step 2. Steps 0–3 are
reversible; Step 4 is the one members can see.

---

## Step 0 — the reading bot's token

**Two different tokens are in play. Do not mix them up.**

| Token | Used by | Needed for |
|---|---|---|
| `DISCORD_BOT_TOKEN` | the poller, the backfill, `tools/buzz_perms.py` | **reading** `#main-chat` |
| `DISCORD_CHART_BOT_TOKEN` | `tools/discord_chart_commands.py` | **registering** the slash command (Step 4) |

**Measured 2026-09-01, not assumed:**

- `DISCORD_BOT_TOKEN` is **NOT SET** on Railway `web` (read live via
  `railway variables --service web --kv`; 203 vars, this is not one of them).
- The value already exists on the dev box at
  **`C:\Users\Patrick\uct_intelligence\.env`** — the RAG bot's repo. That bot is
  **"UCT Intelligence"**, application id `1474900505917653142`, and it is already
  a member of the guild (`882293203485720596`), where it can see 85 channels.
- ⛔ **That is a DIFFERENT application from the one serving the slash commands**
  (`DISCORD_CHART_APP_ID = 1541909310588719104`). Two apps, two tokens. The chart
  app's bot token is on **no** machine here — it is only needed for Step 4.

So Step 0 is a copy, not a hunt:

```bash
railway variables --service web --set DISCORD_BOT_TOKEN=<value from uct_intelligence/.env>
```

Put the same value in this repo's local `.env` — Steps 1 and 3 run tools that
read it from there.

> The bot this token belongs to ("UCT Intelligence") is the one that needs the
> channel permission in Step 1. Grant it to **that** bot's role — not the chart
> app, which never reads messages.

> Don't redeploy yet; you will set `BUZZ_CHANNELS` in Step 2 and redeploy once.

### Check before continuing

```bash
python -c "from dotenv import load_dotenv; import os; load_dotenv(); print('local token set:', bool(os.environ.get('DISCORD_BOT_TOKEN','').strip()))"
```

If the poller ever runs with this missing, it now says so by name in the logs
(`[buzz] DISCORD_BOT_TOKEN is not set — cannot read <channel>`) rather than
leaving you a generic 401 behind a board that looks like a quiet room.

---

## Step 1 — let the bot read `#main-chat`

The bot reads messages over the **REST API**, which is gated by ordinary channel
permissions — *not* by the privileged MESSAGE CONTENT intent. Two permissions on
the `UCT Intelligence` role, on that one channel:

- **View Channel**
- **Read Message History**

Discord → **Server Settings → Channels → `#main-chat` → Permissions →
Add members or roles → `UCT Intelligence`** → enable both.

**Measured 2026-09-01:** `#main-chat` is id **`1216816863313657886`**, and the
`UCT Intelligence` bot is currently **BLIND** on it — and on every other
main/general/chat/trading channel in the guild. It is not a guild admin and holds
no `MANAGE_ROLES`, so **it cannot grant itself access**: this step is a human
action in the Discord UI and nothing can automate it.

> ⛔ **Do not click "Sync Now"** on that channel. Sync replaces the channel's own
> overrides with its category's, which silently removes the grant you just made.
> The board would then count zero forever and look exactly like a quiet room.

### Check before continuing

Get the channel id first: right-click `#main-chat` → **Copy Channel ID** (needs
Developer Mode on, under Discord's Advanced settings). Then:

```bash
BUZZ_CHANNELS=<channel-id> python tools/buzz_perms.py
```

Read-only; runs locally against `DISCORD_BOT_TOKEN` from `.env`. It resolves the
bot's *effective* permissions on that channel — role defaults plus every
overwrite — and prints `[READ]` or `[BLIND]`.

> ⛔ **`BUZZ_CHANNELS` is not optional here.** The tool only examines channels
> named in it, so running it bare would examine nothing and print an all-clear.
> It now refuses that case with `CANNOT CHECK` and a distinct exit code — but
> pass the id and get a real answer rather than relying on the refusal.

`#main-chat` must come back `[READ]`. **If it does not, stop** — every later step
will report success while counting nothing.

---

## Step 2 — point the poller at the channel

Same channel id you used in Step 1.

```bash
railway variables --service web --set BUZZ_CHANNELS=<channel-id>
railway redeploy --service web --yes
```

This redeploy also applies the `DISCORD_BOT_TOKEN` you staged in Step 0.
Confirm both landed on the *process*, not just the staging area:

```bash
railway variables --service web --kv | grep -E "BUZZ_CHANNELS|DISCORD_BOT_TOKEN"
```

> ⛔ `railway variables --set` **stages** the value; it does not restart the
> process. Without the redeploy the poller keeps running with the old (empty)
> value and nothing is counted.

The poller runs every 60 s and advances its cursor only *after* rows commit, so
it is gap-free across deploys and safe to leave running.

### Check before continuing

```bash
curl -s -H "User-Agent: Mozilla/5.0" \
  "https://uctintelligence.com/api/r/buzz?token=$CHART_RENDER_TOKEN" | head -c 300
```

Two things to look for:

1. **HTTP 200 with JSON, not a 500.** This is also the live proof of a fix that
   went in with this feature: the mentions table used to be created only by the
   poller, *after* its own enabled-check, so every reader broke whenever ingest
   was off. It is now created at startup regardless.
2. After a minute or two of chat, `totals.messages` and `coverage` start moving.

Cloudflare 1010-blocks bare curl user-agents, hence the `User-Agent` header.

---

## Step 3 — backfill 30 days

**Run this on the pod, not locally.** The store lives at `/data/buzz.db` on the
Railway volume; a local run writes `C:\data\buzz.db`, which the app never reads —
it would look like it worked and change nothing.

```bash
MSYS_NO_PATHCONV=1 railway ssh --service web \
  "/opt/venv/bin/python tools/buzz_backfill.py --dry-run"
```

The dry run reads one page and tells you whether the channel is readable —
a second, cheaper confirmation of Step 1 from inside the pod. Then:

```bash
MSYS_NO_PATHCONV=1 railway ssh --service web \
  "/opt/venv/bin/python tools/buzz_backfill.py --days 30"
```

> Use `/opt/venv/bin/python`, never bare `python3` — the Nix system python on the
> pod has none of the app's dependencies.

This is safe to run beside uvicorn: it imports only the buzz services, **not**
`api.main` — measured at 3.2 MB of Python heap with no fastapi import, so it does
not double-load the api stack the way the report card does.

### Check before continuing

The tool prints pages, messages and mentions as it walks. At the end:

- **`TRUNCATED` means a rate limit or API error, not the end of history.** Re-run
  it — the walk now genuinely **resumes** from a saved watermark. On a busy
  channel expect several runs: `#main-chat` does ~1,100 messages/day, so 30 days
  is ~330 pages and Discord will rate-limit you repeatedly along the way.
  `--restart` throws the watermark away and walks from the newest again.
- ⛔ **Judge completion by the DATA, never by the absence of a warning.** A run
  that dies before printing anything prints no `TRUNCATED` either, and a loop
  grepping for that word reads the silence as success — which is exactly what
  happened on the first real backfill, leaving one day of history while
  reporting done. A finished run says
  `✅ reached the N-day cutoff` explicitly. Verify against the store:

```bash
MSYS_NO_PATHCONV=1 railway ssh --service web \
  "/opt/venv/bin/python -c \"import sqlite3;c=sqlite3.connect('/data/buzz.db');lo,hi=c.execute('SELECT MIN(ts),MAX(ts) FROM mentions').fetchone();print('span days:',round((hi-lo)/86400,1))\""
```

  `span days` is the number that matters. Anything well under your `--days` means
  the walk has not finished, whatever the log said.

> ⚠️ Heat ("▲ 6.3×") stays hidden until the store covers at least 5 sessions the
> room actually spoke in. That is deliberate: on a thin baseline every ordinary
> name reads as a 6× anomaly. Expect the heat column to be empty right after
> activation and to fill in once the backfill lands.

---

## Step 4 — register `/buzz` with Discord

This is the step members can see.

⛔ **This needs the CHART app's bot token** (`DISCORD_CHART_APP_ID =
1541909310588719104`), which is **not on this machine** — checked every `.env`
under `uct-dashboard`, `uct_intelligence`, `uct-intelligence`, `morning-wire` and
the worktrees. Fetch it from the Discord Developer Portal for that application.
The `UCT Intelligence` bot token from Step 0 is a **different app** and must not
be used here: it would register the commands against the wrong application.

```bash
DISCORD_CHART_BOT_TOKEN=<chart app bot token> \
  python tools/discord_chart_commands.py register --guild 882293203485720596
```

> **Registration is all-or-nothing.** `build_commands()` returns
> `chart`, `c`, `chartsettings` and now `buzz` — running this ships all four.
> That is intended, but it also means any *future* re-registration for an
> unrelated chart change will ship `/buzz` too, so do Steps 1–3 first.

Then try it yourself before telling the room:

- `/buzz` → the board (text + rendered image)
- `/buzz window:This week` → a wider window
- `/buzz ticker:NVDA` → one name's numbers

The image is optional by design: if the renderer is busy or down, the text board
still arrives. It is cached 60 s and shares `/chart`'s render valve, so a burst
of members collapses to one render rather than 25.

---

## Step 5 — arm the digest

Posts the board **seven times each weekday**, through the session (owner,
2026-09-02): **10:00 · 10:30 · 11:30 · 12:30 · 14:00 · 16:15 · 17:30**.

Every post is the **"since the open"** board, so 10:00 is a 30-minute pulse and
17:30 is the finished session.

> Times are `America/New_York`, not a fixed offset. You said "EST", and in
> September that is really EDT — using the zone means these track the wall
> clock you mean on both sides of the DST change, with no edit in November.

```bash
railway variables --service web \
  --set BUZZ_DIGEST_ENABLED=1 \
  --set BUZZ_DIGEST_CHANNEL=<channel-id>
railway redeploy --service web --yes
```

**That is option A — a channel id, no webhook to create.** The bot already holds
`SEND_MESSAGES`, so a channel id is a complete destination.

⚠️ It can only post where it can *see*. Measured 2026-09-02, the bot is postable
in exactly ONE channel — `#main-chat` (`1216816863313657886`), the one granted
in Step 1. For anywhere else, either grant it View Channel + Send Messages there
too, or use option B.

**Option B — a webhook.** Works for any channel, including ones the bot cannot
see, but you create it by hand (the bot has no `MANAGE_WEBHOOKS`):

```bash
railway variables --service web \
  --set BUZZ_DIGEST_ENABLED=1 \
  --set BUZZ_DIGEST_WEBHOOK=<webhook-url>
railway redeploy --service web --yes
```

If both are set the **channel wins** — it is the more specific instruction.

Change the cadence with `BUZZ_DIGEST_TIMES` (comma-separated `HH:MM`, ET) —
e.g. `--set BUZZ_DIGEST_TIMES=10:00,12:30,16:15` for three. One scheduler job
is registered per slot, and boot prints the list it registered.

> ⛔ A malformed `BUZZ_DIGEST_TIMES` posts **nothing** and warns — it does NOT
> fall back to the default. Falling back would post at times you never asked
> for and make a typo invisible. Check the boot line names the slots you meant.

Each slot dedups independently: a quiet 10:00 never consumes 10:30, and a
misfire a few minutes late still counts as its own slot rather than posting
twice next to the real one.

Rollback is the env var, not a deploy: set `BUZZ_DIGEST_ENABLED=0` and redeploy.

---

## If the board looks wrong

| Symptom | Where to look |
|---|---|
| Board is empty / "No mentions counted yet" | In order: is `DISCORD_BOT_TOKEN` set on the web service (Step 0)? Then re-run `BUZZ_CHANNELS=<id> python tools/buzz_perms.py` — a revoked or category-synced permission is the usual cause. |
| Logs say `DISCORD_BOT_TOKEN is not set` | Step 0. The poller is configured but has no credentials. |
| Counts stopped advancing | `BUZZ_CHANNELS` still set? A `railway variables --set` without a redeploy reverts behaviour to the old value. |
| Image missing, text fine | Working as designed — the renderer was busy or down. The board never apologises, it just drops the picture. |
| A word is being counted as a ticker | The collision list is derived from a corpus, not hand-typed. Re-derive it against `#main-chat` with `tools/buzz_derive_collisions.py` once there is real history — that is the right instrument, not a hand edit. |
| Heat column always empty | Fewer than 5 covered sessions, or nothing is genuinely 1.5× its norm. |

## Knobs, if you ever need them

All optional; the defaults are the tested ones.

| Var | Default | What it does |
|---|---|---|
| `BUZZ_POLL_INTERVAL_S` | 60 | how often the poller runs |
| `BUZZ_HEAT_MIN_SESSIONS` | 5 | covered sessions required before heat publishes |
| `BUZZ_HEAT_MIN_CURRENT` | 5 | mentions today before a name can be "hot" |
| `BUZZ_HEAT_MIN_BASELINE` | 1.0 | baseline floor under which a ratio is meaningless |
| `BUZZ_IMAGE_CACHE_TTL_S` | 60 | how long one rendered board is reused |
| `BUZZ_MAX_RETRY_AFTER_S` | 30 | cap on how long a Discord 429 may pause the poller |
| `BUZZ_IMAGE_ENABLED` | 1 | set `0` for text-only boards |

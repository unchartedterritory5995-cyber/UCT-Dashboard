# Discord render — operations runbook

The day-two document: the Discord render path is live, something looks wrong, and you need to know
what each piece is, what the numbers mean, and what to actually do.

**This is not the flip.** Turning V2 on or off is `docs/discord-render/06-flip-packet.md`, which is
written to be read alone. **This is not the design.** That is
`docs/discord-render/03-architecture.md`. This file is what an operator needs at 09:35 on a Monday.

Every number and sentence below names the file that owns it. Where a value lives in code, this
points at the constant instead of repeating it — a hand-typed number beside the source that owns it
is the most-repeated defect in this repository's history.

---

## 1. The five services, and who does what in one `/chart`

Railway project `luminous-recreation`, environment `production`. The literal watch patterns are in
`docs/runbooks/deploy-windows.md` ("Current state"), which is the authority on which push restarts
what.

| Service | What it is | Part in a Discord render |
|---|---|---|
| **web** | one uvicorn process: the React build, every `/api/*`, and the `/r/*` render pages | **everything except the screenshot.** It receives the interaction, acks it, runs the job, fetches bars and quotes, calls the renderer, and PATCHes the reply. It also *serves the page the renderer photographs* |
| **chart-renderer** | Playwright + Chromium | `POST /render` (`services/chart_renderer/app.py:526`) — navigates to the URL it is handed, screenshots, returns a PNG. `GET /health` (`:505`) |
| **flow-worker** | owns the Massive OPRA websocket and `flow.db` | answers `GET /api/live/massive/ticker-flow`, which is where `/flow` gets its tape |
| **worker** | bars prewarm + R2 snapshots | not on the render path; shares nothing with it but the repo |
| **bars-api** | bars service | not on the render path |

### The hops in a `/chart`

1. Discord → `POST /api/discord/interactions` on **web**. Signature and guild gates first.
2. **The ack**, on the event loop and nothing else: parse, syntactic check, symbol resolution inside
   a 0.6 s budget on its own thread pool (`api/services/discord_render/commands.py:41, 70`), the
   per-member checks, an in-memory `queue.offer`, and the defer goes back.
3. A **dedicated worker** (not the dashboard's shared 64-thread pool) picks the job up and produces
   it: the bars adapter, then the quote adapter, then the renderer adapter — each with its own
   bounded pool, its own timeout and its own breaker (`03` §3.8c).
4. The renderer adapter POSTs to `{CHART_RENDERER_URL}/render`
   (`api/services/discord_chart_house.py:269, 299`) with `X-Render-Secret`, `X-Correlation-Id` and
   `X-Render-Priority`.
5. **chart-renderer navigates back to a page served by `web`** — `/r/chart?…` — screenshots it and
   returns the PNG.
6. Delivery PATCHes the interaction's webhook message with the image.

⭐ **Step 5 is why a `web` restart costs a render.** The renderer's page comes from the same pod that
is swapping, so during a deploy the page is 502/422 for ~30–90 s and the render fails with a
"page not served" signature (C-01, `03` §0). `web` deployed 1,077 times in the fourteen days to
2026-09-13, median pod life 8.4 minutes. If renders fail in a burst, **look at whether `web` just
deployed** before looking at anything else.

### `/flow` is the exception: it leaves the pod

`api/services/discord_render/adapters/flow.py` calls
`{WORKER_INTERNAL_URL}/api/live/massive/ticker-flow` on flow-worker (`flow.py:51-57`). If that leg
fails **for a reason a retry cannot fix** — no URL, a transport error, an open breaker — and there is
at least `LOCAL_MIN_S` of budget left (`flow.py:37`), it falls back to `web`'s own in-process copy,
and the answer is labelled degraded.

⛔ It does **not** fall back on a timeout (the budget is already gone and the local leg is the slower
of the two), and it does **not** fall back after flow-worker *answered* with a 5xx — flow-worker
answering badly means `web`'s copy would very likely answer the same way (`flow.py:15-20`).

⭐ **An empty tape is an answer, not a failure.** A quiet session comes back `ok` with
`contract_count == 0` and the router's own sentence. It is deliberately not in the failure counters
(`05-progress.md`, step 2.4b P2.1).

---

## 2. Where the state lives

| State | Where | Notes |
|---|---|---|
| **The durable jobs table** | `/data/discord_render_jobs.db` on **web's** volume; override `DISCORD_RENDER_DB_PATH` (`api/services/discord_render/jobs_store.py:62-63`) | Its own SQLite file, WAL, one writer thread, so a lock here can never wait on `bars.db` or `auth.db` (`03` §3.3) |
| Schema | `03` §3.3 — one row per job: `corr_id` PK, timings (`ack_ms`, `queue_ms`, `first_image_ms`, `final_ms`), `state`, `outcome`, `failure_class`, `quality`, the lease, `pod_boot_ts`, `commit` | **This table IS the SLO store and the forensic record.** Every number `/renderhealth` prints is a query over it |
| Interaction tokens | in the row, **nulled at terminal state**, purged at 16 minutes | A 15-minute bearer. Never copy a row wholesale into a document or a chat |
| Retention | 30 days without tokens (`03` §3.3), swept by the observer's hourly `store.purge()` (`03` §3.9) | |
| Alert cooldowns | the same database — **durable on purpose** | An in-memory cooldown resets every 8 minutes and would page on every pod |
| Artifact cache | `/data/discord_render_cache/` when 2.5 ships (`03` §3.6) | **Not built yet.** Do not go looking for it |

⛔ **If the file does not exist, V2 has never run on that volume**, and
`GET /api/discord/render-health` says so in those words rather than printing zeros
(`api/routers/discord_interactions.py:786, 791`). An absent database is a stronger fact than a zero
count — a zero count is also what a wrong query returns.

---

## 3. Reading `/renderhealth`

Two doors onto the same payload (`observe.health_payload`), so an operator and an alert can never
disagree:

**In Discord:** `/renderhealth` — registered into the guild, `default_member_permissions "8"` **and**
a server-side permission check (`commands.py:185, 210`). It is answered whatever the V2 flag says,
because it is most useful *before* a flip (`api/routers/discord_interactions.py:375`).

**Over HTTP:**

```sh
curl -s -A "Mozilla/5.0" -H "Authorization: Bearer $PUSH_SECRET" \
     https://uctintelligence.com/api/discord/render-health
```

401 without the bearer (`discord_interactions.py:779-782`). ⛔ Never paste the bearer anywhere.
⚠️ Send a browser `User-Agent` — Cloudflare 1010-blocks raw agents on this domain.

### What the reply says, line by line

```
Render V2 · commit <sha12> · <runtime owner, or "runtime not started">
Queue: N waiting · M active of W workers · background B
Renderer: ready | NOT READY (...) | not configured | unknown
1h:  <jobs> jobs · success <pct> · delivered p50 … p95 … p99 … · acks over 3s <n> · resumed <n>
24h: …
7d:  …
Failures (1h): <class>×<n>, …
Stuck: <n> · Alerts: <keys, or none>
Recent failures: <cid> <command> <class> · …
```

(`observe.py:302-328`.)

| Field | Read it as | Healthy |
|---|---|---|
| `commit` | the SHA actually running, from `RAILWAY_GIT_COMMIT_SHA` | what you last merged |
| `Queue: N waiting` | interactive backlog | near 0. A standing backlog means workers are blocked on an upstream |
| `acks over 3s` | interactions Discord has **already failed** | **0.** SLO S1 allows none |
| `success` | delivered ÷ (terminal − user errors). `symbol_not_found` and `no_bars` are the member's input, not our failure (`contract.py:39`) | ≥ 99.5 % (S5) |
| `delivered p50/p95/p99` | ack → the PATCH carrying the image returned 2xx | 2.5 s / 5 s / 8 s for a liquid chart in RTH (S2, `03` §1) |
| `resumed` | jobs a dead pod left mid-render that the next pod picked up | small and non-zero is normal on this pod; a spike means `web` is thrashing |
| `Stuck` | non-terminal 60 s after creation (`observe.py:34`) | **0.** SLO S7 says this should be impossible |
| `Renderer` | a cached probe of chart-renderer `/health` | `ready` |
| `Alerts` | exactly what the observer would page on right now | `none` |

⚠️ **`ready: true` on chart-renderer is not a browser liveness check.** `ready` means "a render sent
now will be served"; the field that tells the truth about Chromium is **`browser_connected`**. Both
were measured during 2026-09-13's self-heal test: the browser was killed, `browser_connected` went
`false` and RSS fell 528 → 120 MB, while `ready` stayed `true` and every subsequent render succeeded
because the pool relaunches on demand (`LEDGER.md`, step 1.2).

### "House quality" vs "delivered"

A labelled stand-in counts as **delivered** (SLO S8) — the whole point is that a member is never
silently handed a lesser chart. That means a renderer outage can sit inside a green success rate,
which is why house-quality rate is reported beside it (`03` §1). If success looks fine and members
are complaining about the *pictures*, read `quality` in the jobs rows, not the success rate.

---

## 4. Failure classes — what each one means, and what you do

One table builds every user-visible failure (`api/services/discord_render/contract.py:21-36`). The
member sees:

```
/chart NVDA failed — the chart service took too long · id 7f3a9c21 · retry?     [Retry]
```

⛔ No stack trace, exception string or URL ever reaches a member. The builder takes a **class**, not
an exception, so there is nothing for a traceback to leak through (`contract.py:7-9`).

| Class | Member reads | What it actually means | Operator does |
|---|---|---|---|
| `ack_late` | Discord closed the request before we answered | the ack took > 3 s — the event loop or the thread pool was saturated (C-02) | Check `loop_stalled` and what else the pod is doing. This is the one class that means *we* were slow, not an upstream |
| `queue_full` | we're at capacity right now | the bounded queue was full at `offer` (`DISCORD_RENDER_QUEUE_MAX`, `runtime.py:176`) | Look at why jobs are not draining — almost always a wedged upstream |
| `deadline` | the chart service took too long | 15 s passed with no artifact; the watchdog answered while the job kept running | Read the hop events for that `cid` (§6). Usually bars or renderer |
| `renderer_unavailable` | the chart renderer is unavailable | the renderer adapter failed or its breaker is open; a labelled stand-in was sent | chart-renderer `/health`; check `browser_connected` and `launch_error` |
| `data_unavailable` | market data for this symbol couldn't be loaded | bars adapter failed (not "no bars" — an actual failure) | Check the bars breaker and the provider |
| `no_bars` | there are no bars for this symbol and timeframe | **user error**, excluded from the success SLO | Nothing. It is a correct answer |
| `symbol_not_found` | I don't have that symbol | **user error**; answered ephemerally with ≤3 suggestions | Nothing, unless members report a real symbol being refused — then read §6 for the resolver's verdict and consider `DISCORD_RENDER_V2_SYMBOLS_ENABLED=0` |
| `flow_timeout` | the options-flow service didn't answer in time | flow-worker did not answer inside 10 s | flow-worker health. OI-15: it has no internal time budget of its own |
| `flow_unavailable` | the options-flow service is unavailable | we could not **reach** flow-worker | Check the service is up and `WORKER_INTERNAL_URL` is set |
| `flow_error` | the options-flow service returned an error | flow-worker **answered** with an error | A flow-worker problem, not a network one. The distinction decides whether the in-process fallback runs at all |
| `discord_rejected` | Discord refused the message | a 50035-class rejection — a malformed component tree or a stale attachment reference | Read the recorded sub-class (`discord_rejected:components` / `:attachments`). A components rejection should be impossible once pre-flight validation ships (2.6) |
| `rate_limited` | Discord is rate-limiting us | a 429 whose `retry_after` did not fit the remaining deadline | Volume-driven. Check whether something is retrying in a loop |
| `restarted` | UCT restarted while this was rendering | a pod died and the job was too old to resume | Expected at low rates on this pod; a spike means `web` is deploying repeatedly |
| `internal` | something went wrong on our side | an unmapped class | **This one is a defect in the mapping, not just in the request.** `adapters/classes.py` is total over `(upstream, reason)` and raises on an unmapped pair precisely so this stays rare |

⛔⛔ **`flow_unavailable` and `flow_error` must never be merged back together.** "We could not reach
it" and "it answered with an error" are a different sentence to a member, a different next action for
us, and they decide whether the in-process fallback is attempted. For two weeks `/flow` said "the
flow feed is reconnecting" for timeouts, 500s and restarts alike — 19 failures, 18 of them
timeouts — and nobody could act on any of them (C-08).

---

## 5. Alerts

Destination: `DISCORD_RENDER_ALERT_WEBHOOK` on `web` — currently the private `#render-alerts`
channel. **Blank sends nothing to Discord but still writes the alert as a log event** under the same
cooldown (`observe.py:353-356`).

Cadence: the observer evaluates every 60 s (`DISCORD_RENDER_OBSERVE_S`); each key has its own
durable 30-minute cooldown (`DISCORD_RENDER_ALERT_COOLDOWN_S`) held in the jobs database
(`commands.py:100-103`).

| Key | Threshold | Source | What to do |
|---|---|---|---|
| `ack_over_3s` | any ack > 3,000 ms in the last hour | `observe.py:233-234` | Worst signal in the set: those interactions are already lost. If it appears after a change, roll that change back |
| `failure_burst` | ≥ 5 failures in 5 minutes, listed by class | `observe.py:241-244` | The class list tells you where to look. Flow/renderer classes are upstreams; `deadline`/`internal`/`queue_full` are ours |
| `breaker_open:<dep>` | that dependency's breaker is open — one key per dependency | `observe.py:206` | `<dep>` ∈ `bars · quote · flow · renderer · entity`. Fix the upstream. **Silence is the recovery signal** — there is no "recovered" push, because breaker state is per-process on a pod with an 8-minute median life |
| `loop_stalled` | worst loop-block reading ≥ 1,000 ms | `observe.py:37, 176` | The one event loop was blocked. This is C-02 — the failure that took out Discord's ack and the renderer's page load together, 37× more often than chance |
| `slo_final_p95` | ≥ 10 jobs in 30 min and p95 delivery > 8,000 ms | `observe.py:228-229` | Slow, not broken. Check renderer `/health` and the breakers before acting |
| `slo_success` | ≥ 20 non-user-error jobs in an hour under 99.5 % | `observe.py:231-232` | Read `last_failures` for the classes |
| `stuck_jobs` | any job non-terminal after 60 s | `observe.py:235-236` | SLO S7 violation. Keep the row — it is the evidence |
| `renderer_not_ready` | not ready on **2 consecutive** probes | `observe.py:237-238` | One miss is a blip; two is an outage. Members are getting labelled stand-ins meanwhile |

⛔ **`half_open` is not an alert.** It means the cooldown elapsed and the next caller gets the probe —
the system recovering exactly as designed. Paging on recovery is how a channel gets muted, and then
it is quiet on the day it matters (`observe.py:191-193`).

---

## 6. Reading a `drender` event line

Every V2 log line is one JSON object on a logger called `discord_render`, prefixed with the bare word
`drender` (`observe.py:52-60`):

```
drender {"t":"drender","evt":"hop","cid":"7f3a9c21","cmd":"chart","sym":"NVDA","hop":"render","ms":1842.0,"status":"200"}
```

| Field | Meaning |
|---|---|
| `evt` | the event kind — `ack`, `hop`, `deliver`, `alert`, `shadow`, `runtime_started`, `runtime_stopped`, … |
| `cid` | the correlation id: 8 hex of `sha1(interaction_id)`. **The same id is shown to the member, stored in the jobs row, sent to chart-renderer as `X-Correlation-Id`, and sent to flow-worker as a `cid` query parameter.** It is the whole join |
| `cmd` · `sym` · `tf` | the command and its arguments |
| `hop` | which leg this line times (`bars`, `quote`, `render`, `upload`, …) |
| `ms` · `status` · `outcome` · `cls` · `attempt` | duration, upstream status, result, failure class, try number |
| `lane` · `state` · `key` · `detail` | queue lane, job state, alert key, and a **scrubbed** free-text field |

The field list is `observe.py:41`; anything not in it is dropped rather than logged.

### Finding them

```sh
python tools/railway_env_logs.py --filter drender
```

⛔ **Search for the bare word.** Railway's log search silently matches **nothing** for a phrase
containing brackets — `"[flow]"` returned 0 rows on deployments that definitely held `[flow]` lines.
That is why the token is unbracketed (`observe.py:9-11`).

⛔ **A member's complaint is answered with the `cid`, not with a time range.** Ask for the id in the
failure message; it is the primary key of the jobs row and it appears on every line of that job.

### What is and is not in the logs

⛔ **No token, webhook URL or query string is ever logged.** Values are scrubbed at the one place
events are written (`observe.py:40, 45-49`), `log.exception` is forbidden anywhere in the package by
an AST rail, and a runtime crash test asserts the interaction token never reaches the captured log.
chart-renderer logs a URL by **path only** — it printed the render token in plaintext on every
page-load timeout for two weeks before that was fixed (C-13; `services/chart_renderer/app.py:76,
111`). If you ever see a `token=` in a log line, that is a reportable regression.

### One more event worth knowing: `evt=shadow`

While `RENDER_V2_SHADOW=1` and V2 is **off**, every interaction also records what V2 *would* have
answered (`api/services/discord_render/shadow.py`). The number to watch is **`divergence`** — true
when V2 would have refused a symbol the old path went on to draw (`shadow.py:94`). It cannot deliver
anything: the module names neither `app_id`, the token, the runtime, the jobs store nor `edit`, and a
rail asserts that from its parse tree.

---

## 7. ⛔⛔ The trap: do NOT add `CHART_RENDER_TOKEN` to chart-renderer

**chart-renderer never validates the render token. It navigates to whatever URL it is handed.**
Measured (OI-19): `grep CHART_RENDER_TOKEN services/chart_renderer/app.py` returns **nothing**.

A `CHART_RENDER_TOKEN` (or `CHART_RENDER_TOKEN_PREVIOUS`) set on that service would be read by
nothing, and would leave whoever set it believing a rotation was complete when half of it had not
happened.

**The check lives in two places, both on `web`:**

| Where | What it gates |
|---|---|
| `api/routers/render_panels.py:60-82` — `_accepted_tokens()` / `_check_token()`, reading `CHART_RENDER_TOKEN` and `CHART_RENDER_TOKEN_PREVIOUS` | the `/api/r/*` **payload** endpoints |
| `app/src/lib/renderToken.js:18-31`, imported by the **14** `app/src/pages/*Render.jsx` pages, reading `VITE_CHART_RENDER_TOKEN` / `VITE_CHART_RENDER_TOKEN_PREVIOUS` | the `/r/*` **pages** themselves. Baked in at BUILD time, so rotating it is a rebuild |

⚠️ **The confusion is understandable, because chart-renderer DOES hold a secret — a different one.**
`CHART_RENDERER_SECRET` gates `POST /render` via the `X-Render-Secret` header
(`services/chart_renderer/app.py:62`, sent by `api/services/discord_chart_house.py:272`). Two
credentials, two jobs:

- **`CHART_RENDERER_SECRET`** — *may web ask the renderer to render?* Lives on **both** services.
- **`CHART_RENDER_TOKEN`** — *may this browser open the `/r/*` page?* Lives on **web only**, and is
  inlined into the public bundle by design.

⛔ **A rotation is not finished until `*_PREVIOUS` is cleared.** An uncleared previous is not a
rotation, it is two live tokens (`render_panels.py:68-69`, `renderToken.js:15-16`). As of
2026-09-13 a rotation is in flight — both halves are set on `web` — and a one-shot Task Scheduler job
**`UCT Render Token Retire`** (Monday 2026-09-14, 07:15 CT) clears only the `_PREVIOUS` pair, gated on
the Morning Wire having run that day (`LEDGER.md`, step 1.1b).

---

## 8. Standing constraints

### 8.1 One master merge at a time, repo-wide

`web` SUCCESS **and** the running SHA confirmed before the next push. Stacked pushes are what caused
the 2026-09-12 502: two merges four minutes apart, each marking the previous deploy REMOVED and
serving Bad Gateway through the swap. `python tools/pre_push_guard.py` enforces it and fails closed;
it refuses a `master` push while the newest `web` deployment is not a SUCCESS at least 150 s old
(`docs/runbooks/deploy-windows.md`).

### 8.2 flow-worker: after-hours or weekend only

A flow-worker restart drops the Massive OPRA websocket and **Massive does not replay** — every second
of that gap is lost permanently until the T+1 flat file. That is physics, not policy, and it is the
only reason a deploy window exists at all.

```sh
python tools/flow_worker_watch_coverage.py     # what this branch changes vs what flow-worker watches
```

⛔ **The tier is decided by the FILES, not by the clock.** Docs, tests, tools, scripts and `app/**`
restart `web` only and can go any time. The full rule, the literal watch patterns and the
ADDITIVE / BEHAVIOUR-CHANGING classification a red requires are in `docs/runbooks/deploy-windows.md`,
which is the single authority. **This runbook states no rule of its own about push timing.**

⚠️ Nothing in the Discord render programme has ever touched flow-worker's watch list: it was
`SKIPPED` on every push across master merges 1–5 (`LEDGER.md`). `/flow` *reads* flow-worker over
HTTP; it does not deploy it.

### 8.3 chart-renderer is its own deploy

Since 2026-09-13 the service is connected to the repo with watch pattern `services/chart_renderer/**`
and `rootDirectory` `services/chart_renderer` (`LEDGER.md`, step 1.2), so a master push containing a
renderer change deploys it and a push without one arrives `SKIPPED` — proven on the next two pushes.
A renderer restart drops any in-flight render.

⚠️ Before that change it had **no repo source** and was deployed with `railway up`. If you read an
older document saying "no push deploys chart-renderer", that is why.

### 8.4 Never run a heavy job on the production pod

The report card and any heavy script have OOM'd the web pod into a member outage twice. Heavy local
jobs go through `uct-clips/tools/heavy_lock.py`.

---

### 8.5 ⛔⛔ The bot does NOT get `MANAGE_ROLES`. Channel permission work is a browser task.

**Owner ruling, 2026-09-14 (OI-33).** The render bot holds `MANAGE_CHANNELS`. It does **not** hold
`MANAGE_ROLES` and must not be given it.

**What that means in practice, measured rather than assumed:**

| Task | Bot | Why |
|---|---|---|
| read any channel's overwrites | ✅ `discord_channel_admin.py --list-channels` | `GET /guilds/{id}/channels` returns overwrites for **every** channel, including ones the token cannot open |
| post, attach files | ✅ | proven by a real post: `DELIVERY OK http=200 attachments=1` |
| **create** a channel carrying overwrites | ❌ **403 `50013`** | Discord requires `MANAGE_ROLES` to set overwrites, even at creation |
| **edit** an existing channel's overwrites | ❌ **403 `50013`** | same |

⭐ **`MANAGE_CHANNELS` was granted expecting it to cover both, and it covers neither.** The two 403s
are the measurement; do not re-derive this from the permission's name.

⛔ **Do NOT "fix" a 50013 by granting `MANAGE_ROLES`.** It would let the bot rewrite overwrites on
**any** channel in a 1,558-member guild and manage every role beneath its own — a standing
capability, bought to save a few clicks on a task performed a handful of times a year. The trade is
wrong even though the error message points straight at it.

**So: channel creation and overwrite edits are done in the browser**, under the T-12 charter (the
owner's session, real pointer and keyboard, screenshots per step), and then **read back by API** —
`discord_channel_admin.py --read-channel <id>` — because the request is not the evidence and the
Discord UI has twice reported a change that the read-back described differently.

⚠️ And `50001 Missing Access` is **membership**, not permission level: a bot with every permission
in the guild still gets 50001 on a channel it has no overwrite on. Those two error codes send you
to two different fixes.

## 9. Routine operations

**Find everything about one job.** Take the `cid` from the member's failure message, then:
`python tools/railway_env_logs.py --filter drender` and grep for it; the durable row is in
`/data/discord_render_jobs.db` keyed on `corr_id`.

**Register or unregister `/renderhealth`.** Commands on this app are **per-guild, not global** — a
`--global` PUT would give every member a second copy of every command (`LEDGER.md`, step 1.2b):

```sh
python tools/discord_chart_commands.py register --guild <GUILD_ID> --renderhealth   # with
python tools/discord_chart_commands.py register --guild <GUILD_ID>                  # without
python tools/discord_chart_commands.py show                                         # what is registered
```

**Check the renderer directly** — `GET /health` on chart-renderer reports `ready`,
`browser_connected`, `pool_enabled`, `renders_total`, `renders_since_recycle`, `active`, `queued`,
`rss_mb`, `last_render_ms`, `p95_render_ms`, `recycles`, `pool_hits`, `pool_misses`, `timeouts`,
`failures`, `launch_error` (`services/chart_renderer/app.py:505-523`).

**Turn something off.** Every switch, its polarity, what it reaches and how long it takes:
`docs/discord-render/06-flip-packet.md` §3 and §5. ⛔ A failing post-deploy smoke is rolled back
first and diagnosed second (rule H15) — and INCONCLUSIVE is not FAILED.

**Add a command.** Four places, and missing any one of them ships something a member cannot reach
or cannot be answered by:

1. a builder in `api/services/discord_interactions.py` (`build_*_command()`), added to the list
   `all_commands()` returns — that function is what the registrar PUTs;
2. a handler in `api/services/discord_render/commands.py`, registered in `HANDLERS` under the
   command name, taking a `JobContext` and ending in a terminal state (delivered, or `ctx.fail`
   with a class — ⛔ never both, never neither: C-11 is 46 finals that produced no message);
3. any upstream it needs bound through `adapters/bindings.py`, so the call is inside
   `min(dependency timeout, the job's remaining time)` and behind its own breaker;
4. `python tools/discord_chart_commands.py register --guild <GUILD_ID>` — **per-guild, never
   `--global`**, see above.

⛔ Components carry a `custom_id` ≤ 100 characters and only emoji in `delivery.EMOJI_ALLOWED`.
Discord validates the component tree as a UNIT and refuses the whole message for one bad emoji —
that is C-03, 33 charts that lost every control for a week.

**Update the goldens.** A golden changes only when the rendered output is *meant* to change, and
the diff is the review:

```sh
python docs/discord-render/instruments/golden_capture.py --self-check     # proves it can fail
python docs/discord-render/instruments/golden_capture.py --write          # re-capture
python -m pytest tests/test_discord_render_goldens.py -q                  # then this must be green
```

⛔ **Re-capture and commit in the same change as the code that moved the output, never separately.**
A golden refreshed on its own is a recorded decision that nobody reviewed. ⚠️ And a golden test that
reads the STORED file rather than a FRESH capture cannot fail — that exact weakness was found and
fixed in this programme, by a mutation that should have gone red and did not.

**Rotate `CHART_RENDER_TOKEN`.** The render URL's bearer is a live credential and it appears in the
URL, so rotation is two-phase and never a single `--set`:

1. set the new `CHART_RENDER_TOKEN` (+ `VITE_CHART_RENDER_TOKEN`) on `web` and move the old value
   to `CHART_RENDER_TOKEN_PREVIOUS` / `VITE_CHART_RENDER_TOKEN_PREVIOUS` — browsers holding the
   previous bundle still present the old one;
2. verify a **new boot** and read the value **in-process**, never from `--kv` (CLAUDE.md:
   `railway variables --set` has been measured both staging and auto-redeploying);
3. the `_PREVIOUS` pair is cleared by the scheduled task **UCT Render Token Retire**
   (`C:\Users\Patrick\uct-q1-observe\render_token_retire.cmd`, Mondays 07:15 local), which refuses
   to run until that morning's wire has completed. Opt out with a `render_token_retire.disabled`
   marker beside it.

⛔ **Do NOT put `CHART_RENDER_TOKEN` on chart-renderer** — §7 above, and it is the trap on this
path most likely to look like the fix.

---

## 9b. The artifact cache — two tiers, one flag

`RENDER_CACHE_ENABLED` on `web`. **An enablement gate, so unset means OFF** — it ADDS behaviour and
must not switch itself on in every environment the moment it merges. (Contrast `HUB_PREVIEW_ENABLED`
elsewhere in this repo, which is a KILL switch and therefore defaults ON. The polarity is not a
style choice: a kill switch must not confuse "nobody set it" with "somebody shut it down".)

| Tier | Where | Bound | Survives a restart |
|---|---|---|---|
| **L1** | process heap | `DISCORD_RENDER_CACHE_MEM_BYTES`, 64 MiB | no |
| **L2** | the Railway volume, `DISCORD_RENDER_CACHE_DIR` (`/data/discord_render_cache`) | `DISCORD_RENDER_CACHE_BYTES`, 512 MiB, LRU **by bytes** | **yes** |

A lookup is L1 → L2 → render; an L2 hit promotes into L1. ⛔ **L1 eviction never reaches L2 and L2
eviction never reaches L1** — they are different budgets over different resources.

**Why L2 exists at all:** this pod's median deployment serves **8.4 minutes**, so an in-memory cache
is empty exactly when the first render after a deploy needs it most. That is the same measurement
that made in-memory look sufficient, read the other way round.

⛔⛔ **THE DATA'S VINTAGE IS PART OF THE KEY, AND EVERYTHING ELSE FOLLOWS FROM THAT.** Two renders of
one symbol at one vintage are the same picture, so a hit is not a degradation and carries **no
label** — a badge on a cache hit would be furniture. ⚠️ If the vintage ever leaves the key, the cache
serves yesterday's chart under today's badge. That is mutation `W2`, not a comment.

⛔ **A stand-in is never cached** (OI-32). Both tiers refuse an artifact carrying `is_standin` and
count the refusal (`refused_standin`, `l2_refused_standin`). C-06 measured three stand-ins of which
two never healed; caching one serves it to everyone for a TTL and the coalescer fans it out to every
follower at once.

**Reading it:** `artifact_cache.store().stats()` — `hits`, `misses`, `l2_promotions`,
`l2_served_unpromoted`, `refused_oversize`, `refused_standin`, `coalesced_followers`.
⛔ A hit rate of **zero over zero lookups is not a bad cache, it is no measurement**; the tooling
reports `None` there and so should you.

**Turning it off:** unset `RENDER_CACHE_ENABLED`. With it off the render path is `produce()` and
nothing else — not a lookup that misses, not a key computed and thrown away
(`test_with_the_flag_off_the_render_path_is_byte_for_byte_what_it_was`).
⛔ `clear()` empties the heap only. The durable tier goes only on `clear(l2=True)` — stopping
something is never a delete against durable data.

---

## 9c. Shadow mode, and how to read the line

`RENDER_V2_SHADOW=1` on `web`. It records what V2's **acknowledgement decision** would have been,
after the member's reply has already been returned, on a pool. It changes nothing a member sees.

```sh
python tools/railway_env_logs.py --filter drender \
    --since <ISO> --until <ISO> --out shadow.jsonl
python docs/discord-render/instruments/shadow_report.py shadow.jsonl
```

**What the line says, field by field:**

| Field | Meaning |
|---|---|
| `records: N` | how many interactions were shadowed. ⛔ If the pull was truncated this prints `>= N` — a FLOOR, not a count |
| `agree` | V2 would have done what the old path did |
| `divergence` | V2 would have REFUSED a symbol the old path drew. **This is the number the flip rests on** |
| `could_not_tell` | V2 could not resolve the symbol — ⛔ **never summed with `agree`**; "we agreed" and "we could not tell" both produce zero refusals and only this separates them |
| `budget` | the shadow gave up inside its 0.6 s budget: a MISSING sample, not a fast one |
| `error` | the shadow itself failed |

⛔⛔ **A DIVERGENCE COUNT OF ZERO IS MEANINGLESS WITHOUT ITS DENOMINATOR.** Zero over 8 records and
zero over 800 are the same headline and different facts. The sample size prints first for that
reason.

⛔ **A command with no records is not a clean command.** "Nobody ran it" and "it is not being
shadowed" are indistinguishable from the line alone — the report says so rather than implying
health. Settling it takes an EXACT pull *plus*
`tests/test_discord_render_shadow_reaches_chart.py`, which drives the real route with a real
Ed25519 signature.

**What would block a flip:** a divergence class implying V2 would have produced a **WRONG** chart —
not a slower or a degraded one. Those are forensics rows.

---

## 9d. Rollback — one variable, and what each one costs

| Want to stop | Set | Reaches members | Redeploy? |
|---|---|---|---|
| **V2 entirely** | unset `DISCORD_RENDER_V2_ENABLED` on `web` | next interaction | no — read per call |
| one command only | `DISCORD_RENDER_V2_{CHART,FLOW,BUZZ,CONTROLS}_ENABLED=0` | next interaction | no |
| the adapters, keeping V2 | `DISCORD_RENDER_V2_ADAPTERS_ENABLED=0` | next job | no — read per call |
| the cache | unset `RENDER_CACHE_ENABLED` | next render | no |
| shadow recording | `RENDER_V2_SHADOW=0` | next interaction | no |

⛔ **Verify the RUNNING PROCESS, never `--kv`.** `--kv` shows what the service is configured with,
which is not evidence the process has it — and `railway variables --set` has been measured both
staging and auto-redeploying on this project. Read it in-process over `railway ssh`.

⛔ **A failing post-deploy smoke is rolled back FIRST and diagnosed second** (rule H15). And
**INCONCLUSIVE is not FAILED** — rolling back on an unmeasured deploy teaches everyone to stop
running the check.

---

## 9e. Recycling the renderer pool — TWO paths, and they recycle different things

⛔ **Do not read one as the other.** They differ in what they destroy, what they cost a member, and
which counter on `/health` they move. Both live in `services/chart_renderer/app.py`, and both are
inert unless `RENDER_POOL_ENABLED` is on — with the pool off there is no pool to recycle.

| | **Organic** — the RSS / render ceiling | **On demand** — `POST /admin/pool/recycle` |
|---|---|---|
| Recycles | the whole **browser** (Chromium) and every spare context on it | exactly **one idle pooled page** |
| Trigger | `slot.renders >= RENDER_RECYCLE_AFTER` (500) **or** container RSS over `RENDER_RSS_CEILING_MB` (2500), evaluated after every render (`_after_render`) | an operator calls the endpoint |
| Member cost | none at the moment of retirement — the replacement Chromium is launched immediately and the old one closes only when its **last in-flight render finishes**. Measured +56 ms p50 at a recycle every 12 renders (`05-progress.md`) | none. It takes an **idle** page; a context handed to a render has already been removed from the pool, so there is nothing in the pool a render can be using |
| Counter | `recycles` on `/health`, and `renders_since_recycle` resets | `page_recycles` on `/health` |
| Log line | `pool: recycling chromium after N renders (rss_mb=…)` | `pool recycle cid=… recycled=… replaced_by=… idle=A->B browser=… reason=…` |

⭐ **The counters are separate on purpose.** `recycles` and `renders_since_recycle` are how anyone
reading `/health` (or `LEDGER.md`'s "evidence of a NEW browser") knows Chromium restarted. A page
recycle that bumped `recycles` would make both of those stop meaning that.

### Arming the on-demand lever

**Two variables on `chart-renderer`, and it is off without both.** `RENDER_ADMIN_ENDPOINTS` is an
*enablement* gate (it ADDS a lever), so **unset means OFF** — the opposite polarity to a kill switch
like `RENDER_CACHE_ENABLED`'s neighbours in §9b, for the reason given there.

```sh
railway variables --service chart-renderer --set "RENDER_ADMIN_TOKEN=$(python -c 'import secrets;print(secrets.token_urlsafe(32))')"
railway variables --service chart-renderer --set "RENDER_ADMIN_ENDPOINTS=1"
# then verify a NEW BOOT and read it IN-PROCESS — `--kv` is what the service is configured with,
# which is not evidence the running process has it (CLAUDE.md: `--set` has been measured BOTH ways).
```

⛔ **`RENDER_ADMIN_TOKEN` is deliberately not `CHART_RENDERER_SECRET`.** The render secret is handed
to `web` on every single render; an operator lever must not be reachable with a credential the
render path already carries. An unset `RENDER_ADMIN_TOKEN` **locks** the lever (401), it does not
open it.

**Disarm:** `railway variables --service chart-renderer --unset RENDER_ADMIN_ENDPOINTS`. The gate is
read per request, so the route goes back to 404 on the next call — no redeploy, and nothing about
rendering changes either way.

### Firing it

chart-renderer has **no public domain** — it is reachable only on Railway's private network
(`CHART_RENDERER_URL=http://chart-renderer.railway.internal:8080`), so the call is made from inside
a pod. From the renderer's own shell:

```sh
railway ssh --service chart-renderer
curl -sS -X POST http://127.0.0.1:8080/admin/pool/recycle \
  -H "Authorization: Bearer $RENDER_ADMIN_TOKEN" \
  -H "X-Correlation-Id: $(python -c 'import secrets;print(secrets.token_hex(4))')"
```

If `curl` is not in the image, the same call on the **standard library** — `services/chart_renderer/
requirements.txt` is fastapi + uvicorn + pydantic + playwright and nothing else, so do not reach for
`httpx` or `requests` here:

```sh
railway ssh --service chart-renderer -- python -c "import os,json,secrets,urllib.request as u; \
q=u.Request('http://127.0.0.1:8080/admin/pool/recycle', method='POST', headers={ \
'Authorization':'Bearer '+os.environ['RENDER_ADMIN_TOKEN'],'X-Correlation-Id':secrets.token_hex(4)}); \
print(json.dumps(json.load(u.urlopen(q, timeout=30)), indent=1))"
```

⚠️ `urlopen` raises `HTTPError` on 401/404 rather than returning them — catch it, or you will read a
traceback as "the service is down" when it is the gate answering correctly.

From the `web` or `worker` pod instead, swap the host for `chart-renderer.railway.internal:8080`.

⚠️ `X-Correlation-Id` must be **exactly 8 lowercase hex characters** or it is logged as `-` —
the same rule `/render` uses, so a recycle can be joined to the renders around it in one log grep.

### Reading the reply

**200 is not by itself evidence anything was recycled.** Read `recycled` and `reason`:

| Field | Means |
|---|---|
| `recycled` | the page that was taken: `id`, `width`/`height`/`scale`, `renders`, `age_s`. **`null` means nothing was taken** — `reason` says why |
| `replaced_by` | the fresh page created in its place, through the same `_replenish` every spare context comes from |
| `reason` | `null` on a clean recycle. `pool disabled`, `no live browser` or `pool empty` alongside `recycled: null` — each an **answer**, not an error, because the ruling forbids forcing one. ⚠️ It is also non-null **with** a `recycled` page when the replacement could not be created: the page went, the pool is one short, and `idle` will be one lower in `after` |
| `before` / `after` | `size` (= `idle` + `in_use`), `in_use`, `idle`, `pages[]` (one entry per idle pooled page), `browser` (`id`, `connected`, `retired`, `renders_since_launch`), and all four counters |

**What to check, and it is the whole point of the before/after pair:**

- `before.browser.id == after.browser.id` ⇒ **Chromium was not restarted.** A replacement browser
  answers `connected: true` just as happily, so the id is the only thing that settles it.
- `before.idle == after.idle` and exactly one id in `before.pages` missing from `after.pages`
  ⇒ **exactly one page**, not the pool.
- `after.recycles == before.recycles` ⇒ nothing tripped the organic path while you were looking.

⚠️ **Per-page `renders` is 0 for every idle page, by construction and not by accident.** A spare
context serves exactly one render's page and is then closed, so a page still sitting in the pool has
served none. The cumulative count that drives the organic ceiling is `browser.renders_since_launch`.

⚠️ Two concurrent calls take two **different** pages (the entry is popped, so only one caller can
get it); they never fight over one and never take the browser.

### What it is for

Determinism-across-recycle and the self-heal chaos row need a recycle they can **cause**. Before
this, the only way to cause one was to restart the browser or the service, which drops every
in-flight render — so the measurement changed the thing it was measuring. Owner ruling B1,
2026-09-14.

---

## 10. Measurement pitfalls — instruments on this path that have lied

Each of these produced a confident, wrong reading in this programme. They are here because the
next person to measure this system will reach for the same instrument.

- **⛔⛔ A TRUE STATEMENT ABOUT THE WRONG ENDPOINT IS STILL A WRONG ANSWER.** The `#render-alerts`
  access probe spent a full day reporting `STILL_BLOCKED`, hourly, correctly: `GET /channels/{id}`
  really does answer `403 / 50001` for a channel the bot is not in. The question everyone actually
  had — *which roles can see it?* — was answered by `GET /guilds/{id}/channels`, which returns
  `permission_overwrites` for **every channel in the guild including ones the token cannot open**.
  One call away, for a day. ⭐ **When a probe keeps returning the same refusal, ask whether a
  different endpoint answers the question, before concluding the answer is "no".**
- **⛔⛔ A RUNNER THAT COUNTS WHAT IT WAS ASKED TO DO, NOT WHAT IT DID.** `chaos_scenarios.py --real`
  printed `ran=13 passed=13` while **six** of those scenarios had been refused by name and never
  executed — the chunked-run defect, inside the instrument built to avoid it. `ran` now excludes
  refused, and a refusal carries its reason. ⭐ The shape to distrust: any summary whose numerator
  and denominator come from the same list rather than from what actually executed.
- **⛔⛔ A TEST WHOSE VERDICT DEPENDS ON WHEN IT RUNS REPORTS THE CALENDAR.** Two suites written on a
  Sunday were green all weekend and red at Monday's open — and the first thing one of those reds did
  was **refuse a mutation harness's control run, so eighty mutation proofs did not happen** and
  nothing said so. `clock_sweep.py` pins the product's market clock (`freshness.now_et()`, never the
  OS clock — moving that would also move file mtimes and pytest's own bookkeeping) to four instants
  spanning every session state and reports any test whose verdict differs. **1,220 observations,
  CLEAN** — and that CLEAN is only worth stating because planting the old assertion back makes it
  report the test by name. ⭐ **It is permanently in the gate** as
  `tests/test_clock_sweep_in_the_gate.py`; before that wiring the string `clock_sweep` appeared
  nowhere in the repo but its own filename, and an instrument nobody runs reads as coverage.
- **A wrapper must not fight the script it wraps for that script's log file.** `UCT Render Token
  Retire` reported `lastRun=07:15, LastTaskResult=1` and had **never done anything**: the `.cmd`
  redirected stdout into the same path the Python script opens for append, so the script died on its
  first `log()` call with `PermissionError` — and the crash handler died on the same line. ⭐ The
  failure is invisible except by reading the log it could not write. Give the wrapper its own
  `.wrapper.log` for wrapper-level failures and leave the script's log to the script.
- **`observe.event` silently drops every field outside its allowlist.** Shadow mode ran for ~20
  minutes emitting `{"evt":"shadow","cmd":"chart","ms":12.3}` — lines at the right rate, with
  plausible latency, and **no content at all**, because `outcome` and `detail` were not in
  `_FIELDS`. ⭐ A record that arrives on schedule and says nothing reads exactly like a healthy
  one. Emit inside the allowlist, and there is now an AST rail over the whole package.
- **A probe that is stricter than the path it models under-reports in the flattering direction.**
  The shadow's budget was 0.4 s against the ack path's 0.6 s, so it would have bailed precisely
  where V2 succeeds — and "few divergences" is what a flip is authorised on.
- **A budget computed once per call is not a deadline.** `_call.guarded` derived its budget per
  CALL rather than per ATTEMPT, so an N-attempt hop could spend N × the deadline; the chaos
  harness measured **4.6 s against a 2 s deadline** in the layer built to prevent exactly that.
  Live blast radius was zero only because `bindings` passed `attempts=1` for an unrelated reason.
- **A `railway ssh` probe imports modules cold and is not the running pod.** One reported
  `ticker_search_index.ready()` False and every symbol unanswerable — a production outage that did
  not exist. The tell is the pid: the server is pid 1, the probe was pid 569.
- **A bench whose stub the code never looks up benches the live path.** The first adapter bench
  reported adapters FASTER than raw, because the adapter ignored the stub. Pin the double where
  the code's own lookup finds it, and add a live probe that refuses to bench otherwise.
- **A `-k` filter is not a scope, and a filter that matches nothing exits 0.** Collection is where
  the memory goes; a vitest `-t` matching nothing is a false PASS.
- **Reading `grep`'s exit code is not reading the command's.** A `push | grep` reported `rc=0`
  while the push had been refused.
- **`/api/health` 200 and a rising uptime are compatible with a completely broken member
  experience** — that is rule H14, and it cost 4.5 hours of app-wide broken navigation once.
- **A file mtime moving is not a write.** Opening a WAL database read-only rewrites its `-shm`;
  judge a leak by the main `.db`'s content.
- ⛔⛔ **A MUTATION THAT DID NOT APPLY IS A PROOF THAT DID NOT HAPPEN, AND `78/80 RED` READS LIKE A
  NEAR-PERFECT SCORE.** Mutation **A29** — "the V2 handlers bind adapters and not the raw clients" —
  sat stale through several merges because its anchor string had moved, so the harness skipped it
  and printed the skip as a footnote under the number people quote. **Ruling, 2026-09-14:
  NOT-APPLIED ≠ 0 FAILS the harness; it is never just printed**, and the count sits on the summary
  line beside the RED count. Run the one-second dry check before committing to a 25-minute set.
- **The log pager could not tell "the end of the data" from "a stall", so every count was a floor.**
  `railway_env_logs.py` printed *"STOPPED: no progress past …"* for a complete pull, which made
  `>= 8` the best the Monday shadow line could say — and left "nobody ran `/chart`" and "the pager
  stopped early" indistinguishable. The discriminator is whether the page came back FULL; the
  output file now carries a `_meta` header saying whether its own count is exact.
- ⛔⛔ **"EXACT" AND "A FLOOR" ARE DIFFERENT NUMBERS AND AN INSTRUMENT MUST SAY WHICH IT HAS.**
  `railway_env_logs.py` printed *"STOPPED: no progress past …"* for a pull that had simply reached
  the end of the data, so **every** count it produced was a floor — and "nobody ran `/chart`" could
  not be told from "the pager stopped early". The discriminator is whether the page came back FULL;
  an under-full page means the API returned everything it had. The output file now carries a
  `_meta` header stating whether its own count is exact, and `shadow_report.py` reads it rather
  than trusting a `--pager-stopped` flag someone remembered to pass.
- ⛔⛔ **AN ABSENCE IN ONE COMMAND'S RECORDS SAYS NOTHING ABOUT THE HOOK UNTIL YOU MUTATE IT.**
  Zero `/chart` shadow records beside eight `/flow` ones has two explanations — no traffic, or no
  hook — and reasoning cannot separate them. What did: an EXACT log pull (8 interactions, all
  `/flow`, one 11-second burst) **plus** a rail that drives the real route with a real Ed25519
  signature, parametrised over both commands, **plus** two mutations that make it red. Prose was
  not enough at any point.
- ⛔⛔ **A TEST THAT READS THE WALL CLOCK REPORTS THE CALENDAR.**
  `test_bars_come_back_with_a_vintage_derived_from_the_newest_bar` asserted the session word was
  `WEEKEND` or one of `CLOSED_STATES`. It was written on a Sunday, was green all weekend, and went
  red at 04:00 ET Monday when the session became `pre` — **and the first thing that red did was
  refuse the mutation harness's control run, so eighty mutation proofs did not happen.** The fix is
  never a wider allow-list: the session word is a function of the clock, and `freshness` takes
  `now=` precisely so the clock is an input you pass rather than a fact you inherit. Expect this
  class to bite again at 09:30 and 16:00 ET.
- **A shadow record for one command is not evidence about another.** Eight records, all `/flow`,
  zero `/chart`: the hook was fine and there was simply no `/chart` traffic — but that took an
  exact log pull *and* an end-to-end rail to establish, and neither existed at the time.
  `tests/test_discord_render_shadow_reaches_chart.py` drives the real route with a real Ed25519
  signature so the structural half can never be the open question again.

---

## 10b. Standing rules for anyone operating this

### ⛔⛔ NEVER POST INTO A CHANNEL WHOSE OVERWRITES YOU HAVE NOT READ **THIS SESSION**

Owner ruling, 2026-09-14. Before any automated write to a Discord channel — a smoke run, a bench,
a backfill, a test post — read that channel's permission overwrites and confirm who can see it:

```sh
railway run -p <project> -e production -s web \
  python docs/discord-render/instruments/discord_channel_admin.py --read-channel <id>
```

It prints the overwrites **as Discord holds them**, role by role, allow and deny named rather than
as a bitmask.

⭐ **Why "this session" and not "once".** A channel's overwrites are edited by people, and the cost
of being wrong is asymmetric: a read costs one API call, and a mistake puts bot traffic — or a
degraded chart, or a failure message with a correlation id in it — in front of members. A channel
that was private last week is not evidence about today.

⛔ **The request that created a channel is not evidence either.** Discord can accept a create and
apply the overwrites differently from what was asked — an unknown role id, a permission the caller
cannot grant. `--create-smoke` therefore always follows the create with a `GET` and prints what
came back; that read-back is the evidence, not the payload that was sent.

⛔ **403 `50001 Missing Access` is MEMBERSHIP, not permission level.** A bot can hold Administrator
and still get 50001 for a channel it is not in. `--whoami` reports what the token's roles GRANT;
`--read-channel` reports what a given channel ANSWERS. Collapsing the two sends you to grant a
permission that was never the problem.

---

## 11. What this runbook does not cover

- **The flip and the rollback procedure** → `docs/discord-render/06-flip-packet.md`.
- **Why any of it is built this way** → `docs/discord-render/03-architecture.md`; the SLO definitions
  are its §1, the kill-switch table its §3.11.
- **What a member SEES when the path is degraded** (the STALE badge, the stand-in label, the footer)
  → `docs/discord-render/04-visual-spec.md`.
- **Push timing** → `docs/runbooks/deploy-windows.md`, the single authority.
- **What broke before this programme**, with counts → `docs/discord-render/01-failure-forensics.md`;
  the pre-change numbers are `02-baseline.md`.
- **Where the programme is right now** → `docs/RESUME.md` and `docs/discord-render/LEDGER.md`.

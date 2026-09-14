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

---

## 10. What this runbook does not cover

- **The flip and the rollback procedure** → `docs/discord-render/06-flip-packet.md`.
- **Why any of it is built this way** → `docs/discord-render/03-architecture.md`; the SLO definitions
  are its §1, the kill-switch table its §3.11.
- **What a member SEES when the path is degraded** (the STALE badge, the stand-in label, the footer)
  → `docs/discord-render/04-visual-spec.md`.
- **Push timing** → `docs/runbooks/deploy-windows.md`, the single authority.
- **What broke before this programme**, with counts → `docs/discord-render/01-failure-forensics.md`;
  the pre-change numbers are `02-baseline.md`.
- **Where the programme is right now** → `docs/RESUME.md` and `docs/discord-render/LEDGER.md`.

# Discord `/chart` command — design

**Date:** 2026-08-25
**Status:** approved in chat (owner), spec written for the implementation plan
**Repo / service:** `uct-dashboard` → Railway `web` (uctintelligence.com)

## Goal

A member of the Uncharted Territory Discord types `/chart NVDA` (optionally with a
timeframe) and, a few seconds later, the bot's reply in that channel is a clean
chart image: candles, volume, 10/20/50 SMA, in the Substack brand palette.
Nothing else on the image. Works whether or not the owner's PC is on.

## Non-goals

- No annotations, setup labels, entry/stop lines, or AI commentary on the chart.
- No gateway (WebSocket) bot. No new Railway service. The local `uct_intelligence`
  discord.py bot is untouched.
- No per-user preferences, no saved charts, no chart history in Discord.
- Not a replacement for the dashboard's `/api/chart/{ticker}` (yfinance PNG) or
  the pattern-vision renderer; both stay as they are.

## What already exists (and is reused)

| Piece | Where | Reused how |
|---|---|---|
| Bars for every timeframe, fetch-on-miss from Massive, index/breadth/delisted/yf-only dispatch | `api/routers/bars.py::get_bars` → `api/services/bars_fetch.py` | Called **in-process** as the single bars authority. Its `JSONResponse.body` is parsed; nothing about bar sourcing is re-implemented. |
| mplfinance + matplotlib in the `web` image | `requirements.txt` | Renderer uses them; no new plotting deps. |
| Brand palette + chart typography | `morning-wire/substack/charts.py` (BASE `#191c17`, GOLD `#c9a84c`, GREEN `#3cb868`, RED `#e74c3c`, CREAM `#f0ead8`, GRID `#2c3128`, DejaVu Sans) | Palette is copied into the renderer as constants (cross-repo import is not possible on Railway). |
| Discord multipart file posting pattern | `api/discord_watchlist.py::post_image` (httpx, `files={"file": ...}`) | Same httpx shape, different URL (interaction followup webhook). |
| Background work after responding | `fastapi.BackgroundTasks` (used in `admin_chart_health.py`, `cot.py`) | Same mechanism. |
| Chart file naming | `TICKER_TF_YYYY-MM-DD_TAG.png` (uct-conventions) | Attachment filename. |

## Architecture

```
Discord user ──/chart NVDA tf:D──▶ Discord ──POST (Ed25519-signed JSON)──▶
  https://uctintelligence.com/api/discord/interactions
     │
     ├─ verify signature (PyNaCl) ── bad/missing → 401 ── key unset → 503
     ├─ type 1 PING ─────────────────────────────▶ {"type": 1}
     ├─ /chart with invalid ticker/tf ───────────▶ {"type": 4, ephemeral error}
     └─ /chart valid ───────────────────────────▶ {"type": 5}  (deferred, < 50 ms)
              │
              └─ BackgroundTasks (threadpool):
                   bars = api.routers.bars.get_bars(ticker, tf=tf, bars=N+50)
                   png  = render_chart_png(ticker, tf, bars)
                   PATCH discord.com/api/v10/webhooks/{APP_ID}/{token}/messages/@original
                         multipart: payload_json + files[0]=PNG
                   (any failure → same PATCH with a one-line text reply)
```

Discord's contract that shapes this: the endpoint must answer within **3 s**;
a deferred reply (type 5) can be edited for **15 min** via the interaction
token, using the **application id + token only** (no bot token on the server).

## Components

### 1. `api/services/discord_chart_render.py`

`render_chart_png(ticker: str, tf: str, bars: list[dict]) -> bytes`

- Input bars are exactly what `/api/bars` serves: `{"t","o","h","l","c","v"}`.
  Daily/weekly `t` is `"YYYY-MM-DD"`; intraday `t` is unix seconds → converted
  to `America/New_York` for the axis.
- SMA 10/20/50 are computed on the **full** input, then the frame is sliced to
  the last `WINDOW[tf]` bars so every MA line is complete across the visible
  window (no partial MA at the left edge). `WINDOW = {D:120, W:104, 60:100,
  30:130, 15:130, 5:156}`. The caller requests `WINDOW + 50` bars.
- mplfinance `type="candle"`, `volume=True`, custom `make_mpf_style` on the brand
  palette (dark base, green/red candles with inherited wick/edge, cream ticks,
  dashed grid in GRID), `figsize=(11, 6.2)`, `dpi=110` → ~1210×680 px.
- Title, left-aligned, gold, bold: `NVDA · Daily · 182.45 (+1.8%)`. The % is the
  last close vs the prior bar's close. Timeframe words: Daily / Weekly /
  60 min / 30 min / 15 min / 5 min. Small cream footer bottom-right:
  `as of 2026-08-25 16:00 ET · uctintelligence.com` (intraday shows the bar time;
  daily/weekly show the session date).
- Fewer than 3 bars → `ValueError("not enough bars")`. 3–49 bars still render;
  MAs that lack their period are simply absent.
- A module-level `threading.Lock` wraps the matplotlib call (matplotlib is not
  thread-safe; the API runs handlers in a threadpool). `matplotlib.use("Agg")`
  before pyplot import, like `api/routers/charts.py`.
- Pure function: no network, no env, no Discord.

### 2. `api/services/discord_interactions.py`

Pure helpers, no FastAPI objects:

- `verify_signature(public_key_hex, signature_hex, timestamp, body: bytes) -> bool`
  — PyNaCl `VerifyKey(...).verify(timestamp.encode() + body, sig)`; any exception
  → `False`. Never raises.
- `parse_chart_command(interaction: dict) -> ChartRequest` — reads
  `data.options`; `ChartRequest(ticker: str, tf: str)`. Ticker is upper-cased,
  stripped of a leading `$`, must match `^[A-Z0-9.^-]{1,12}$`; tf must be one of
  `D W 60 30 15 5` (default `D`). Raises `CommandError(message)` on anything
  else — the message is what the user sees.
- `TF_CHOICES` — the single list that feeds both the command registration
  script and validation (one authority, never restated).
- `attachment_name(ticker, tf, last_bar_t) -> str` → `NVDA_D_2026-08-25_Chart.png`
  (`60m/30m/15m/5m` for intraday tf so the name still matches the house pattern).
- `edit_original(app_id, token, *, content: str, png: bytes | None, filename: str | None) -> bool`
  — `PATCH https://discord.com/api/v10/webhooks/{app_id}/{token}/messages/@original`.
  With a PNG: multipart with `payload_json` (`{"content", "attachments":[{"id":0,"filename"}]}`)
  and `files[0]`. Without: JSON `{"content"}`. httpx, 15 s timeout, returns
  `resp.is_success`; logs and returns `False` on any exception. Never raises.
- `run_chart_job(app_id, token, req: ChartRequest, *, bars_fn, render_fn, edit_fn)`
  — the background job, dependency-injected for tests:
  1. `bars_fn(req.ticker, req.tf, WINDOW[tf] + 50)` → `list[dict]` or `None`
  2. empty/None → `edit_fn(content=f"No bars for {ticker} ({tf label}).")`
  3. render → on exception `edit_fn(content="Chart failed, try again.")`
  4. `edit_fn(content=f"{ticker} · {tf label}", png=..., filename=...)`
  Wrapped in one outer `try/except` that logs; the job never raises.
- `render_slot()` — `threading.BoundedSemaphore(2)` context; `acquire(blocking=False)`
  fails → the job edits the reply to `Busy, try again in a few seconds.` and
  returns.

### 3. `api/routers/discord_interactions.py`

`POST /api/discord/interactions`

- Reads the **raw** body (`await request.body()`), never a parsed model, because
  the signature is over the exact bytes.
- `DISCORD_CHART_PUBLIC_KEY` unset/blank → `503 {"error":"discord interactions not configured"}`.
  Missing `X-Signature-Ed25519` / `X-Signature-Timestamp` or a bad signature → `401`.
- Decodes JSON after verification.
- `type == 1` → `{"type": 1}`.
- `type == 2` and `data.name == "chart"`: `parse_chart_command`; `CommandError` →
  `{"type": 4, "data": {"content": msg, "flags": 64}}` (ephemeral, no defer).
  Valid → schedule `run_chart_job` on `BackgroundTasks` with the real
  `bars_fn`/`render_fn`/`edit_fn`, return `{"type": 5}`.
- Any other command/type → `{"type": 4, "data": {"content": "Unknown command.", "flags": 64}}`.
- The real `bars_fn` calls `api.routers.bars.get_bars(ticker, tf=tf, bars=n)`
  directly (it is a plain sync function), accepts only `status_code == 200`,
  parses `json.loads(resp.body)["bars"]`; anything else → `None`. This is the
  one place that touches bar sourcing.
- `app_id` for the followup comes from the interaction payload
  (`application_id`), so the server needs only the public key to operate;
  `DISCORD_CHART_APP_ID` is read as a fallback/consistency check only.

Mounted in `api/main.py` next to `charts.router` with one `include_router` line.

### 4. `tools/discord_chart_commands.py` (local, one-shot)

Run from the owner's machine with the app's **bot token** (never stored on
Railway). Subcommands:

- `show` — `GET /applications/@me` → prints application id and `verify_key`
  (the public key), so the Railway vars can be set from a known-good source.
- `register --guild <id>` — `PUT /applications/{app_id}/guilds/{guild}/commands`
  with the one `chart` command built from `TF_CHOICES` (ticker: string,
  required; tf: string with choices, optional). Guild-scoped so it is live
  immediately. `register --global` — `PUT /applications/{app_id}/commands`,
  one registration for every server the app is installed in (the owner
  installed it in both Uncharted Territory and UCT Intelligence). `--clear`
  PUTs an empty list (rollback).
- `endpoint --url https://uctintelligence.com/api/discord/interactions` —
  `PATCH /applications/@me {"interactions_endpoint_url": ...}`. Discord validates
  by sending a PING and a bad-signature request during the PATCH, so this runs
  **after** the deploy is live.
- `invite` — prints `https://discord.com/oauth2/authorize?client_id={app_id}&scope=applications.commands`.

Env: `DISCORD_CHART_BOT_TOKEN` (required), `DISCORD_CHART_APP_ID` (optional; else
from `show`), read from the environment or `--env-file` (defaults to `.env` in
the repo root, which is gitignored).

### 5. Config

| Var | Where | Purpose |
|---|---|---|
| `DISCORD_CHART_PUBLIC_KEY` | Railway `web` | Signature verification. Unset = endpoint dark (503). **This is the kill switch.** |
| `DISCORD_CHART_APP_ID` | Railway `web` | Consistency check / fallback for followup URL. |
| `DISCORD_CHART_BOT_TOKEN` | local `.env` only | Command registration + endpoint URL PATCH. |
| `DISCORD_CHART_GUILD_ID` | local `.env` only | Target guild for registration (UT member server). |

`requirements.txt` gains `PyNaCl` (pinned).

## Command contract

```
/chart ticker:<string, required>  tf:<choice, optional, default Daily>
   choices: Daily=D · Weekly=W · 60 min=60 · 30 min=30 · 15 min=15 · 5 min=5
```

Reply (public, in the invoking channel): content `NVDA · Daily`, one PNG
attachment `NVDA_D_2026-08-25_Chart.png`. Errors that are the user's (bad
ticker, bad tf) are ephemeral and immediate. Errors that are ours (no bars,
render failure, busy) replace the "thinking…" placeholder with one plain line.

## Data contract with the bars authority

- Request `WINDOW[tf] + 50` bars via `get_bars`. The 50-bar lead-in exists only
  so SMA50 is complete at the left edge; it is never drawn.
- Bars arrive sanitized (`_fmt_sqlite_bars` drops null/non-positive OHLC, weekly
  non-Friday keys). The renderer trusts that and does not re-clean.
- The developing (current-session) bar is rendered as served. No "as of" logic
  beyond printing the last bar's time.
- **Intraday frames are regular-session only (09:30–16:00 ET).** Decided on
  real payloads, not in advance: the authority serves pre/post-market buckets
  alongside the session, and a 130-bar window of 15-minute bars was ~2 sessions
  of price plus days of thin extended-hours noise. `build_frame` drops buckets
  outside `[09:30, 16:00)` for intraday timeframes and `bars_to_request(tf)`
  asks for 2.5× the window for intraday so the visible window stays full
  (measured: NVDA 15 min → 5 full sessions, SMA50 complete). Daily/weekly are
  never filtered.
- **A unix-keyed DAILY bar is a UTC date, not an ET instant.** The index path
  (SPX/^GSPC) keys daily bars as unix seconds at UTC midnight; converting those
  to ET dated every bar one day early. `to_datetime(t, tf)` takes the UTC date
  for `D/W/M` and ET wall-clock for intraday. Equity daily bars arrive as
  `"YYYY-MM-DD"` strings and are unaffected.

## Failure handling (complete list)

| Condition | Response |
|---|---|
| Public key not configured | 503, nothing scheduled |
| Missing/bad signature | 401, nothing scheduled |
| Malformed JSON after a valid signature | 400 |
| Unknown command / interaction type | type 4 ephemeral "Unknown command." |
| Bad ticker / tf | type 4 ephemeral with the specific message |
| Both render slots busy | edit → "Busy, try again in a few seconds." |
| `get_bars` non-200 / empty / raises | edit → "No bars for NVDA (Daily)." |
| Renderer raises | edit → "Chart failed, try again." |
| `edit_original` fails (Discord down, token expired) | logged; nothing else possible |

The background job cannot propagate an exception; the endpoint never blocks on
bars or rendering.

## Concurrency and safety

- Signature verification is CPU-only (microseconds); the handler is `async def`
  and does no I/O before returning type 5.
- Rendering runs in Starlette's threadpool via `BackgroundTasks` (sync callable).
  Two concurrent renders max (`BoundedSemaphore(2)`); the matplotlib call itself
  is serialized by the lock. A render is ~0.5 s; cold intraday bars 2–6 s.
- Ticker regex blocks path/query injection into `get_bars` (which is called as a
  function anyway, not over HTTP).
- No secrets in logs: the interaction token is never logged; the bot token
  never reaches Railway.

## Deployment and rollout

Owner-only steps (no API exists for them):
1. Create the Discord application **"UCT Charts"** in the Developer Portal.
2. Authorize the `applications.commands` invite link on the UT server.

Scripted / agent steps:
1. Merge → GitHub-triggered `web` deploy. Verify the route exists:
   `POST https://uctintelligence.com/api/discord/interactions` with no headers
   → expect **401** (route live, key set) — never 404, never 200.
2. `railway variables --set DISCORD_CHART_PUBLIC_KEY=… --set DISCORD_CHART_APP_ID=… --service web`
   (values from `tools/discord_chart_commands.py show`).
3. `tools/discord_chart_commands.py endpoint --url …` (Discord validates live).
4. `tools/discord_chart_commands.py register --guild <UT guild id>`.
5. E2E in a test channel: `/chart SPY`, `/chart NVDA tf:15 min`, `/chart ZZZZQ`
   (expect "No bars"), `/chart "bad ticker!"` (expect ephemeral error). **Open
   the PNGs.** A green suite proves nothing about the picture.
6. Confirm Railway `web` has **Sleep when idle OFF** (the `worker` was found
   sleeping on 2026-08-25; a cold start would miss the 3 s window).

Rollback: unset `DISCORD_CHART_PUBLIC_KEY` on `web` (endpoint → 503; Discord shows
"did not respond"), or `register --clear` to remove the command entirely. No
data, no migrations, no other surface changes.

## Testing

`tests/test_discord_chart.py` (root `tests/`, so discovery enforcement finds it):

- **Signature:** generate an Ed25519 keypair in-test; valid → `True`; tampered
  body / wrong key / garbage hex / missing header → `False`, never raises.
- **Endpoint:** with `DISCORD_CHART_PUBLIC_KEY` set to the test key via
  monkeypatch: PING → `{"type":1}`; unsigned → 401; key unset → 503; `/chart`
  valid → `{"type":5}` and the job was scheduled with the parsed request;
  `/chart` bad ticker → type 4 with `flags` 64 and nothing scheduled; unknown
  command → type 4 ephemeral.
- **Parsing:** `$nvda` → `NVDA`; `brk.b` → `BRK.B`; `^GSPC` accepted; `NVDA;rm`
  rejected; tf default `D`; tf `"7"` rejected; every `TF_CHOICES` value accepted.
- **Renderer:** synthetic daily (170 bars), weekly, intraday (unix `t`) → PNG
  magic bytes, > 10 KB; 5 bars → still a PNG; 2 bars → `ValueError`; output
  frame is `WINDOW[tf]` wide (assert via the SMA slice, not pixels).
- **Job:** injected fakes — bars `None` → edit called with "No bars"; render
  raises → "Chart failed"; happy path → edit called once with PNG + filename
  `NVDA_D_<date>_Chart.png` and content `NVDA · Daily`; semaphore exhausted →
  "Busy".
- **Followup:** `edit_original` with httpx transport mocked → asserts PATCH URL,
  `payload_json` shape (`attachments[0].id == 0`, filename), and `files[0]`
  part present; failure path returns `False` without raising.
- **Registration payload:** the command JSON built by the tool has exactly the
  `TF_CHOICES` values, ticker required, tf optional.

Post-deploy E2E as listed above; the produced PNG is opened and looked at.

## v2 (2026-08-25 evening): the HOUSE image, at 2× resolution, with a stats strip

Owner feedback after the first E2E: the mplfinance chart looked nothing like
the charts used everywhere else (Sunday Scans, Substack). Those are
**screenshots of the dashboard's own `/r/chart` page** (`app/src/pages/
ChartRender.jsx`: the real StockChart widget, branded header/footer, watermark,
MAs, last-price tag, `$ Vol / Avg 50D`), taken by Playwright from the owner's
PC (`morning-wire/substack/chartwidget.py`, house geometry 1296×670). So v2
produces exactly that image, server-side:

- **`services/chart_renderer/`** — a new Railway service (`chart-renderer`,
  Dockerfile on `mcr.microsoft.com/playwright/python`), `POST /render {url,
  selector, width, height, scale, settle_ms}` → PNG. Secret-gated
  (`X-Render-Secret` = `CHART_RENDERER_SECRET`), https-only, host-allowlisted
  (`RENDER_ALLOWED_HOSTS`), one shared Chromium, 2 concurrent renders, binds
  `::` because Railway's private network is IPv6-only. Health at `/health`.
  Deployed with `railway up <abs path to services/chart_renderer> --path-as-root
  -s chart-renderer -d` from the linked dir. Tests: `tests/test_chart_renderer_service.py`.
- **`api/services/discord_chart_house.py`** — builds the `/r/chart` URL
  (`sym, tf, w=1296, h=670(+28), token=CHART_RENDER_TOKEN, stats=<b64url JSON>`)
  and POSTs it to `CHART_RENDERER_URL` at `HOUSE_SCALE=2` → **2592×1396**.
  Returns None on anything wrong; `run_chart_job(house_fn=…)` then falls back
  to the mplfinance renderer (itself now 1920×1080 with the same stats), so a
  renderer outage never fails a reply.
- **`?stats=`** on `ChartRender.jsx` — a 28 px strip under the header: O/H/L/C,
  Day %, Gap %, 52w High (distance) / Low, Vol, Avg50, RVOL (gold ≥1.5×),
  $Vol, ADR%. The numbers are computed ONCE, server-side, by
  `discord_chart_render.compute_stats` from daily bars (a second daily fetch
  for weekly/intraday charts); the page only lays them out. Without the param
  the page is byte-for-byte unchanged, which keeps Sunday Scans / Substack out
  of the blast radius. Test: `app/src/pages/ChartRender.stats.test.jsx`.
- Env on `web`: `CHART_RENDERER_URL=http://chart-renderer.railway.internal:8080`,
  `CHART_RENDERER_SECRET`, `CHART_RENDER_BASE_URL=https://uctintelligence.com`
  (+ the existing `CHART_RENDER_TOKEN`). Kill the house path without a deploy:
  unset `CHART_RENDERER_URL` (mplfinance fallback takes over).
- Measured from inside Railway: health OK, `/render` of the house page →
  2592×1340 PNG, ~198 KB, 4.7 s.
- **Blank-frame guard (found on the first full-res check):** a canvas exists
  the instant the widget mounts, so right after a deploy the 1.6 s settle
  screenshotted a body with no candles. The client now waits on the page's own
  `window.__chartReady` (pixels held still, ≥3.5 s), judges the PNG (chart
  body grayscale std-dev ≥ 6; blank ≈ 2.4, drawn ≈ 25–34), retries once with a
  5 s settle, and only then falls back to mplfinance. Same class of bug as the
  Substack harness's `_chart_has_content` (the VLO-blank ship, 7/28).
- **E2E v2 (2026-08-25 17:07 ET, `#dev-chat`):** `/chart NVDA` → the house
  image with the stats strip, 2592×1396, ~6 s end to end.

## v3 (2026-08-25 late): faster and more scalable

- **Readiness without the 3.5 s floor.** `discord_chart_house.house_ready_js`
  downsamples every chart canvas to 32×18, requires ≥6 distinct colours
  (a blank canvas has 1–2) and an identical signature across two samples
  ≥250 ms apart; the page's `__chartReady` is accepted too, whichever first.
  Measured live: ready 1.2–1.8 s, full render 1.9–3.0 s (was 5–6 s). A
  6-point pixel sample was tried first and never certified "drawn" — fixed
  points miss candles; downsampling averages them in.
- **Fetch order.** cache → daily bars → house render → the timeframe's bars
  only for the mplfinance fallback. The house render is skipped when there are
  no daily bars, so an unknown symbol answers "No bars" without a render.
- **`discord_chart_cache`**: PNG + filename cached 45 s (D/W) / 20 s
  (intraday) per `SYMBOL:tf`, and single-flight — simultaneous requests for
  the same chart share one production. Cache hits and waiters take no render
  slot.
- **Concurrency is a dial**: `DISCORD_CHART_MAX_CONCURRENT` (API, default 4)
  and `RENDER_MAX_CONCURRENT` (renderer, set to 4). Beyond that, add
  chart-renderer replicas.
- **Intraday house URLs carry `ext=1`** so pre/post-market candles and session
  shading match the Charts widget with Extended hours on, regardless of the
  saved setting.
- **Member access.** In Uncharted Territory only contributors/admins could
  run `/chart`: the app and the command were open, but the `@everyone` role
  lacked **Use Application Commands** (bit 31). Enabled in Server Settings →
  Roles → Default Permissions on 2026-08-25 (verified via
  `GET /guilds/{id}/roles`). A channel override beats the role: the member
  chat channels (STOCKS AND TRADING and its synced children, `#main-chat`,
  two CASUAL channels) carried an explicit deny for `@everyone` **and for
  `Exclusive VIP Access`, the paying-member role** (Contributor allowed) —
  the VIP override is what actually blocked members. Fixed per channel /
  category in the UI (VIP → Allow, `@everyone` → passthrough), verified via
  `GET /guilds/{id}/channels`; the TRADERS one-way feed channels keep their
  deny on purpose.

## v4 (2026-08-25 night): per-user chart settings + `/c`

Member feedback from `#main-chat` within the first hour: "charts without MAs
or volume" and "a shorter command". Both, plus the owner's ask for
per-member customisation, land as:

- **`/chartsettings show | set | reset`** (ephemeral replies) stores each
  Discord user's defaults by user id (`member.user.id`) in
  `/data/discord_chart_prefs.db` (`api/services/discord_chart_prefs.py`; env
  `DISCORD_CHART_PREFS_DB_PATH`). Keys: `tf` (default timeframe), `mas`
  (`house` = the dashboard's EMA 9/20 + SMA 50/200, `10-20-50` = SMA
  10/20/50, `off`), `volume`, `ext` (pre/post-market on intraday), `stats`
  (the strip). A bad value writes nothing.
- **`/c`** is `/chart` under a two-keystroke name (same options).
- **How prefs reach the image:** `render_options(prefs)` → a partial
  chart-settings override sent as `?indicators=` (the page merges it on top
  of the owner blob; `overlays` must be five COMPLETE slot objects because the
  page's override merge replaces arrays wholesale; `volume` is a section key
  so `{"visible": false}` merges) plus the `ext` / `stats` URL switches. The
  mplfinance fallback honours `show_mas` / `show_volume`. The PNG cache key
  becomes `SYMBOL:tf:<style signature>` so members with different styles
  never share an image; the default timeframe is not part of the style.
- Verified on the live page before deploy: MAs-off keeps the volume pane,
  volume-off keeps the MAs, SMA 10/20/50 drops the 200-day line.

## Rollout note (2026-08-25, what is actually live)

`/chart` went live on the **existing "UCT Intelligence" application**
(`1474900505917653142`), not the new "UCT Charts" app (`1541909310588719104`):
every credential on the new app (bot token reset, client secret reset) is
MFA-gated in the Developer Portal and only the owner can clear it, while the
existing app's token was already on the box. Railway `web` carries that app's
public key + id, its `interactions_endpoint_url` points at
`/api/discord/interactions`, and `/chart` is registered **globally** on it (the
app is installed in both Uncharted Territory and UCT Intelligence). Consequence:
while the URL is set, the local discord.py bot's gateway commands are routed to
HTTP and answer "Unknown command." Revert is one call
(`tools/discord_chart_commands.py … endpoint --url ""`). Switching to UCT Charts
later: owner resets its token → `.env` `DISCORD_CHART_BOT_TOKEN` → Railway
key/app-id to UCT Charts → `register --global` there → clear the URL on UCT
Intelligence. E2E passed in `#dev-chat`: SPY daily, NVDA daily, NVDA 15 min,
`ZZZZQ` → "No bars", `bad!ticker` → ephemeral validation error.

## Decisions recorded

- Separate Discord application (not the existing bot app): setting an
  interactions URL on an app moves **all** its interactions to HTTP, which would
  silence the local bot's gateway commands.
- Bars come from `get_bars` in-process, not from an HTTP self-call and not from
  `bars_sqlite` directly: the router function is the one authority for
  index/breadth/delisted/yf-only routing and fetch-on-miss.
- Title and "as of" are baked into the PNG; the Discord message body stays a
  single short line so the image is the artifact.
- Public-key-unset = 503 (dark), not "accept unsigned": the endpoint must never
  process an unverified interaction.


## v5 — Lockdown: only the two UCT servers (2026-08-25 evening, URGENT)

A member reported the app could be added to any server. Measured with the bot
token (`GET /applications/@me`): `bot_public = true`, and
`integration_types_config` carried BOTH `"0"` (GUILD_INSTALL) and `"1"`
(USER_INSTALL) — so any Discord user could install the app to their own
account and run `/chart` in any server or DM. The three global commands had
inherited `integration_types [0, 1]` at registration. The bot user itself was
in exactly one guild (Uncharted Territory); guild installs made with only the
`applications.commands` scope (the dev server's) do NOT appear in
`/users/@me/guilds`, so foreign installs cannot be enumerated — hence a
backend allowlist, not just portal settings.

Four layers, all applied:

1. **App settings (API, `PATCH /applications/@me`)** — `integration_types_config`
   reduced to `{"0": ...}`; `install_params` and `custom_install_url` nulled
   (Install Link = None). Done for the live UCT Intelligence app via the API,
   for the UCT Charts app via the portal (its token is MFA-gated).
2. **Public Bot OFF (portal, both apps)** — the only lever that stops a stranger
   with the client id from adding the app; `bot_public` is not settable via the
   API. ⚠️ The portal refuses to flip it while the Installation tab still has a
   default install link ("Private application cannot have a default
   authorization link") — set Install Link to None FIRST.
3. **Commands registered guild-only** — `GUILD_ONLY = {"integration_types": [0],
   "contexts": [0]}` stamped on every command in `build_commands()` and
   re-registered with `register --global`; verified `integration_types=[0]
   contexts=[0]` on all three. Discord no longer offers the commands in DMs.
4. **Backend guild allowlist** (`discord_interactions.guild_allowed`) — the
   endpoint refuses, before any handler runs, an interaction whose `guild_id`
   is not in the allowlist, a DM/private channel (`context != 0`), or a
   user-install authorization (`authorizing_integration_owners` has `"1"`).
   Reply is an ephemeral "This app only works inside the Uncharted Territory
   and UCT Intelligence servers." PING still answers. Default allowlist =
   `882293203485720596` (Uncharted Territory) + `1524909611054792786`
   (UCT Intelligence); `DISCORD_CHART_ALLOWED_GUILDS` (comma-separated)
   overrides, blank = the default (never allow-all).

Tests: `test_guild_allowed_is_the_two_uct_servers_by_default_and_env_overrides`,
`test_endpoint_refuses_foreign_guild_dm_and_user_install_and_schedules_nothing`,
and the `build_commands` test pins `GUILD_ONLY` on every command.

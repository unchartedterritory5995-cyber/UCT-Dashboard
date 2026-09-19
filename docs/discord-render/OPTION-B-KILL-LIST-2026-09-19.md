# Option B kill-list — derived, not yet applied

> Answers the cost `CANARY-RENDERER-DESIGN-2026-09-14.md` §1.2/§1.7 named for Option B
> (`web-canary` + canary renderer) and left undone: *"'explicitly off' is a list nobody has
> derived for this app. That derivation is itself a piece of work."* This document is that
> work. **Nothing here was deployed, run, or applied — no Railway service was touched.**
> It exists so a future session (or the owner) can go straight to §1.5 step 2 of the design
> doc's runbook without re-deriving anything under time pressure.

## Strategy: blank the credential, not just the feature flag

Railway copies env vars into a new service by default, so a `web-canary` booted from this
repo's image inherits every real production secret unless each is explicitly overridden.
Relying on a per-feature `*_ENABLED` flag alone is fragile — a new feature added later that
forgets to check its flag, or a flag whose default polarity is "on unless set to 0," still
fires if the underlying **credential** is live. The credential is the smaller, more durable
list, so it is the primary defense; the feature flags below are the second layer, not the
only one.

| Credential | Kills | Confirmed by |
|---|---|---|
| `DISCORD_WEBHOOK_URL` | Every module below that posts to Discord via webhook and has no dedicated webhook of its own — the majority of them, since most either use this var directly or fall back to it when a feature-specific webhook var is unset | grep across `api/services/*.py` for `DISCORD_WEBHOOK_URL` |
| `DISCORD_BOT_TOKEN` | `buzz_ingest.py` (`:47`) and `discord_buzz_digest.py` (`:277`) — the two Discord features that post/read via a **bot connection**, not a webhook, so blanking `DISCORD_WEBHOOK_URL` does not touch them. Blanking this also avoids a second bot gateway connection contending with production's own bot session under the same token — the same class of hazard this repo already documents for Massive ("~1 conn/key") |
| `RESEND_API_KEY` | `email_service.py:20` — the single chokepoint every Resend send in this codebase goes through. Blanking it kills all outbound email regardless of which Compass/desk flag is on |
| `YT_OAUTH_CLIENT_ID` / `YT_OAUTH_CLIENT_SECRET` / `YT_OAUTH_REFRESH_TOKEN` | `youtube_client.py:58-60` — the only path to a real YouTube upload in this repo (`desk_daily_session.py` is its only real caller) |

⛔ **These four (well, six) settings alone close almost every path CLAUDE.md's own warning
names** ("posts to a ~750-member Discord channel, publishes to YouTube, and emails members
via Resend"). The feature-flag list below is what closes the rest and gives defense in depth
if a credential is ever accidentally left live.

## Feature-flag layer — every scheduler-gated outbound path found, with its default polarity

⛔⛔ **Polarity matters and is easy to get backwards.** A flag whose default is a
**kill-switch** (unset = ON) fires on a canary that copies production's env wholesale
*unless someone explicitly sets it to the off value* — the exact "get it wrong and it
happens anyway" risk the design doc names. Two of the entries below are kill-switches; the
rest are enablement gates (unset = OFF, already safe by default, listed anyway for
completeness and because Railway env inheritance means "default" is not actually what a
clone gets unless overridden).

### Discord (webhook or bot-token) — set every one of these to `0`

| Flag | Default polarity | What it posts | Source |
|---|---|---|---|
| `CHART_HEALTH_DISCORD_ENABLED` | **kill-switch, unset=ON** | critical health pages, incl. anything the canary's own render activity might trigger | `chart_health_alerts.py:89` |
| `BUZZ_INGEST_ENABLED` | **kill-switch, unset=ON** | reads `#main-chat` via bot token (not a post, but an active bot connection under the shared token — see credential layer) | `buzz_ingest.py:32` |
| `SUBSTACK_ENABLED` | **kill-switch, unset=ON** | **publishes PUBLICLY**, not just to Discord — the one item on this list that reaches the open internet, not just a private channel | `api/main.py:2971`, `:6204` |
| `CALENDAR_WEEK_POST_ENABLED` | enablement, unset=OFF | weekly earnings calendar post | `calendar_week_poster.py:465` |
| `DESK_SESSION_DISCORD_RECAP_ENABLED` | enablement, unset=OFF | session recap post | `desk_session_recap.py:28` |
| `DISCORD_INDEX_CLOSE_ENABLED` | enablement, unset=OFF | 15:45 ET index close post | `api/main.py:6052` |
| `CALENDAR_ALERTS_ENABLED` | enablement, unset=OFF | pre-report earnings alerts | `api/main.py:6596` |
| `CATALYST_DIGEST_ENABLED` | enablement, unset=OFF | catalyst digest post | `api/main.py:6565` |
| `CATALYST_ENGINE_ENABLED` | enablement, unset=OFF | also fires `discord_notify` admin-channel posts from `catalyst/{curator_health,digest,health,rule_learner,spend_rail}.py` | `api/main.py:2995`, `:6438` |
| `BUZZ_DIGEST_ENABLED` | enablement, unset=OFF | 7×/weekday board post to the real ~750-member channel — the literal example named in CLAUDE.md | `discord_buzz_digest.py:28` |
| `THEME_ENGINE_ENABLED` | enablement, unset=OFF | daily/weekly admin-Discord digest | `api/main.py:7437` |
| `DESK_DAILY_SESSION_ENABLED` | enablement, unset=OFF | Discord announce (`desk_session_announce.py`) + `discord_notify` admin posts (`desk_daily_session.py:285,308`) + YouTube publish + admin email — see credential layer for the YouTube/email half | `api/main.py:6237` |
| `COT_WEEKLY_DISCORD_WEBHOOK_URL` | unset = silent no-op (its own module logs "unset -- nothing posted") | weekly COT "most watched" post | `cot_weekly_post.py:41,163` — this one is itself a credential-shaped var, not a boolean flag; leaving it unset is already the safe state |
| `ALERT_TAXONOMY_*_DARK_ENABLED` (7 flags: `DOCUMENT_ARRIVAL`, `PRICE_LEVEL_DARK`, `EVENT_PROXIMITY_DARK`, `POSITION_RISK_DARK`, `SCAN_MEMBERSHIP_DARK`, `CATALYST_MATCH_DARK`, `REGIME_CHANGE_DARK`, `INDICATOR_CONDITION_DARK`) | enablement, unset=OFF | dark alert-taxonomy rules, per-rule Discord/notification paths | `api/main.py:6755-7048` |
| `LIVEFLOW_MONITOR_ENABLED` | enablement, unset=OFF | admin down-alert Discord post | `liveflow_monitor.py:41` |

### Email — set every one of these to `0` (in addition to blanking `RESEND_API_KEY`)

| Flag | Default polarity | What it sends | Source |
|---|---|---|---|
| `COMPASS_EOD_RECAP_ENABLED` | enablement, unset=OFF | member EOD recap email | `api/main.py:7185` |
| `COMPASS_WEEKLY_DIGEST_ENABLED` | enablement, unset=OFF | member weekly digest email | `api/main.py:7237` |
| `COMPASS_HEALTH_EMAIL_ENABLED` | enablement, unset=OFF | member/admin health email | `api/main.py:7271` |
| `DESK_DAILY_SESSION_ALERT_EMAILS` / falls back to `ADMIN_EMAILS` | credential-shaped, not boolean | admin publish-alert email | `desk_daily_session.py:295-296` — blank both, or accept `RESEND_API_KEY` being blank already stops the send |

### YouTube — covered entirely by the credential layer

No separate feature flag beyond `DESK_DAILY_SESSION_ENABLED` (already listed above) gates
`youtube_client.py`; blanking `YT_OAUTH_*` is the actual kill switch.

## Verification method — read the running process, never `--kv`

This repo's own standing caution applies here unchanged (`railway variables --set` has been
measured both ways; `--kv` shows service *configuration*, not what the *running process* has).
Before trusting a canary boot as inert:

1. `railway variables --service web-canary --kv` to confirm what was *staged* (necessary,
   not sufficient).
2. Read the values **in-process** via `railway ssh --service web-canary`, following this
   session's established base64-pipe pattern (remember `sys.path.insert(0, "/app")` for any
   `api.*` import in an ad-hoc `/tmp` script — its own `sys.path[0]` is `/tmp`, not `/app`).
   A minimal probe: `import os, json; print(json.dumps({k: bool(os.environ.get(k)) for k in
   [...the credential list above...]}))` — presence, not value, is all that needs confirming.
3. Confirm a **new boot** happened after any `--set` (a startup-line timestamp after the
   set call), not just that the dashboard shows the new value.
4. `RENDER_ALLOWED_HOSTS` / `RENDER_MAX_CONCURRENT` / `CHART_RENDERER_SECRET` /
   `CHART_RENDER_TOKEN` are entirely separate env vars (`services/chart_renderer/app.py:76-79`,
   `api/services/discord_chart_house.py:297-298`) — none of the kill-list settings above
   touch chart-rendering itself; the design doc's own §1.1/§1.5 guidance on those four stands
   unchanged and needs no re-derivation.

## What this does not cover

This is the outbound-channel kill-list only. It does not re-derive the design doc's own
already-complete guidance on `RENDER_ALLOWED_HOSTS` scoping, the render-token header
discipline, or the deploy mechanics (§1.1-§1.5) — those stand as written. It also does not
decide *whether* to build Option B at all; that remains the owner's call among the four
named options in §1.7. This document only removes the "the derivation itself is unstarted
work" objection from Option B's cost side.

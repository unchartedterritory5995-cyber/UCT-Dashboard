# Discord Activity — the interactive chart inside Discord (design, 2026-08-25)

Owner: "make the chart INTERACTIVE as if the user is directly on the chart and
can move and scroll … adjust timeframe on the chart, not in the command. That
would be game changing." → "Interactive charts, let's go for it."

## What it is

A **Discord Activity**: our web app, loaded by Discord in an iframe (desktop:
a popout in the channel; mobile: full screen) through Discord's proxy at
`https://1474900505917653142.discordsays.com/…`. The page is a slim route of
the dashboard SPA that mounts the real `ChartPane` (the same component
TickerPopup, ChartWidget and Breadth use): pan, wheel/pinch zoom, crosshair
legend, the timeframe bar, the settings gear, indicators, house palette. It
is not a screenshot and not a Discord widget — it is the Charts widget.

## Hard facts that shape the design (measured 2026-08-25)

- **Unverified Activities launch only for the app's team developers + invited
  App Testers, and only in servers under 25 members.** Uncharted Territory has
  ~750 members ⇒ the member-facing launch needs Discord's **Activity
  verification** (owner identity check + review; `/terms` and `/privacy`
  already exist on the site). Development and testing happen in the UCT
  Intelligence dev server (well under 25 members) with no verification.
- **All traffic goes through Discord's proxy** (`{clientId}.discordsays.com`).
  A root URL mapping `/ → uctintelligence.com` makes the SPA's own relative
  `/api/...` calls work unchanged. WebSockets are supported; SSE is not
  documented ⇒ the Activity runs the chart with `liveUpdates` off and relies
  on the 30 s SWR bar refresh. (Live ticks are a later measurement.)
- **No cookies / no dashboard login inside the iframe.** The page runs logged
  out, exactly like `/r/chart` does today (`/r/*` routes sit outside
  `AuthGuard`). Bars, ticker search, ticker meta and breadth symbols are all
  public endpoints already.
- **Enabling Activities auto-creates a global Entry Point command "Launch"**
  (type 4, handler `DISCORD_LAUNCH_ACTIVITY`). Our `register --global` is a
  bulk PUT that overwrites all commands ⇒ `build_commands()` must carry the
  Entry Point command or the PUT deletes it. During testing it is restricted
  to administrators (`default_member_permissions: "8"`) so members never see
  a Launch that Discord would refuse for them.
- **The launch carries no parameters.** Discord opens the root URL and appends
  only `instance_id`, `channel_id`, `guild_id`, `frame_id`, `platform`. The
  SDK exposes `channelId` / `guildId` without OAuth. Identifying the *member*
  needs `authorize → /api/token (client_secret) → authenticate`, and **no
  client secret exists for the live app** (bots never needed one; revealing
  or resetting it is MFA-gated to the owner).

## v1 (this build) — chart handoff by channel, no OAuth

1. **Launch button.** Every chart reply gets one more button, `Open in
   Discord`. Its click is a MESSAGE_COMPONENT interaction; the endpoint
   records a **handoff** `{channel_id, user_id, sym, tf, prefs-style, ts}`
   (in-memory + SQLite, 5-minute TTL) and answers `{"type": 12}`
   (LAUNCH_ACTIVITY). Discord opens the Activity in that channel.
2. **The page** (`/r/activity`, outside AuthGuard, no app shell): loads
   `@discord/embedded-app-sdk`, `await sdk.ready()`, reads `sdk.channelId`,
   calls `GET /api/discord/activity/handoff?channel_id=…` → the newest handoff
   for that channel within the TTL → mounts `ChartPane` with that symbol and
   timeframe, the house settings, `showTfBar`, a `SymbolSearch` header. No
   handoff → the search box with the last symbol from `localStorage`.
   Outside Discord (no SDK frame) the route still renders — that is how it
   gets tested in a normal tab first.
3. **Entry Point command** (`launch`, type 4, handler 1 APP_HANDLER, admin
   only while unverified): our endpoint answers `{"type": 12}` too, so the
   App Launcher path opens the same page with the channel's last handoff.
4. **Portal**: Activities → Settings → *Enable Activities*; URL Mappings root
   `/ → uctintelligence.com`; the default Launch command replaced by ours.
5. **Test**: dev server, owner's account (a developer of the app).

## v2 (needs the owner)

- **Member identity** via OAuth `identify` → `/api/discord/activity/token`
  (needs the app's client secret from the portal, MFA) → `authenticate`. Then
  the handoff is keyed by user, `/chartsettings` apply inside the Activity,
  and the page can persist per-member state.
- **Verification** so Uncharted Territory's members can launch it.
- **Live ticks** through the proxy (WebSocket path) if SSE does not pass.
- **Watch together**: the Activity is multi-participant by nature; syncing
  the symbol across participants is a small step once identity exists.

## Files

- `api/routers/discord_interactions.py` — `activity|…` button handling,
  Entry Point command response, `GET /api/discord/activity/handoff`.
- `api/services/discord_activity_handoff.py` — the handoff store (TTL).
- `api/services/discord_interactions.py` — `build_launch_command()`,
  `activity` button in `chart_components`, `parse_component` accepts it.
- `app/src/pages/DiscordActivity.jsx` — the page; route `/r/activity` in
  `App.jsx` beside `/r/chart`.
- `app/package.json` — `@discord/embedded-app-sdk`.
- Tests: `tests/test_discord_activity.py`, `app/src/pages/DiscordActivity.test.jsx`.

## Not in scope

Drawings persistence, journal embeds, alerts from inside the Activity, and
anything that needs the member's dashboard account.


## Build log

- **v1 shipped 2026-08-25 ~20:45 CT** (`f87a9c471`): portal root mapping
  `/ → uctintelligence.com`, Activities enabled, commands re-registered with
  the admin-only Entry Point (`launch`, type 4, APP_HANDLER), `/r/activity`
  page, handoff store + endpoint, "Open in Discord" button (dev server only via
  `DISCORD_ACTIVITY_GUILDS`). `/r/activity` verified in a plain tab: the full
  house chart, logged out.
- **First launch failed (white frame, session ended in seconds):** Discord
  opens an Activity at the **root** of the mapping — never at a path — with
  `instance_id/channel_id/guild_id/frame_id/platform` appended. The frame
  loaded `uctintelligence.com/` (the Coming Soon page), which never calls
  `ready()`. The proxy was fine (it returned our index.html; no Cloudflare
  block). Fix `416ff829d`: `utils/discordLaunch.js` recognises the launch and
  `App.jsx` serves `DiscordActivity` at `/` (intro film skipped); `/r/activity`
  stays for plain-tab testing. Second click during that state showed "This
  interaction failed" — re-test after the fix.
- **PARKED 2026-08-25 ~21:58 CT (owner: "takes people away from discord").**
  Activities disabled in the portal, the `launch` Entry Point removed from the
  command set, `DISCORD_ACTIVITY_GUILDS=off`. The code (`/r/activity`, the
  handoff store, the `activity|` button) stays dark; the root URL mapping
  stays and is inert while Activities are off. The in-chat control surface
  (spec v11 in the chart-command design doc) is the direction instead.

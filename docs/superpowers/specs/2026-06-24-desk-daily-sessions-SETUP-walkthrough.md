# Daily Sessions — One-Time Setup Walkthrough

Click-by-click guide to make the daily Zoom webinar auto-stream to YouTube
(unlisted) so it auto-publishes into **The Desk → Videos**. Do this **once**; after
that it runs itself.

> ⏱ **Start with Part A TODAY.** Enabling YouTube live streaming has a **~24-hour
> activation delay**. Parts B–F take ~15–20 min and can be done once A is active.

---

## Part A — Enable live streaming on the UCT YouTube channel  ⚠️ DO FIRST (24h delay)

1. Sign in to **youtube.com** as the UCT channel (or create the channel if you don't
   have one — use a Google account you control long-term, not a personal one).
2. Click your avatar (top-right) → **Create** (the ⨁ camera icon) → **Go live**.
   - If it's your first time, YouTube says *"Live streaming isn't enabled yet"* and
     asks you to **verify by phone**. Do it.
3. After verifying, YouTube shows: *"Your account will be enabled for live streaming
   in 24 hours."* — **this is the wait.** Come back tomorrow for Part B.

✅ **Done when:** YouTube Studio → **Create → Go live** opens the **Live Control
Room** instead of the "enable in 24h" message.

---

## Part B — Create a persistent (reusable) stream key, set to Unlisted

1. youtube.com → **Create (⨁) → Go live** → opens **Live Control Room**.
2. Left sidebar → **Stream** tab (the one for "streaming software" / encoder, not
   "Webcam").
3. In **Stream settings**, find:
   - **Stream URL:** `rtmp://a.rtmp.youtube.com/live2`  ← copy this
   - **Stream key:** click **Reveal** → copy. This is your **persistent key** —
     reusable for every webinar. Treat it like a password.
4. Set the broadcast's visibility to **Unlisted**:
   - Top of the Live Control Room → **Edit** (or the visibility dropdown) → choose
     **Unlisted** → Save. This becomes the default for streams started with this key.

✅ **Done when:** you have **Stream URL** + **Stream key** copied, and visibility =
**Unlisted**.

> Why unlisted (not private): unlisted = anyone with the link can watch (so The Desk
> player works for your members), but it won't show up in search or your public
> channel. Private would block playback for everyone but the channel owner.

---

## Part C — Turn on custom live streaming for webinars in Zoom

1. Sign in at **zoom.us** as the account owner/admin.
2. **Settings** (left sidebar) → **Meeting** tab → scroll to **In Meeting
   (Advanced)**.
3. Find the **webinar** line specifically — **Allow livestreaming of webinars**
   (distinct from the meetings toggle just above/below it) → toggle **ON** → check
   **Custom Live Streaming Service**. Save.
   - We run **webinars, not meetings** — make sure it's the webinar toggle that's
     enabled (enabling only the meetings one won't expose the option in your webinar).
   - Some accounts also surface this under a separate **Webinar** settings group —
     enable "Custom Live Streaming Service" there too if you see it.

✅ **Done when:** the **Custom Live Streaming Service** checkbox is enabled.

> Prereq: this needs a Zoom **Pro/Business plan + the Webinar add-on**. You already
> run webinars, so you have it.

---

## Part D — Configure the recurring webinar with the stream key + AUTO-START

> Do this on **desktop** (zoom.us web). The iPhone app only offers "Live on YouTube,"
> not the custom service.

1. zoom.us → **Webinars** → click your **recurring daily webinar**.
2. Scroll to the bottom → **Livestream** section (tab/row) → **Configure custom
   streaming service** (or "Configure Live Stream Settings").
3. Fill in:
   - **Stream URL:** paste the `rtmp://a.rtmp.youtube.com/live2` from Part B.
   - **Stream key:** paste the persistent key from Part B.
   - **Live streaming page URL:** your channel/live URL (e.g.
     `https://youtube.com/@YourChannel/live`) — Zoom requires something here; it's
     just the "watch" link.
4. ✅ **Enable / check "Automatically start live stream when the webinar starts"**
   (wording is roughly *Auto-start*). **This is the line that makes it hands-off.**
5. **Save.**

✅ **Done when:** the webinar's Livestream config shows your YouTube URL/key **and
auto-start is checked**.

> Because it's a **recurring** webinar with a **persistent** key, this config sticks
> for every future occurrence. You won't touch it again.

---

## Part E — Google Cloud OAuth so the engine can detect the new video

This is what lets UCT's backend find the freshly-archived YouTube video and publish
it to The Desk. You create the credentials; Claude wires the code.

1. Go to **console.cloud.google.com** (signed in as the **same Google account that
   owns the YouTube channel**).
2. Create a project (e.g. *"UCT Desk Sessions"*).
3. **APIs & Services → Library** → search **YouTube Data API v3** → **Enable**.
4. **APIs & Services → OAuth consent screen** → set up (User type: **External** is
   fine), app name, your email; add the scope **`.../auth/youtube.readonly`**; add
   your own Google account as a **Test user**.
5. **APIs & Services → Credentials → Create Credentials → OAuth client ID** →
   Application type **Desktop app** → Create → **download the JSON** (has client id +
   secret).
6. Hand Claude the client id + secret. Claude runs a **one-time consent flow** to mint
   a long-lived **refresh token**, then stores all three in Railway env
   (`YT_OAUTH_CLIENT_ID`, `YT_OAUTH_CLIENT_SECRET`, `YT_OAUTH_REFRESH_TOKEN`).

✅ **Done when:** Claude confirms the refresh token works (a test
`liveBroadcasts.list` call returns your broadcasts).

---

## Part F — Go live + verify

1. Claude sets `DESK_DAILY_SESSION_ENABLED=1` in Railway and deploys the detect+publish job.
2. **Run one webinar** (or a 2-minute test webinar). Confirm in YouTube Studio →
   **Content → Live** that an **unlisted** video for the session exists after it ends.
3. Within ~30–60 min, check **The Desk → Videos → Daily Sessions** for
   *"Daily Session — {today's date}"*.
4. If it's missing by the EOD cutoff, you'll get an owner alert — tell Claude and
   we'll trace it (almost always either auto-start didn't fire, or the OAuth token).

---

## Daily reality after setup

The host **just starts the webinar like normal.** Auto-start fires the YouTube
broadcast; minutes after it ends, the engine finds the unlisted recording and
publishes the dated Desk Videos record. Nothing to remember, nothing to upload. The
EOD safety net is the backstop if anything ever hiccups.

## Quick checklist

- [ ] **A.** YouTube live streaming enabled (waited ~24h) ⚠️ start today
- [ ] **B.** Persistent Stream URL + key copied; visibility = Unlisted
- [ ] **C.** Zoom "Custom Live Streaming Service" enabled
- [ ] **D.** Recurring webinar configured with key + **auto-start ON**
- [ ] **E.** Google Cloud project + YouTube Data API v3 + OAuth desktop client (JSON to Claude)
- [ ] **F.** `DESK_DAILY_SESSION_ENABLED=1` + test webinar → video appears in The Desk

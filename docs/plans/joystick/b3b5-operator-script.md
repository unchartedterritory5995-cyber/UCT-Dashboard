# B3 / B5 — MANUAL DEVICE EVIDENCE: operator script

**Label every result from this script `MANUAL DEVICE EVIDENCE`.** That is a real measurement on a
real touch surface, and it is a distinct tier from both the emulated smoke (which proves nothing
about the product) and an automated Automate run (which cannot happen on this account). The
evidence form beside this file is where results go: `b3b5-evidence-form.md`.

**Why this exists at all.** `journal.close` is `flickable: false`, and no jsdom test can tell you
whether a real finger on real glass honours it. **D4 is the measurement that matters.** Everything
else here is corroboration.

---

## Before you touch a phone

The sandbox must be running and seeded. From `C:\Users\Patrick\uct-worktrees\joystick-hub`:

```
python -m pytest tests/test_hub_sandbox_launcher.py          # green = clearance. Red = stop.
powershell -ExecutionPolicy Bypass -File scripts\hub-sandbox.ps1 -DataDir C:\data-hubtest -Port 8077
```

⛔ **Read the launcher's FIRST line — the snapshot-compare result — before anything else.** "Reports
clean" is never evidence of "wrote nowhere"; the snapshot rail is.

**Confirm the seed is present** (expect exactly three rows, AAPL / MSFT / TSLA):

```
python -c "import sqlite3;c=sqlite3.connect(r'C:\data-hubtest\auth.db');print(c.execute(\"select symbol,entry_price,stop_price,coalesce(source,'manual') from j2_positions where closed_at is null order by symbol\").fetchall())"
```

Expect: `AAPL 178.1/176.0 manual` · `MSFT 402.5/395.25 manual` · `TSLA 244.0/244.0 broker`.
If empty, re-seed (the seed script is idempotent and tears down first).

---

## Channel 1 — your own phone, over the LAN

| | |
|---|---|
| **URL to open on the phone** | **`http://192.168.1.64:8077`** |
| Bind address | Already `0.0.0.0` — `hub_sandbox_boot.py`'s `--host` defaults to it, so no change is needed |
| Same network | The phone must be on the same LAN as this machine (192.168.1.x) |
| Sign-in | `hubtest@local.dev` / `HubDevice2026!` |

⚠️ **`localhost` on the phone means THE PHONE.** Use the IP above.

**Firewall — likely needed once.** Windows blocks inbound 8077 by default. In an **elevated**
PowerShell:

```
New-NetFirewallRule -DisplayName "UCT hub sandbox 8077 (LAN)" -Direction Inbound `
  -LocalPort 8077 -Protocol TCP -Action Allow -Profile Private
```

⛔ `-Profile Private` on purpose — do not open this on a public network. Remove it afterwards:
`Remove-NetFirewallRule -DisplayName "UCT hub sandbox 8077 (LAN)"`.

**Quick check before the phone:** `http://192.168.1.64:8077/api/health` should return 200 from
another machine, or from the phone's browser.

---

## Channel 2 — BrowserStack Live, real device

The Local tunnel the automated suite scripts serves Live equally well.

```
powershell -ExecutionPolicy Bypass -File C:\tools\hub-devicetests\start-tunnel.ps1 -Port 8077
```

Then in the Live session's address bar: **`http://bs-local.com:8077`**

⚠️ `bs-local.com`, not `localhost` — on iOS `localhost` resolves to the device itself.

**Devices to pick, to match the automated matrix:**

| | Device | OS / browser |
|---|---|---|
| iOS (primary) | iPhone 15 Pro | iOS 17, Safari |
| iOS (small viewport) | iPhone SE 2022 | iOS 16, Safari |
| Android (primary) | Google Pixel 8 | Android 14, Chrome |
| Android (second) | Samsung Galaxy S24 | Android 14, Chrome |

**Minimum for the merge gate: one real iOS + one real Android.** The other two are corroboration.

---

## Reaching the hub

1. Sign in as `hubtest@local.dev`.
2. Navigate to **`/journal/trades`**, **Open Positions** tab, **List** view.
3. The joystick pad is a glass circle, bottom-right, about a thumb's width, sitting clear of the
   home indicator.
4. **Tap the pad once.** This lands the cursor on a position row — every action below needs one.
   A row should show a visible cursor outline.

⛔ If the pad is not there, stop. The hub needs a coarse pointer and a viewport ≤1023px; a desktop
browser will never show it, and neither will a tablet in a wide layout.

---

# The checks

Throughout: **a deliberate selection** = press the pad, drag out to the bubble, pause a beat, then
release. **A flick** = a fast flick outward and release in well under a fifth of a second — quick
enough that you would call it a flick, not a drag.

---

### D1 — Move stop opens exactly one sheet

**Gesture:** Press and hold the pad, drag toward the **Move stop** bubble, pause, release.

**PASS:** Exactly one sheet slides up — the stop sheet — and its main button reads **"Set stop"
followed by a price with two decimals** (e.g. `Set stop 176.00`).

**FAIL:** Two sheets appear stacked, or the first sheet's button reads just **"Move stop"** with no
number.

**Screenshot:** `D1-movestop-<device>.png`

---

### D2 — Breakeven opens exactly one sheet

**Gesture:** Dismiss any open sheet. Tap the pad once to re-establish the cursor. Press and hold,
drag toward **Breakeven**, pause, release.

**PASS:** Exactly one sheet — the stop sheet — seeded at the entry price.

**FAIL:** Two sheets stacked, or a generic confirmation appears in front of the stop sheet.

**Screenshot:** `D2-breakeven-<device>.png`

---

### D3 — Close opens the close form directly

**Gesture:** Dismiss, tap once, press and hold, drag toward **Close**, pause, release.

**PASS:** The **Close position** form opens immediately, showing its own fields — shares, exit
price, exit date, and notes among them — with **no** small confirmation box in front of it.

**FAIL:** A small "Close AAPL?" style confirmation appears first, and the form only opens after you
confirm it.

⛔ **Do not save.** Cancel out. Saving writes a permanent trade row.

**Screenshot:** `D3-close-<device>.png`

---

### D4 — ⭐ THE ONE THAT MATTERS: a flick at Close must NOT fire

**Gesture:** Dismiss any sheet. Tap the pad once. Now **flick** fast toward **Close** and release
immediately. **Repeat five times**, returning to the journal between each.

**PASS:** Every single time, the fan simply **opens** and sits there. No form appears. Nothing is
written. Five out of five.

**FAIL:** The Close form opens on any one of the five — or anything at all fires.

**This is the check the whole exercise exists for.** If it fails even once, stop, record it, and
tell me before doing anything else.

**Screenshot:** `D4-close-flick-<device>.png` (capture the fan sitting open, no form)

---

### D5 — a flick at Move stop / Breakeven SHOULD fire

⭐ **PREDICTION, RECORDED BEFORE YOU RUN IT:** these two **will fire on a flick**. Neither carries
the no-flick guard that Close has — verified in the registry both before this work and after — so a
flick should open the stop sheet directly. B3 changed *which* sheet appears, never *whether* a flick
fires. Your observation is confirming that prediction, not discovering the answer.

**Gesture:** Flick fast toward **Move stop**, release. Repeat five times. Then the same toward
**Breakeven**.

**PASS:** The stop sheet opens on at least four of five, for each action.

**FAIL:** Nothing fires and the fan just opens — that would mean Close's guard has leaked onto
actions that should not have it.

**Screenshot:** `D5-flick-fires-<device>.png`

---

### D6 — ANDROID ONLY: the commit pulse is a triple, not a single

⛔ **iOS: SKIP THIS AND MARK IT N/A.** iOS Safari exposes no vibration API at all, so no haptic can
fire there for any action, before or after this work. That is pre-existing, not a regression.

**Turn on system haptics / vibration and hold the phone so you can feel it.**

**Gesture:** Deliberate selection (drag and release, not a flick) onto **Move stop**, then
**Breakeven**, then **Close**.

**PASS:** Each release produces a **distinctly longer, three-part buzz** — the "you are about to be
asked to commit something" cue. Compare it against a release onto **Chart it** or **Note**, which
should give a **single short tap**.

**FAIL:** All of them feel like the same single short tap — meaning the escalation is not firing on
the three write actions.

**Screenshot:** not applicable; record what you felt in the notes column.

---

---

### D7 — EXPOSURE: who gets the hub at all

⭐ **Everything above assumes the hub is showing. D7 is what a MEMBER hits first**, and it is the
check the deploy ruling turns on. B6 hides the Settings → Joystick card from members who never
chose, while leaving it for anyone who ever chose either way — so nobody with the hub ON loses
their way off.

#### D7a — a member does not get the hub
Sign out. Sign in as **`hubmember@local.dev`** / `HubDevice2026!`. Go to `/journal/trades`.

**PASS:** no joystick pad anywhere on the page.
**FAIL:** the pad appears — **stop and report before anything else**; exposure is wider than intended.

**Screenshot:** `D7a-member-no-pad-<device>.png`

#### D7b — a member does not get the Settings card
Still signed in as the member, open **Settings** and scroll to the Charts section.

**PASS:** there is **no Joystick card**.
**FAIL:** the card is present — B6 did not land in the build you are testing.

**Screenshot:** `D7b-member-no-card-<device>.png`

#### D7c — an admin does
Sign out, sign in as **`hubtest@local.dev`**. Open **Settings** → Charts.

**PASS:** the **Joystick card is present**, and its toggle flips (turn it off, reload, the pad is
gone; turn it back on, reload, the pad is back).
**FAIL:** the card is missing for an admin.

**Screenshot:** `D7c-admin-card-<device>.png`

#### D7d — the kill switch
⚠️ **The sandbox reads `HUB_PREVIEW_ENABLED` per request, but from the environment of the RUNNING
process** — `api/routers/auth.py:144-146` reads `os.environ` at request time, and one process
cannot change another's environment. So this cannot be flipped live against an already-booted
sandbox.

**To test it, boot a second sandbox with the flag off** (a different port, so it does not fight the
first — the launcher refuses a busy port by design):

```
$env:HUB_PREVIEW_ENABLED="0"
powershell -ExecutionPolicy Bypass -File scripts\hub-sandbox.ps1 -DataDir C:\data-hubtest -Port 8078
```

Then as **admin**, on `http://192.168.1.64:8078`: **PASS:** no pad anywhere, even for the admin.

**If you would rather not boot a second sandbox, mark D7d N/A** — the code citation above plus
`tests/test_hub_preview_flag.py::test_the_flag_is_read_per_request` is the evidence, and that test
is the load-bearing one (a module-level capture would make the no-redeploy rollback a fiction).

#### D7e — the recovery path, on real glass
This proves two things at once: that a member who opted in **keeps** their way off (the reason B6
is shaped the way it is), and that **B6 is a UI default, not a security boundary** — the member's
own API accepts the write.

**Step 1 — opt the member in, from the PC** (this is the "member sets it directly" path):

```
python -c "import json,urllib.request as u; cj=u.HTTPCookieProcessor(); o=u.build_opener(cj); h={'Content-Type':'application/json'}; o.open(u.Request('http://127.0.0.1:8077/api/auth/login', json.dumps({'email':'hubmember@local.dev','password':'HubDevice2026!'}).encode(), h)); r=o.open(u.Request('http://127.0.0.1:8077/api/auth/preferences', json.dumps({'key':'joystick_hub','value':json.dumps({'enabled':True})}).encode(), h)); print('preferences POST ->', r.status)"
```

Expect `preferences POST -> 200`.

**Step 2 — on the phone, as `hubmember@local.dev`:** reload `/journal/trades`.
**PASS:** the pad is now **present** for a member. (This is the opt-in path, working as designed.)

**Step 3 — Settings.**
**PASS:** the **Joystick card is now present** for this member — because they have explicitly
chosen. This is B6's strand-avoidance working: the member who opted in keeps their way out.

**Step 4 — toggle it off in Settings, reload.**
**PASS:** the pad is gone.

**Screenshot:** `D7e-member-optin-<device>.png` (step 2) and `D7e-member-card-<device>.png` (step 3)

**Step 5 — RESTORE, so D7a is repeatable.** The API can only upsert a preference, never delete one,
so "never chosen" is restored in the sandbox DB directly:

```
python -c "import sqlite3;c=sqlite3.connect(r'C:\data-hubtest\auth.db');c.execute(\"delete from user_preferences where pref_key='joystick_hub' and user_id=(select id from users where email='hubmember@local.dev')\");c.commit();print('hubmember restored to never-chosen:', c.execute(\"select count(*) from user_preferences where pref_key='joystick_hub'\").fetchone()[0], 'joystick_hub rows left')"
```

⛔ Sandbox database only (`C:\data-hubtest`). Never run this against `C:\data`.

## When you are finished

1. Fill in `b3b5-evidence-form.md` — one row per check per device.
2. Drop the screenshots next to it in `docs/plans/joystick/screens/b3b5-manual/`.
3. Stop the sandbox, and remove the firewall rule if you added one.
4. The seed can stay; it is idempotent and lives only in `C:\data-hubtest`.

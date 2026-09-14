# Browser checks — 2026-09-14, run as ADMIN, no credential typed

**How the session was obtained.** The owner's Chrome profile was **not** signed in to
uctintelligence.com (`/api/auth/me` → `{"detail":"Not authenticated"}`). Rather than type a
password — forbidden — the documented path was used: `python tools/smoke_login_link.py` mints a
**2-minute, single-use** link for the synthetic `smoke@uctintelligence.internal` account, token in
the URL **fragment**. `SMOKE_LOGIN_LINK_ENABLED=1` was already set on `web`.

⚠️ `SMOKE_EMAIL`/`SMOKE_PASSWORD` are in the **User** environment but were absent from this
session's Bash process, which predates the `setx`. They were read into a PowerShell child only, so
the script authenticated itself and **no credential value passed through a prompt or a shell
history**.

Confirmed after: `/api/auth/me` → `role: "admin"`, `plan: "pro"`, `status: "comped"`.

---

## 1. Bell icon — ✅ PRESENT, panel not exercised

`ref_60: button "Notifications"` resolves in the banner on `/dashboard`. Clicking it expanded the
left nav rail rather than a visible panel in the captured frame, so **the icon's presence and
accessible name are verified; the panel's contents are NOT.** Screenshots `ss_8074zpg41`,
`ss_9619h7w48`.

⛔ Recorded as PARTIAL on purpose. "The button exists" and "the panel renders alerts" are two
claims and only the first was measured.

## 2. Ask-AI provenance — ✅ PASS

`/ai-search`, query *"How's market breadth today?"* (a shipped suggestion chip). The answer carried:

- a **`GROUNDED ON`** strip naming **Regime · Breadth · UCT playbook**
- per-claim attribution inline — *"(NYSE + Nasdaq aggregate, bull_correction regime; UCT desk
  data)"*, and `UCT desk data` repeated on each of the three numeric reads
- the standing disclaimer *"AI-generated research — verify before trading. Questions are retained
  de-identified to improve the research desk."*
- a quota counter, `1/40`

⭐ **The provenance is per-claim, not just a footer.** That is the property F-I1-2 leans on: a
refusal that NAMES the missing thing is only safe if the grounding surface is already per-claim,
because the named reason has to travel the same path. Screenshot `ss_76199ykp0`.

## 3. S3 admin `/status` — ⛔ NOT RUN

Out of session capacity, not blocked. The admin surface is reachable (the **Admin** nav entry
renders for this account and the identity block reads `Smoke (automated) / ADMIN`), so this is a
queued item, not an obstacle.

---

## ⚠️ Incidental: production served a 502 mid-check

`https://uctintelligence.com/ai-search` returned **Cloudflare 502, host error**, stamped
`2026-09-14 05:23:42 UTC`. Screenshot `ss_261974ltg`.

**Not ours and already over.** `railway deployment list --service web` shows `5a0e224f4`
*"Breadth B1: dark endpoint for long-history breadth"* going SUCCESS at 05:21:36Z — another
workstream's deploy — and `/api/health` answered **200 with `uptime_seconds: 34`** immediately
after. This is the documented *"stacked master pushes serve 502s through the swap"* class, seen
from the member's side for once. ⭐ It is also the argument for the pre-push guard in one frame:
the guard made THIS session wait four separate times tonight; nothing made that push wait.

# Joystick hub — rollback runbook

**On this repo a push to master is a production deploy.** This is what to do when Increment 2 is
live and something is wrong.

> ✅ **A — RESOLVED 2026-09-09: `HUB_PREVIEW_ENABLED` is WEB-SCOPED.** Verified via read-only CLI
> listing (`railway variables --service <svc> --kv`): present on **web** as a literal `true`,
> **absent** on `worker` (57 vars listed) and `flow-worker` (66 vars listed) — so the absences
> are real, not a failed call. No `${{shared.…}}` reference anywhere. **§1A applies; §1B is
> struck.**
> 
> ✅ **B — RESOLVED 2026-09-09: `0` members had opted in.** Read-only production SELECT via the
> documented `railway ssh` recipe, opened `mode=ro`. Nobody is stranded by B6.

---

## 1. ✅ RESOLVED: `HUB_PREVIEW_ENABLED` is WEB-SCOPED

This decides whether the kill switch is the fast path or a hazard. It could not be answered from
this repository — the variable appears in no committed file except its read site
(`api/routers/auth.py:144-146`), and `railway.json` is shared by all services and carries no
variables. It was settled by a **read-only** CLI listing on 2026-09-09:

```
railway variables --service web         --kv   ->  HUB_PREVIEW_ENABLED=true   (literal)
railway variables --service worker      --kv   ->  absent  (57 variables listed)
railway variables --service flow-worker --kv   ->  absent  (66 variables listed)
```

⭐ **The two absences are real, not a failed call** — both listings returned dozens of other
variables. A project-level shared variable would have appeared on all three. It appears on web
only, as a literal with no `${{shared.…}}` reference, so it is web-scoped.

**Consequence: flipping it cannot bounce `flow-worker`, so the OPRA-tape hazard does not arise and
the kill switch IS the fast path.** §1B is struck below, kept collapsed for its reasoning.

### ✅ 1A — CONFIRMED WEB-SCOPED → the kill switch IS the fast path

Set it on the web service only:

```
railway variables --service web --set HUB_PREVIEW_ENABLED=false
```

⚠️ **`railway variables --set` STAGES AND REDEPLOYS.** There is no documented no-redeploy form of
this command. So even in the safe case the switch triggers a **web** redeploy — which is still far
better than a revert, because it needs no build of your code and touches only web. Confirm with:

```
railway variables --service web --kv | findstr HUB_PREVIEW_ENABLED
```

⭐ The *reading* of the flag is per-request (`auth.py:144-146` reads `os.environ` inside
`_access_payload`, rail: `tests/test_hub_preview_flag.py::test_the_flag_is_read_per_request`), so
once the new value is live it applies to every member on their next authenticated request. The
per-request read is what makes this fast; the `--set` redeploy is the cost of changing it.

<details>
<summary>⚰️ <b>1B — STRUCK 2026-09-09. Did not apply; kept for the reasoning.</b> (verified in dashboard by owner + read-only CLI listing)</summary>

> Verified via `railway variables --service {web,worker,flow-worker} --kv`:
> `HUB_PREVIEW_ENABLED` is present ONLY on web, as a literal. It is not a project-level
> shared variable, so flipping it cannot bounce `flow-worker` and the OPRA-tape hazard
> below does not arise. The reasoning is kept because if the variable is ever moved to
> shared scope, this becomes live again.

> ### 1B — IF IT IS A PROJECT-LEVEL SHARED VARIABLE → **THE KILL SWITCH IS NOT THE FAST PATH**
>
> > **⛔ DO NOT FLIP IT. Changing a project-level shared variable can redeploy EVERY service,
> > including `flow-worker`. Bouncing flow-worker drops the Massive OPRA feed, and Massive does NOT
> > replay — that gap in the options tape is PERMANENT until the T+1 flat file.**
>
> In this case the fast path is **§3, revert-and-push**, which rebuilds web only and cannot touch
> flow-worker. The runbook says so plainly rather than pretending the switch is available.
>
> **Open item to make the switch usable:** move `HUB_PREVIEW_ENABLED` to web scope in a separate,
> standalone change — set it on the web service, confirm web sees the same value, then delete the
> shared one. It touches no code; the risk is entirely in the ordering (set the new one first, so
> there is never a window where neither exists and the default-ON kicks in). Do it on a quiet day,
> not during an incident.

</details>

---

## 2. Confirming the switch took effect

From a member's perspective (or the admin test account) on a phone:

1. Reload the page — not just navigate within the SPA.
2. **Expect: no joystick pad.**

⚠️ **An already-open page keeps its hub until its next `/api/auth/me`** — in practice a reload or a
route change, not a background poll. Someone mid-session will still have it for a few minutes.
That is by design and is not a failed rollback.

---

## 3. The slow path: revert and push

```
git revert --no-commit <merge-sha>
git commit -m "revert: joystick Increment 2 — <reason>"
git push origin <branch>:master
```

- **Rebuilds `web` only.** This branch changes **45 `app/` files and zero `api/` files**, so
  `worker` and `flow-worker` are untouched — flow-worker's watch list is entirely `api/*.py`
  (mirrored at `api/flow_worker_main.py:6-11`). **The OPRA tape is not at risk from this revert.**
- **No CI job fires** — `ocr-linux-cert.yml` needs `tools/wave_p*`, `optionsflow-guard.yml` needs
  `app/src/pages/OptionsFlow.jsx` or `optionsFlow/**`. Neither matches.
- Cost: a full NIXPACKS build (`pip install` + `npm install` + vite build) — minutes — then a
  **~1-minute `/api/*` blip** at the swap, which members see as a brief failure to load data.

---

## 4. Deploy window — **outside US market hours**

**Recommended: after 16:15 ET on a weekday, or any time at the weekend.**

The reason is the blip, not the feature. A web swap interrupts `/api/*` for about a minute, and
this dashboard's users are traders: a minute of dead quotes, a stalled Options Flow tape or a
Journal that will not save **during an open session** is a materially worse minute than the same
minute at 18:00. Nothing in Increment 2 is urgent enough to spend that.

⚠️ Avoid 15:45–16:15 ET specifically — the scheduled index-close Discord post runs at 15:45 ET and
the EOD updater at 16:05 ET.

Note the repo-wide market-hours push freeze and its two guards were **removed** by owner decision
on 2026-08-24, so nothing mechanical will stop a mid-session deploy. The physics did not change;
only the guard did.

---

## 5. Who to tell, and the first-hour signals

Tell: the owner (deploy caller) and whoever is watching support that day.

Watch, in the first hour:

- **Support tickets / feedback mentioning stops, closes, or "the circle"** — the hub is a visual
  novelty and members describe it that way.
- **Unexpected `PUT /api/j2/positions` or close activity.** Increment 2 makes the Journal's write
  actions one tap shorter; a spike in stop writes or closed trades is the signal that matters most.
- **`/api/health` uptime reset** confirming the deploy actually swapped, and the Railway deploy
  reaching SUCCESS **on a commit containing the merge** — master moves fast, so verify with
  `git merge-base --is-ancestor <merge> <deployed>`, never by the SHA on the green deployment.
- **Nothing at all from desktop users.** If desktop members report a change, something is wrong:
  the hub cannot mount there (`useHubActive.js:84` requires `(max-width: 1023px) and
  (pointer: coarse)`).

---

## 6. The opted-in count — **READ-ONLY, run by the owner**

✅ **RESULT 2026-09-09: `0`.** Run read-only against production, `mode=ro`, single
SELECT. It answers "how many members had already switched the hub on before B6", which
goes in the member-impact paragraph as *"N members had already opted in as of <date>; they keep
their toggle."*

```sql
-- READ-ONLY. Column names verified from api/routers/auth.py:340.
SELECT COUNT(*) AS members_opted_in
FROM user_preferences p
JOIN users u ON u.id = p.user_id
WHERE p.pref_key = 'joystick_hub'
  AND u.role != 'admin'
  AND json_extract(p.pref_value, '$.enabled') = 1;
```

⛔ Run it against production **only** as a deliberate act, and never as part of a larger script.
Heavy work on the prod pod has caused member-visible OOM outages twice.

⭐ **B6 does not depend on this number.** The card is shown to any user whose preference is
explicitly set, so whether the answer is 0 or 400, nobody with the hub on loses their way off. The
count is for the member-impact paragraph, not for the gate.

---

## 7. What B6 does and does not guarantee

> **B6 is an exposure default enforced in the UI, not a security boundary: `POST
> /api/auth/preferences` (`api/routers/auth.py:1707-1711`) accepts any `{key, value}` from any
> authenticated user with no validation, so a member could still set `joystick_hub.enabled`
> directly and get the hub.**

That is acceptable — the hub is an affordance over endpoints the member already has — but the
runbook must not claim members *cannot* enable it. Server-side validation of preference keys is an
open item, not part of this branch.

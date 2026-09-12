# Launch day — opening the site

**One word from Patrick. Web-only, any time. Both variables must move in the SAME
window or the two halves disagree.**

## The commands, in order

```
railway variables --service web --set "COMING_SOON_MODE=0" --set "VITE_COMING_SOON=0"
```

Both in one call so a single rebuild covers them. `COMING_SOON_MODE` is read at call
time (`waitlist.py:40`) and needs no rebuild; `VITE_COMING_SOON` is **build-time** and
does. If no new boot appears within ~3 minutes: `railway redeploy --service web --yes`.

**Expected fan-out:** web rebuilds. flow-worker / worker / bars-api **SKIPPED** — a
variable change touches no file.

## Verification checklist

| # | check | pass looks like |
|---|---|---|
| 1 | holding page gone | `/` renders Landing, not `DOORS OPEN` / `COMING SOON` |
| 2 | funnel open | `/pricing` `/compare` `/brokers` `/signup` `/subscribe` all render (no redirect to `/`) |
| 3 | **signup succeeds** | `POST /api/auth/signup` with a throwaway address returns 200 and the user exists |
| 4 | Stripe subscribe opens | `/subscribe` reaches checkout (`auth.py:1700` is gated by the same function) |
| 5 | `/login` unaffected | member-smoke signs in, 200, role=member |
| 6 | member-smoke still on parts | Options Flow shows six `X-Flow-Part` headers, `bootstrap` + `TOP_PICKS` first |
| 7 | bundle proof | the `ComingSoon` lazy import loses its binding again (`,z5=q(...)` returns to a bare call) |

Checks 5–7 are `scratchpad/gex_verify.py`'s shape; the rig already automates 6.

## Rollback

```
railway variables --service web --set "COMING_SOON_MODE=1" --set "VITE_COMING_SOON=1"
```

Same window, same rebuild. Anyone who registered while it was open **keeps their
account** — that is the one thing the rollback cannot undo, so check 3 is the point of
no return.

## `VITE_LAUNCH_DATE`

**It is unset, and that is the recommendation.** The countdown comes from
`FALLBACK_LAUNCH` in `ComingSoon.jsx` — `2026-10-16T09:00:00-04:00`, i.e. Oct 16 09:00
ET (verified rendering as `OCT 16` with a live countdown).

- **If Oct 16 09:00 ET is right → do nothing.** Setting the variable to the same value
  puts the launch date in two places, and one authority is the point.
- **If the date changes:** edit `FALLBACK_LAUNCH` (one authority, ships with a web
  build), or set `VITE_LAUNCH_DATE` and accept the second authority. Either needs a web
  rebuild because both are build-time. Verify the countdown on the holding page after.

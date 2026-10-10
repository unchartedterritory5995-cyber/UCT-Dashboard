# Runbook: turn the UCT Terminal off for members (TERMINAL-NEXT rollback)

Pre-authored 2026-10-10 by lane f-l1 (ledger row RM-X02). This branch,
`rollback/terminal-next-off`, carries only this file. It changes no code.

## Why this is a runbook and not a code change

The terminal's off switch is a Railway variable, not a build constant, so a rollback is a
variable flip, not a deploy:

- `TERMINAL_NEXT_ENABLED` is read per request, never cached
  (`api/services/rollout_gate.py:141-155`). Values that mean ON are `1`, `true`, `yes`, `on`
  (`api/services/rollout_gate.py:134`). Anything else, including unset, means OFF, because the
  code default is `"0"` (`api/services/rollout_gate.py:122`).
- The kill switch is checked before cohort membership, so OFF empties the `cohorts` list on
  every member's auth payload without touching a single `user_tags` row
  (`api/services/rollout_gate.py:295-315`, served at `api/routers/auth.py:700`).
- With the list empty, `/terminal` and `/terminal/calendar` redirect to `/calendar` (never a
  404) and `/calendar` stops redirecting into the shell
  (`app/src/pages/terminal/TerminalRoutes.jsx`, `TerminalRoute` and `CalendarRoute`). The nav
  entry still points at `/terminal` (`app/src/components/NavBar.jsx:27`), which lands on
  `/calendar` for everyone.
- The ledger entry says the same: `docs/feature_flags.json`, key `TERMINAL_NEXT_ENABLED`
  ("RB-4 HANDOVER ... set it to 0 on web and the shell vanishes for everyone on their next
  /api/auth/me").

This matches tier 1 of the rollback decision table
(`docs/terminal-research/10-roadmap/rollout-rollback.md:690`).

## Commands (owner or integrator; this lane runs none of them)

```sh
# 1. Turn it off on web. Use 0, never `variable delete`: --set redeploys, delete does not,
#    and a deleted variable can stay live in the running process (CLAUDE.md, "measured BOTH ways").
railway variables --service web --set "TERMINAL_NEXT_ENABLED=0"

# 2. Watch for a NEW boot stamped after the --set. Only if none appears within ~3 minutes:
railway redeploy --service web --yes
```

## Verify (all three, in order; `--kv` is not evidence)

1. **New boot.** `GET https://uctintelligence.com/api/health` shows `uptime_seconds`
   (`api/main.py:9147`) smaller than the minutes since the `--set`. Send a browser
   `User-Agent`; Cloudflare blocks bare curl.
2. **The running process has the value.** Over `railway ssh` on web:
   `/opt/venv/bin/python -c "import os;print(os.environ.get('TERMINAL_NEXT_ENABLED'))"`
   prints `0`.
3. **A member sees it gone.** Signed in as `bench@uctintelligence.internal` (the member-role
   synthetic account, never a real member): `GET /api/auth/me` returns a `cohorts` list without
   `terminal-next`, and opening `/terminal` lands on `/calendar`. A tab already open keeps the
   shell until its next authenticated request or reload.

## After

- Record the flip in `docs/feature_flags.json` (`TERMINAL_NEXT_ENABLED`: status, service, flip
  time) in the same docs push.
- To turn it back on: `railway variables --service web --set "TERMINAL_NEXT_ENABLED=1"`, then the
  same three checks with the list containing `terminal-next`. Cohort tags were never touched, so
  every member returns at once.

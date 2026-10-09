# UCT Agent — unattended development procedure

Adopted 2026-10-09 after an incident: during an overnight session told **not** to push, a release loop started earlier in the same session (`push_b4.sh`: fetch → merge master → `tools/pre_push_guard.py` → `git push origin HEAD:master`, retrying every 60 s) pushed `b554a9f376` to master in the seconds between the operator's last look at its output and the moment it was stopped. The deploy gate and promotion then ran on it. The overnight report said "nothing was pushed" without checking remote state. The change itself was correct and guarded, but the instruction and the report were both broken.

## Before autonomous work starts

1. **List every background process this session started** (task list / `ps`), and any scheduled wakeups, cron entries or remote triggers. Anything that can push, merge, deploy, redeploy, set Railway variables or call production APIs is a *remote mutator*.
2. **Stop every remote mutator** before the first autonomous step — or, if it must keep running, write down why and get explicit authorization for it.
3. **After stopping a push loop, verify remote state — never infer it from the loop's last log line:**
   ```
   git fetch origin
   git reflog show --date=iso origin/master | head -5     # was anything pushed, when?
   git branch -r --contains <commit>                       # is <commit> on any remote branch?
   ```
   and, for deploys, `railway deployment list --service web` (read-only) for any deployment of the commit.
4. Record the verified starting state (master, Railway deployment, flags) in the session log.

## During unattended work

- **No scheduled remote mutations.** Do not start release loops, delayed pushes, redeploys or variable changes that run while nobody is watching.
- Local commits on a feature branch are fine. Remote branches and master are not touched.
- Production reads (logs, deployment lists, read-only API calls) are allowed when the brief allows them; production writes are not.

## Before reporting

- Re-run step 3. A report states "nothing was pushed" **only** with the reflog / `git branch -r --contains` evidence quoted, and "nothing was deployed" only with the deployment list.
- If something did reach a remote, say so first, with the commit, time, gate/promote runs and deployment id — before any other result.

## Unattended production releases

Require explicit, per-session authorization from the product owner that names what may be released. An authorization to *develop* overnight is not an authorization to release. A release always goes through the established path: the merge guard (`tools/pre_push_guard.py`, never bypassed or attested by the Agent), the "master deploy gate", "promote to production", and a verified Railway deployment.

## Worktree note

A fresh `git worktree` is not linked to Railway; the guard then fails closed ("cannot read the web deployment state"). Link it read-only with `railway link --project <id> --environment production` before running the guard there.

# RTH SMOKE — proves the scheduled plumbing works. NOT A MEASUREMENT.

> Piped to `claude -p` by `scripts/rth-open.ps1 -PromptFile docs/runbooks/rth-smoke-prompt.md`.
> Nobody is watching. Do not ask for input. Do not message anyone.

**This run exists to prove the Task Scheduler → wrapper → headless-Claude → git chain
works end to end.** Every number it touches is from a quiet, closed tape and is
**worthless as data**. Label it so, everywhere.

**Working directory:** `C:\Users\Patrick\uct-worktrees\flow-watch-rail`.

Do exactly these steps, in order, then exit. Nothing else.

1. **Confirm the working directory.** `git rev-parse --show-toplevel` and `git branch
   --show-current`. If the toplevel is not the `flow-watch-rail` worktree, write the
   failure into `smoke.json` and exit non-zero.

2. **Confirm the credentials are present — NAMES ONLY.** For `MEMBER_SMOKE_EMAIL`,
   `MEMBER_SMOKE_PASSWORD`, `SMOKE_EMAIL`, `SMOKE_PASSWORD`: record whether each is
   present or absent. ⛔ **Never print, log or write a value.** A credential that reaches
   a log has to be rotated.

3. **Read `/api/health`** on `https://uctintelligence.com` and record the status code and
   the uptime field. Use a browser `User-Agent` — Cloudflare 1010-blocks raw curl agents.

4. **Read the pod age** from that same health payload (uptime). No `railway ssh` needed
   for the smoke; if you try it and it fails, record that as a warning, not a failure.

5. **Run the rig's path-B dry run ONCE** on the quiet tape:

   ```sh
   python tools/flow_cold_paint_rig.py --path b --runs 1
   ```

   ⛔ Do **not** pass `--certifying`. Record the exit code and the output path.
   **Label the result `NOT A MEASUREMENT — quiet tape, smoke run` in `smoke.json`.**
   If the rig fails, record the failure and continue — the smoke's job is to prove the
   chain, and a rig failure here is a finding, not a crash.

6. **Write `scratchpad/monday-rth/smoke.json`** with exactly these keys:

   ```json
   {
     "kind": "smoke",
     "not_a_measurement": true,
     "started_local": "...",
     "finished_local": "...",
     "cwd_toplevel": "...",
     "git_branch": "...",
     "env_present": {"MEMBER_SMOKE_EMAIL": true, "MEMBER_SMOKE_PASSWORD": true,
                     "SMOKE_EMAIL": true, "SMOKE_PASSWORD": true},
     "health": {"status": 200, "uptime_s": 1234},
     "pod_age_s": 1234,
     "rig": {"ran": true, "exit_code": 0, "path": "b", "runs": 1,
             "label": "NOT A MEASUREMENT - quiet tape, smoke run", "out": "..."},
     "warnings": []
   }
   ```

7. **Commit locally.** `git add scratchpad/monday-rth/smoke.json` — force-add if
   `scratchpad/` is gitignored (`git add -f`) — and commit with the message
   `smoke: RTH scheduling chain proof (NOT A MEASUREMENT)`.
   ⛔ **Do not push.** `git push` is not on this session's allowlist.

8. **Leave nothing behind.** If the rig opened a browser, confirm it closed. Print the
   local commit SHA as your last line.

**Exit 0** when `smoke.json` exists and the local commit was made. Exit non-zero only if
step 1 fails or `smoke.json` could not be written.

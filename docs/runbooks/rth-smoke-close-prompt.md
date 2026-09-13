# RTH SMOKE — CLOSE half. NOT A MEASUREMENT.

> Piped to `claude -p` by `scripts/rth-close.ps1 -PromptFile docs\runbooks\rth-smoke-close-prompt.md`.
> Nobody is watching. Do not ask for input. Do not message anyone.

This rehearses the CLOSE chain only. Everything it reads is from a quiet, closed tape and
is worthless as data.

**Working directory:** `C:\Users\Patrick\uct-worktrees\flow-watch-rail`.

Do exactly this, then exit:

1. Read whatever exists in `scratchpad/monday-rth/` — `smoke.json`, `run-open.json`,
   `preflight-*.json`. **Measure nothing.** Do not run the rig (it is not on your
   allowlist anyway).

2. Write `docs/runbooks/monday-rth-results/FINAL-REPORT.md` containing:
   - a first line reading exactly `REHEARSAL — NOT A MEASUREMENT`,
   - which files you found and each one's `status`/`verdict`,
   - a provenance block naming the files it was built from,
   - the sentence "The close chain works." if you got this far.

3. ⛔ **DO NOT PUSH.** This is a rehearsal; pushing a rehearsal report to master would put
   a fake report in the repo. Do not run `git push` even though this session's allowlist
   permits it — the allowlist exists for Monday, not for tonight.

4. Commit locally only: `git add -f docs/runbooks/monday-rth-results/FINAL-REPORT.md` then
   commit with the message `smoke: RTH close chain proof (NOT A MEASUREMENT)`.

5. Print the local commit SHA as your last line.

**Exit 0** once `FINAL-REPORT.md` exists and the local commit was made.

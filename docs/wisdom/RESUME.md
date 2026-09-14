---
id: WISDOM-LOOP-RESUME
title: UCT Wisdom Loop — restart runbook (Windows / PowerShell)
status: current
written: 2026-09-13, graceful pause before a machine restart
---

# Restart runbook

`docs/wisdom/SESSION-STATE.md` is the single resume authority: SHAs, stream table, rulings and costs. This file is
the procedure. Every command below is PowerShell.

## 1. Reopen the integrator session (first, and the only session you need to open)

```powershell
cd C:\Users\Patrick\uct-worktrees\wisdom-loop
git branch --show-current          # expect: feat/wisdom-loop
claude
```

Inside Claude Code, set the same configuration as before the pause: `/model` → Opus 5 (1M context), then
`/effort ultracode`. Paste the resume prompt from §7.

**Stream agents do not need their own sessions.** The integrator relaunches each stream from its recorded branch and
its existing worktree. Those worktrees are `C:\Users\Patrick\uct-dashboard\.claude\worktrees\wf_c1669d34-d75-1` through
`-7`, plus `agent-a2d7f7d184d0d0c60` for golden propagation. A relaunched agent CONTINUES from the branch tip. It never
restarts a stream from `1363d588b`.

⚠️ Do not re-invoke the paused workflow with `resumeFromRunId` as-is. Only the S-A builder result is cached, so the six
unfinished builders would start over in fresh worktrees. The integrator writes a continuation workflow instead: one
builder per unfinished stream, told its worktree, branch, last SHA and next action (from SESSION-STATE), then a
reviewer each.

## 2. Confirm the environment before any work (print every result)

```powershell
# 2.1 git: branch, clean tree, local = remote for every recorded branch
cd C:\Users\Patrick\uct-worktrees\wisdom-loop
git status --short                                   # expect: empty
git fetch origin
foreach ($b in 'feat/wisdom-loop','wisdom/w1-b-rails','wisdom/w1-a-capture','wisdom/w1-c-sources','wisdom/w1-d-extract','wisdom/w1-e-evals','wisdom/w1-f-admin','wisdom/w1-f-publish','wisdom/w1-d-golden-prop','wisdom/w1-d-golden') {
  "{0,-28} local={1} remote={2}" -f $b, (git rev-parse --short $b), (git rev-parse --short "origin/$b")
}                                                    # compare against SESSION-STATE §Branches

# 2.2 every Wisdom worktree clean
git worktree list | Select-String 'wisdom|wf_c1669d34|agent-a2d7f7d184'
foreach ($i in 1..7) { $w = "C:\Users\Patrick\uct-dashboard\.claude\worktrees\wf_c1669d34-d75-$i"; "$w -> " + ((git -C $w status --short | Measure-Object -Line).Lines) + " uncommitted" }
git -C C:\Users\Patrick\uct-dashboard\.claude\worktrees\agent-a2d7f7d184d0d0c60 status --short

# 2.3 Railway reachable and secrets present (NAMES ONLY — never print values)
railway status
railway variables --service web --kv | ForEach-Object { ($_ -split '=',2)[0] } | Select-String -Pattern '^(DISCORD_BOT_TOKEN|DATA_SYNC_ENDPOINT_URL|DATA_SYNC_ACCESS_KEY|DATA_SYNC_SECRET_KEY|DATA_SYNC_BUCKET|ANTHROPIC_API_KEY|PUSH_SECRET|TWITTERAPI_IO_API_KEY|ZOOM_S2S_CLIENT_ID|ADMIN_EMAILS)$'
curl.exe -s -o NUL -w "%{http_code}`n" -A "Mozilla/5.0" https://uctintelligence.com/api/health      # expect 200
railway deployment list --service web --json | Select-Object -First 1                               # newest SUCCESS, nothing DEPLOYING

# 2.4 R2 reachable (read-only probe; expect desk_audio/rKVAkk3811Q.m4a exists, wisdom/ keys = 16 test fixtures)
$S = "C:\Users\Patrick\uct-worktrees\wisdom-loop\data\wisdom\scratch\session-5691081b-scratchpad"
railway run --service web python "$S\r2_probe_audio.py"

# 2.5 Discord bot token valid (expect tsdr 200, bracco 200, chartmaster 200, manrav 200)
railway run --service web python "$S\discord_verify.py"

# 2.6 Batch jobs recorded in SESSION-STATE are still listed (both expected: ended, results already collected)
railway run --service web python -c "import anthropic,os; c=anthropic.Anthropic(api_key=os.environ['ANTHROPIC_API_KEY'], timeout=60); [print(b, c.messages.batches.retrieve(b).processing_status) for b in ('msgbatch_01Kvf7Q9ZinucRR7xfKQTsnq','msgbatch_019NjdbTHu1eK3MXbW2zxMC7')]"

# 2.7 box lock free, and no stray Wisdom processes
python C:\Users\Patrick\uct-clips\tools\heavy_lock.py status
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -match 'wisdom' } | Select-Object ProcessId, CommandLine
```

If any check fails, fix it before relaunching streams. Record the result in the first checkpoint's drift section.

## 3. Restart each local background process from its checkpoint

| Process | Resume file | Last checkpoint | Command |
|---|---|---|---|
| Desk-transcript audit (Step 0) | `data\wisdom\audit\AUDIT-RESUME.md` | ids 1–350 swept, partial JSON written | Confirm `/api/health` = 200 and nothing DEPLOYING, then run: `cd C:\Users\Patrick\uct-worktrees\wisdom-loop; railway run --service web python "$S\audit_catalog_sweep.py" "$S\audit_catalog.json" 351`, then `python "$S\audit_assemble.py"`. After that: YouTube durations and captions for the under-98 % list (cap 30 lookups). If a script hard-codes the old `%TEMP%` scratchpad path, edit only that path. |
| Golden propagation + v1 freeze | `data\wisdom\golden\PROPAGATION-RESUME.md` | tasks 1–5 evidence gathered; nothing written; no backups yet | The integrator relaunches an agent in `...\worktrees\agent-a2d7f7d184d0d0c60` (branch `wisdom/w1-d-golden-prop`), pointing it at the resume file. First step: read `ev3_out.txt` in `$S`. **Do not repeat the X lookup** (the one allowed call is used). |
| S-D golden gate / drift / smaller-model trial | `data\wisdom\extract\spend-ledger.json`, `data\wisdom\extract\gate-run-1\gate-report-*.json` | ✅ **COMPLETE 2026-09-14** — gate + drift + trial all collected, **$11.6504 of the cap**. Neither `msgbatch_01Kvf7Q9ZinucRR7xfKQTsnq` nor `msgbatch_019NjdbTHu1eK3MXbW2zxMC7` was re-submitted; both still read `collected: true` | ⛔⛔ **`--max-usd` IS THE TOTAL CAP, NOT THE REMAINDER.** This row used to say *“pass `--max-usd` equal to the remaining cap (15 − 4.45)”* and that instruction was WRONG: `SpendCap.reserve` tests `spent + reserved + usd > max_usd` against the total the ledger already carries, so passing 10.55 would have left **$6.10** of headroom, stopped the gate part-way and recorded an INCOMPLETE evaluation. Pass the whole program cap — **now $40** (owner ruling D-R2, 2026-09-14; one program-level total across every extractor_version, model and run, with per-version and per-run spend reported as sub-lines). Never re-submit a batch already listed in the ledger. |
| Discord listener, capture jobs, backfills | — | never started (nothing merged to master; every Wisdom flag dark) | Nothing to restart. |

## 4. Anthropic Batch / Railway jobs that ran through the restart

- **Anthropic Batch:** `msgbatch_01Kvf7Q9ZinucRR7xfKQTsnq` and `msgbatch_019NjdbTHu1eK3MXbW2zxMC7`. Both show `collected: true` in
  `data\wisdom\extract\spend-ledger.json`, so nothing is pending. Results land in the S-D gate reports under `data\wisdom\extract\pilot\`.
- **Railway:** no Wisdom service or job is deployed. Nothing from this program is on master, so nothing runs on Railway.

## 5. What NOT to do on resume

- Do not re-submit any Batch id listed in SESSION-STATE or `spend-ledger.json`. Do not re-spend the golden gate from zero.
- Do not re-run the desk audit from id 1. Do not re-run the golden propagation evidence gathering from zero. Do not make a
  second X lookup.
- Do not start any master merge until the stream table shows the next stream in the §8.4 order (S-B first) green on
  its unit tests, the import-ban rails and its reviewer verdict. Then do one at a time, with Railway web SUCCESS between merges.
- Do not delete the 16 test-fixture objects under R2 `wisdom/sources/zoom_vtt/`. There is no Wisdom delete path by
  design. Fix the S-C test isolation first; the objects' fate is a recorded item (SESSION-STATE §Open items).
- Do not plan a Zoom recovery. Zoom cloud copies are deleted on purpose after posting.
- Do not read Journal / J2 / Notebook / broker data (D16b deferred).
- Do not `git worktree remove` the S-F1 worktree without first running `cmd /c rmdir` on its `app\node_modules` junction.
- Do not use `TZ=America/New_York date` in Git Bash for ET time; it prints UTC. Use `(Get-Date)` (CT) or `date -u`.

## 6. After the checks pass

Relaunch the streams (§1) with the next actions from SESSION-STATE, and restart the local processes (§3). Then open
the next checkpoint with the stream status table, cost to date, and any drift between SESSION-STATE and the repo.

## 7. Resume prompt (paste verbatim)

Resume the Wisdom Loop Wave 1 build. Read docs/wisdom/SESSION-STATE.md and docs/wisdom/RESUME.md first, then CLAUDE.md and docs/wisdom/PROGRAM-MANIFEST.md. Verify the environment per RESUME.md and print the check results. Relaunch every stream from its recorded branch and next action; pick up recorded Batch jobs and background processes from their checkpoints, never from zero. Continue under the v2.0 mandate: all owner rulings in SESSION-STATE stand, nothing needs me except flag flips and vetoes, sequential master merges in the §8.4 order, and open the next checkpoint with the stream status table, cost to date, and any drift you found between SESSION-STATE and the actual repo.

# The Study workbench — hand-off pack (2026-11-04)

The owner reviews the Study module ("Duolingo for stocks") on a LOCAL WORKBENCH: one piece at a
time, every part of the page ranked 1 Cut .. 5 Great with words, then a whole-piece score. This
folder is everything that lived only on the first computer, so the loop can continue on another.

## What is here

| path | what |
|---|---|
| `walkthrough/server.py` | the shell on http://127.0.0.1:8793/ (serves `lab.html`, `pieces.json`, `parts/`, appends rankings to `feedback.jsonl`, one-click sandbox sign-in) |
| `walkthrough/lab.html` | shell v3: batch tabs, one part at a time with its picture (gold box), ranks + words, whole-piece score, Live piece / Highlight, Desktop / Phone |
| `walkthrough/pieces.json` | every piece of every batch (batch 17 = the daily drill, round 17b) with its `parts` |
| `walkthrough/feedback.jsonl` | the owner's rankings, verbatim (already ingested into `docs/study/audits/2026-10-24/owner_verdicts.jsonl` through batch 16; batch 17 pending) |
| `walkthrough/parts/index.json` | which part pictures exist. **The PNGs are not here (47 MB)**: `rigs/pw_parts.py b17-drill` remakes them in ~3 min |
| `walkthrough/data/` | the sandbox's bar dumps (pod bars for the exhibits) + the owner's chart settings |
| `walkthrough/{fonts,vendor,pieces}/` | the shell's self-hosted font, lightweight-charts and the one static piece |
| `rigs/` | the Playwright rigs (headless Chromium, `--use-angle=swiftshader` for WebGL), the round patch scripts (r11..r17b, idempotent), the sandbox boot scripts, the verdict ingest |
| `SESSION-MEMORY.md` | the first computer's Claude Code memory file for this project, so a new session knows the history and the owner's rulings |

**Not here, on purpose:** `sandbox_env.json` (`{"PUSH_SECRET": ..., "UCT_SANDBOX_PASSWORD": ..., "EMAIL": ...}`).
Recreate it beside the rigs with your own values: `PUSH_SECRET` can be anything for a local backend,
`EMAIL` / `UCT_SANDBOX_PASSWORD` are the local reviewer account the reset script creates. Never commit it.

## Booting it on a new computer

The rigs carry the first computer's absolute paths (`C:\Users\pgosz\AppData\Local\Temp\claude\...\scratchpad\local_study`
and the worktree `C:\Users\pgosz\uct-worktrees\study-hve-overlay`). Copy this folder's `walkthrough/` and `rigs/`
into one working directory (call it `LS`) and replace those two paths in the scripts with yours (a find-and-replace;
`sandbox_env.json` sits in `LS`).

1. **The sandbox backend (port 8077)** — the whole Study bank with the pod bars, a local reviewer account:
   `bash LS/reset_local.sh` (needs the repo's Python venv with the backend deps; it runs
   `tools/local_backend_sandbox.py --port 8077`, imports the bank with `scripts/study/import_bank.py`, approves every
   item, creates the reviewer account). ⚠ `start_backend.sh` alone does NOT restart it in place: the tool imports the
   repo's conftest, which mints FRESH, EMPTY temp dirs on every start (bank, bars and the reviewer account gone;
   measured 2026-11-05 after a restart for a server fix). To restart on new code and keep everything, use
   `bash LS/start_backend_pinned.sh` (`run_sandbox_pinned.py` points every pinned path back at the workbench's own
   data dir and auth.db; edit the two paths at its top on a new computer).
2. **The Vite lab (port 5232)** — the real components on the sandbox:
   `cd app && npx vite --config vite.config.lab.mjs --host 127.0.0.1 --port 5232 --strictPort`
   (`/lab.html?piece=64` = the real DrillPlayer on Today's set; `&set=free` = a fresh free set each load).
3. **The shell (port 8793)**: `python LS/walkthrough/server.py` then open http://127.0.0.1:8793/?b=17&p=b17-drill.
4. **Pictures**: `python LS/pw_parts.py b17-drill` (desktop + phone, every part, gold box), `python LS/pw_drill.py`
   (the six screens, `show/drill_{pc,phone}_{1_question,2_reveal,3_end}.png`).
5. **After the owner ranks**: `python LS/ingest_feedback.py` appends the new rows to
   `docs/study/audits/2026-10-24/owner_verdicts.jsonl` (CRLF on disk); commit and push the same day.

All of it stays on loopback. The classifier refuses exposing it to the LAN; the owner reviews on PC Chrome, and the
live site is where his phone and his team look.

## Where the programme stands (2026-11-04, evening)

- LIVE on uctintelligence.com: the Study mark, the three challenges (Blitz, Boss, Spot the Kicker), the chart-tap
  snap, the signed-out card, and the daily drill in **round 17b** (PR #800, merge caadddf14e, web booted 20:35 local).
- The owner's batch-16 verdicts (50/100) drove round 17; his batch-17 ranks are the next input, plus his dev team's
  notes from the live site.
- Open from before: Hard mode and Draw-it need `levels` / `plan` bank items per setup (server scoring exists); the bank
  must grow (unseen-only pools drain); the "(owner ruling pending ...)" drafting notes in the bear_gaps / setups
  lessons; one spot item says "Capitulation" while its chip reads VOLUME CLIMAX; the stored `SMOKE_PASSWORD` for the
  production smoke account is stale (401), so the signed-in live check is the owner's until he resets it.
- Rules that never change: no runtime AI, no model writes a market fact, every owner ruling is stored verbatim and
  pushed the same day, never sign into the website as the owner, the owner's Chrome is never a smoke-account browser.

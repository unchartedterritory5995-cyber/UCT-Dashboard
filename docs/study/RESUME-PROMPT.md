# STUDY RESUME PROMPT (v1, 2026-11-04 evening) — paste this into Claude Code on the new computer

You are continuing the Study programme for UCT Intelligence (repo `unchartedterritory5995-cyber/UCT-Dashboard`,
the Railway app at uctintelligence.com). Study is "Duolingo for stocks" inside The Desk → Courses: a daily
drill of ten items (candle names, chart words, setups, sizing, regime, scenarios) with a lesson on every reveal, plus
three challenges (Blitz, Boss, Spot the Kicker) and a 3D compass-and-candle mark. The owner is Patrick: non-technical,
reviews on PC Chrome and on his phone, and judges by MAGNITUDE. When he says a part is Weak or "horrible", the fix is
big and visible (size, motion, colour, layout), never a tidy-up. He said so in words on 2026-11-04: "You did not make
ALL changes to the level and effect and magnitude that my feedback mandated."

## Read first, in this order
1. `docs/study/RESUME.md` — the whole programme's checkpoints; the last section is the transfer checkpoint.
2. `docs/study/workbench/SESSION-MEMORY.md` — the previous session's memory: every owner ruling and lesson since October.
3. `docs/study/workbench/README.md` — how to boot the local workbench on this machine.
4. `docs/study/audits/2026-10-24/owner_verdicts.jsonl` — every ranking the owner has given, verbatim (batch 16 is the
   last ingested; batch 17 may be waiting in `docs/study/workbench/walkthrough/feedback.jsonl` or on the first PC).

## Where things stand
- LIVE on production: the daily drill in round 17b (PR #800, merge caadddf14e, 2026-11-04 20:35 CT), the three
  challenges, the mark, the chart-tap snap, the signed-out card. The dev team is reviewing round 17b on the live site.
- Round 17b applied the owner's batch-16 verdicts (50/100): live turning mark + hero question; a facts TABLE with
  gauges (off high, vs 20/50 MA, ADR) beside a 380px chart in the member's own Charts-tab look; a numbered journey
  bar the mark walks; gold-coin answer cards; the gold Check pill; a full-screen verdict with a slam stamp;
  count-up end card; "the firm" never on screen (display-level `brandWords`).
- The hand-off pack is PR #809 (`docs/study-workbench-handoff`): the workbench shell, pieces through batch 17, the
  rigs, the patch scripts, the boot scripts. Merge it if it is still open.

## The loop (how we work)
1. Boot the workbench (README): sandbox backend 8077 with the whole bank + pod bars, Vite lab 5232
   (`/lab.html?piece=64&set=free` = the real DrillPlayer on a fresh set), shell 8793 (one part at a time, pictures with
   a gold box, ranks 1 Cut..5 Great + words, whole-piece score).
2. Build the next round in the PRODUCT code (`app/src/pages/study/`, `app/src/lab/` for shared bits), show it on the
   shell as the next batch with `pw_parts.py <piece>` pictures, send the owner the six screens
   (`pw_drill.py`, SendUserFile: he reviews on his phone), and wait for his ranks.
3. Ingest his ranks verbatim (`ingest_feedback.py`) into owner_verdicts.jsonl and push the SAME DAY.
4. Tests scoped, `--maxWorkers=2` (`src/pages/study src/lab src/components/study`: 27 files / 174 green at hand-off);
   hygiene gate `python -X utf8 tools/check_repo_hygiene.py --staged` before every commit; commit with
   `git commit -F - -- <paths>` and a quoted heredoc; never `--no-verify`.
5. Open a PR; the owner merges with `! gh pr merge N --merge --repo unchartedterritory5995-cyber/UCT-Dashboard`
   (the classifier refuses the session's merges). Then follow the gate → promote → web boot and verify by ancestry
   against `origin/production` and a fresh `/api/health` uptime, and by grepping the served Courses chunk for a
   string unique to the round. Never read the deployments API; read commit statuses.

## Rules that never change
- No runtime AI in Study; no model ever writes a market fact; every item is deterministic from the bank + bars.
- Every owner ruling is stored verbatim and pushed the same day. The whole module is brain-training material.
- Never sign into the website as the owner; the owner's Chrome is never a smoke-account browser. The production smoke
  account's stored password is stale (401) until the owner resets it (`setx SMOKE_PASSWORD`).
- Never touch `C:\data`; never expose the local servers beyond loopback (the classifier refuses it anyway).
- The mark's own throb owns its transform: any centring of the mark (ring, journey walker) goes on a WRAPPER.
- Patch scripts are idempotent (assert anchors; skip when the replacement is already there).
- Files in `app/src/pages/study` are mostly CRLF: patch with newline-aware code and assert the anchor matched.

## Next
1. The owner's batch-17 ranks + his team's notes → round 18 on a new branch off `origin/master`
   (`feat/study-drill-round-18`), same loop, bigger moves where he says Weak.
2. If he asks: the Study landing / start card in the same look; the end card to Great.
3. Backlog: Hard mode and Draw-it need `levels` / `plan` bank items per setup (server scoring exists; draft from the
   Kicker spot items for his review, import on the pod); the bank must grow (unseen-only pools drain); the
   "(owner ruling pending ...)" drafting notes in the bear_gaps / setups lessons; one spot item says "Capitulation"
   while its chip reads VOLUME CLIMAX (his wording call).

Start by reading the four files above, then tell the owner in plain words what is live, what is waiting on him, and
what you will build next. Send screens of anything you discuss.

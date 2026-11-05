# STUDY RESUME PROMPT (v1.1, 2026-11-04 night) — paste this into Claude Code on the new computer

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

## Before you trust the workbench (first-run checklist)
- `curl http://127.0.0.1:8077/api/health` is 200 and the shell's "Sign the sandbox in" card is green (a lapsed session
  reads as "couldn't load the stuff"; one tap fixes it).
- The bank import printed a TOTAL and every item is approved (reset_local.sh does both); `pw_drill.py` runs with
  "page errors: []" and six PNGs; `pw_parts.py <piece>` writes every part for desktop AND phone.
- The sandbox member's chart settings are the owner's (walkthrough/data/owner_chart_settings.json) so the drill chart
  looks like his Charts tab.

## Definition of done for a round
A round is done when the owner has ranked every part on the shell AND seen the six screens on his phone AND his words
are in owner_verdicts.jsonl and pushed. "Tests green" and "PR open" are never done. A deploy is done when the merge is
an ancestor of origin/production, /api/health shows a fresh uptime, and the served Courses chunk contains a string
unique to the round (fetch /, follow index-*.js -> Desk-*.js -> CoursesSection-*.js). Never read the GitHub
deployments API for this; read commit statuses and check-run annotations.

## Tool traps that cost hours (do not rediscover them)
- A quoted bash heredoc halves backslashes: write regex literals with the Edit tool or a Write-then-run script.
- Most files under app/src/pages/study are CRLF: a patch with LF anchors prints "done" and changes nothing. Assert the
  anchor matched; make every patch script idempotent (a re-run after a failure applied one sub three times).
- The classifier refuses: `gh pr merge` (the owner merges with `! gh pr merge N --merge --repo ...`), exposing local
  ports to the LAN, railway ssh reads of production.
- A CI job that fails in 3 s with no steps is a runner/billing problem: `gh run view --log` says "log not found";
  read `gh api repos/<r>/check-runs/<job>/annotations`.
- Discord's composer ignores text inserted by script; type it as keystrokes, keep it under 2,000 characters, send from
  a fresh tab.
- The mark's own throb animation owns its transform: centre it with a wrapper, never on the mark.
- A pod-side `study_store.review(..., "fix")` parks the item in DRAFT for a second look, by design: a script that
  rewrites text on approved items must re-approve them in the same run, or they fall off the member path unnoticed
  (the 2026-10-25 definition refresh did this to 114 lessons; found and repaired 2026-11-05).
- Predict an import's `kept` count from EVERY apply script's fix calls (each fix bumps the pod version), not from one
  script, and read the pod back (a read-only readback script, the owner's `!` command) before saying what changed.

## The owner's own words (calibrate on these)
- 2026-11-04, on the live site before round 16: "it looks nothing like the work we did in the local host the charts
  the words the graphics the production the quality."
- Batch 16 notes (score 50): bubble "I want the logo ... to be moving in our animation work ... text ... standout a bit
  more"; chip "Dont need the bar count, if anything have % down from highs and % extended from MAs in a table graph";
  prog "an animated bar of a journey that our logo is filling up"; chart "not our complete and perfect UCT charts that
  each user has in their settings"; pointer "significantly higher quality ... ALSO quit calling us THE FIRM"; cards /
  check / runon / colours / reveal "horrible", "UGLY", "low quality"; stamp "it should take over the entire screen as
  like a pop up uncovered answer like a normal app or game or test would have it"; end "okay but ... could be much
  higher quality."
- After round 17: "You did not make ALL changes to the level and effect and magnitude that my feedback mandated."
  After 17b: "This was good i have some feedback but want my peers to check out this version."

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

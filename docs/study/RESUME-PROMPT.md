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
- Hard mode (plan piece 43) is built as the fourth challenge (PR #874): candles only, no ticker, no averages, no volume,
  "what fired?" scored on the server against the bank's key; on the shell as batch 18 (`?b=18&p=b18-hard`) for his ranks.
  The same PR fixes a LIVE scorer bug: the exact scorer read a choice only from a one-key dict, so every Spot the Kicker
  attempt since 2026-11-04 was stored as a miss. Once that merge serves, the owner runs with `!` the readback, then the
  DRY, then the APPLY of docs/study/audits/2026-11-05/{pod_readback_challenge_attempts,rescore_challenge_attempts_pod}.py.
- ROUNDS 18 + 19 (PR #880, branch feat/study-round-18, stacked on #874): his batch-18 and batch-19 ranks on Hard mode
  (both 50) are applied in turn. A Study UI kit (app/src/pages/study/ui) replaced the lab's styles under Hard mode; then,
  on his batch-19 words: THE CHART IS THE REAL WIDGET (ui/StudyChart mounts the Charts tab's ChartPane around the bank's
  bars; ChartPane gained `identityLabel` so an exhibit never looks its id up; no timeframe bar), the ticker is the ONE
  thing hidden (his words: blank indicators are pointless; HARD_CHART is empty), the buttons are his round-12 family
  (black glass, gold rim), the pointer is a spotlight (the candle's column lit, a chip in the bottom margin), the crowns
  are a Legendary medal + a run ring, the lesson reads through brandWords and a near-miss reads as the reason, no footer.
  Before ranking round 19 he said "I can already tell it needs a revamp" and "figure it out to get it all done": ROUND 20
  is the revamp on my own references (a lesson screen with nothing boxed around the question — Duolingo, Brilliant — and
  our Charts tab): the chart is the hero and nothing else is a box — one bare status line, the widget full width, one
  prompt line in display type beside the mark (ui/Prompt), four pills, one action, the lesson as a plain block under a
  hairline, a verdict flash, the start and the end a full stage on a dim chart. Batch 20 (round 19) was never cut (the
  capture was killed for memory; dropped); batch 21 (round 20) is ranked (2026-11-06, 50/100: the pointer 11/100,
  the run-on, the ticker, the verdict and the start button Cut; the start stage 68/100). ROUND 21 applies every
  part: (1) CORRECTNESS: his AAPL chart (a Launchpad near-miss the screen called "Nothing fired") IS an Oops
  Reversal by the engine, so api/services/study_hard.py sweeps every Hard chart with all seven setup rules (the
  engine detectors + the Williams Oops + an up-day window volume record + the bear-gap finder's hard conditions)
  and a `hard: true` skill session serves only a Yes chart nothing else fires on or a No chart nothing fires on
  (216 of 363 sandbox charts); another setup's name is posted as itself (a recorded miss); (2) the run-on reaches
  the move's culmination (the forward strip is topped up to 60 sessions from the server's own bars.db; the chart
  runs to its best point before a close breaks the signal candle, and 5 past it, a gold callout "+X% in N
  sessions"); (3) the pointer is the chart's callout layer with a Study `look` (ChartCalloutOverlay: a ring on
  the candle, a one-line pill in open space, an arrow); (4) the
  lesson is a coach's card (a direct headline, the last candle measured in six numbers, the bank's chart line, the
  rule as numbered steps in his words; a near-miss template gets the rule from `reveal.setup_rule`); (5) status
  line, pressed-edge buttons, metal title, rule tiles, struck medal, score ring, stat cards. On the shell as batch
  22 (`?b=22&p=b22-hard`). The drill adopts the kit next, on his batch-17 words. The shell keeps unsaved ranks in
  the browser until Save.
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
- The sandbox backend never restarts in place: `start_backend.sh` imports the repo's conftest, which mints FRESH, EMPTY
  temp dirs (bank, bars, reviewer account gone). Restart on new code with `start_backend_pinned.sh` (rigs/). The capture
  rig's fixed sleeps are too short for the sandbox after a restart (attempt writes take 1-15 s): `capture_hard.py` waits
  on the page instead; copy that pattern for a new piece.
- A challenge that posts record keys beside the choice (`picked_bar`, `picked_setup`) relies on the scorer unwrapping the
  choice whatever rides beside it (fixed 2026-11-05; the 2026-10-21 rail asserted the opposite and hid a live defect).

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
1. The owner's batch-22 ranks (Hard mode, round 21, PR #880) and batch-17 ranks (the drill) + his team's notes →
   the drill on the Study UI kit (pages/study/ui) and the real widget (ui/StudyChart), stacked on #880 until #874
   and #880 are in, then off `origin/master`. Batches 18, 19 and 21 are applied. Every other challenge that asks
   "what fired?" (Blitz's name-it questions) should use the same swept pool (`hard: true`).
2. If he asks: the Study landing / start card in the same look; the end card to Great.
3. Backlog as it stands 2026-11-05 evening (every line waits on him; nothing runs on the pod without his `!`):
   - Hard mode and Draw-it: the 16 Kicker `levels` drafts (levels.kicker, PR #819) wait on the pod for his approval
     and his tolerance call (study_scoring.level_tolerance = max(0.75 ATR14, 1%) is looser than a 1-3% Kicker
     stop). On the review screen filter Skill = "Mark the levels": the detection job's own `levels` drafts share
     the type and come first in the oldest-first queue. The other setups' levels wait on his ruling whether the
     detectors' levels (entry = the signal close, stop = the day low, targets 2R / 3R) are how he teaches Oops,
     Launchpad, HVE, Slingshot and Gap Support; `plan` items wait on his sell rules ("work on those later").
   - The bank grows only through his sittings: 43 setup drafts (PR #856) wait on the pod. A skill session is a
     fresh draw from the whole approved pool each time (compose_today keeps no per-member seen list), so a
     challenge pool never "drains": it is thin (Kicker: 17 approved, 12 per play) or empty (Bear gap: 0).
   - Bear gaps wait on his one or two example charts (sitting paused 2026-10-31: 1 good, MPWR; 7 cut). The 39
     drafts carry no drafting note since 2026-11-05: `_common.DRAFTING_MARKERS` refuses "(owner ruling pending
     ...)" and its kin in any member-facing field; the owner's words live in owner_verdicts.jsonl instead.
   - One fixture item (spot.fixtures, skill scan.volume_climax, GOOGL 2026-07-23) says "Capitulation" while its
     chip reads VOLUME CLIMAX: his wording call.

Start by reading the four files above, then tell the owner in plain words what is live, what is waiting on him, and
what you will build next. Send screens of anything you discuss.
